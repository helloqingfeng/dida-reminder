package main

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"log"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/egoist/mygo"
)

// Config holds the schedule parameters of a reminder. Which fields matter
// depends on Type; the rest are zero.
type Config struct {
	H        int    `json:"h,omitempty"`
	M        int    `json:"m,omitempty"`
	S        int    `json:"s,omitempty"`
	Minute   int    `json:"minute,omitempty"`
	Time     string `json:"time,omitempty"`
	Weekday  int    `json:"weekday,omitempty"`
	Day      int    `json:"day,omitempty"`
	Month    int    `json:"month,omitempty"`
	Datetime string `json:"datetime,omitempty"`
}

// Reminder is one scheduled reminder.
type Reminder struct {
	ID          string `json:"id"`
	Type        string `json:"type"`
	Config      Config `json:"config"`
	Content     string `json:"content"`
	Paused      bool   `json:"paused"`
	Expired     bool   `json:"expired"`
	NextTrigger int64  `json:"nextTrigger"` // Unix milliseconds, 0 when none
}

// Alert is a fired reminder waiting for the user to acknowledge it.
type Alert struct {
	ID         string `json:"id"`
	ReminderID string `json:"reminderId"`
	Content    string `json:"content"`
	FiredAt    int64  `json:"firedAt"` // Unix milliseconds
}

// State is the whole app state shared with the frontend.
type State struct {
	Reminders []Reminder `json:"reminders"`
	Queue     []Alert    `json:"queue"`
}

// ReminderInput is what the frontend sends to create or edit a reminder. An
// empty ID creates a new one.
type ReminderInput struct {
	ID      string `json:"id"`
	Type    string `json:"type"`
	Config  Config `json:"config"`
	Content string `json:"content"`
}

// StateChanged is broadcast to every window whenever the state changes.
var StateChanged = mygo.NewEvent[State]("state")

// UiAction tells the frontend to open one of its dialogs (e.g. "new").
var UiAction = mygo.NewEvent[string]("ui")

const snoozeMs = 5 * 60 * 1000

var validTypes = []string{"interval", "once", "countdown", "hourly", "daily", "weekdays", "weekly", "monthly", "yearly"}

// Reminders stores the reminders and runs the timer engine. Its exported
// methods are callable from the frontend.
type Reminders struct {
	mu          sync.Mutex
	path        string
	reminders   []Reminder
	queue       []Alert
	queueActive bool

	// Activate brings the main window to the front. Set by main once the
	// window exists; called when a reminder fires.
	Activate func()
	// OnQueueActive reports whether an alert is waiting. Set by main; used
	// to keep the window above all others while a popup is pending.
	OnQueueActive func(active bool)
}

// NewReminders loads the saved reminders, seeding defaults on first run.
func NewReminders() (*Reminders, error) {
	dir, err := mygo.App.Path(mygo.PathUserData)
	if err != nil {
		return nil, err
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, err
	}
	s := &Reminders{path: filepath.Join(dir, "reminders.json")}
	data, err := os.ReadFile(s.path)
	if err != nil && !os.IsNotExist(err) {
		return nil, err
	}
	if len(data) > 0 {
		if err := json.Unmarshal(data, &s.reminders); err != nil {
			return nil, err
		}
	} else {
		s.reminders = seedReminders()
	}
	now := time.Now()
	for i := range s.reminders {
		catchUpRecurring(&s.reminders[i], now)
	}
	return s, nil
}

// catchUpRecurring advances a recurring reminder whose stored trigger time
// already passed (the app was closed or the machine slept) to its next future
// slot, so opening the app does not fire a stale occurrence. once and countdown
// keep their catch-up fire because their target time is absolute.
func catchUpRecurring(r *Reminder, now time.Time) {
	if r.Paused || r.Expired || r.NextTrigger == 0 {
		return
	}
	switch r.Type {
	case "interval", "hourly", "daily", "weekdays", "weekly", "monthly", "yearly":
		if r.NextTrigger <= now.UnixMilli() {
			r.NextTrigger = computeNextTrigger(*r, now)
		}
	}
}

func seedReminders() []Reminder {
	now := time.Now()
	make := func(typ string, cfg Config, content string, paused bool) Reminder {
		r := Reminder{ID: newID(), Type: typ, Config: cfg, Content: content, Paused: paused}
		r.NextTrigger = computeNextTrigger(r, now)
		return r
	}
	return []Reminder{
		make("interval", Config{M: 10}, "喝口水，休息一下眼睛", false),
		make("weekdays", Config{Time: "09:30"}, "站会：同步今日进展", false),
		make("countdown", Config{M: 45}, "专注写作，别刷手机", true),
	}
}

// GetState returns the current reminders and alert queue.
func (s *Reminders) GetState() State {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.snapshot()
}

// Quit fully closes the app instead of hiding it to the tray.
func (s *Reminders) Quit() {
	mygo.App.Quit()
}

// PauseAll pauses every reminder.
func (s *Reminders) PauseAll() {
	s.mu.Lock()
	for i := range s.reminders {
		s.reminders[i].Paused = true
	}
	s.mu.Unlock()
	s.commit()
}

// ResumeAll resumes the paused reminders, recomputing their next trigger.
func (s *Reminders) ResumeAll() {
	now := time.Now()
	s.mu.Lock()
	for i := range s.reminders {
		r := &s.reminders[i]
		if r.Paused {
			r.Paused = false
			r.NextTrigger = computeNextTrigger(*r, now)
		}
	}
	s.mu.Unlock()
	s.commit()
}

// TestAlert queues a one-off alert so the popup and chime can be checked.
func (s *Reminders) TestAlert() {
	s.mu.Lock()
	s.queue = append(s.queue, Alert{
		ID: newID(), Content: "测试提醒：弹窗与提示音一切正常。", FiredAt: time.Now().UnixMilli(),
	})
	s.mu.Unlock()
	s.commit()
}

// Count returns how many reminders exist.
func (s *Reminders) Count() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.reminders)
}

// DeleteAll removes every reminder and clears any pending alerts.
func (s *Reminders) DeleteAll() {
	s.mu.Lock()
	s.reminders = nil
	s.queue = nil
	s.mu.Unlock()
	s.commit()
}

// Save creates a reminder when input.ID is empty, otherwise edits it.
func (s *Reminders) Save(input ReminderInput) error {
	content := strings.TrimSpace(input.Content)
	if len([]rune(content)) > 128 {
		content = string([]rune(content)[:128])
	}
	if !slices.Contains(validTypes, input.Type) {
		return errors.New("未知的提醒类型")
	}
	candidate := Reminder{Type: input.Type, Config: input.Config}
	next := computeNextTrigger(candidate, time.Now())
	if next == 0 {
		return errors.New("无法计算下次提醒时间")
	}
	if input.Type == "once" && next <= time.Now().UnixMilli() {
		return errors.New("请选择一个将来的时间")
	}

	s.mu.Lock()
	if input.ID == "" {
		s.reminders = append(s.reminders, Reminder{
			ID: newID(), Type: input.Type, Config: input.Config,
			Content: content, NextTrigger: next,
		})
	} else {
		i := s.index(input.ID)
		if i < 0 {
			s.mu.Unlock()
			return errors.New("提醒不存在")
		}
		r := &s.reminders[i]
		r.Type = input.Type
		r.Config = input.Config
		r.Content = content
		r.Expired = false
		r.NextTrigger = next
	}
	s.mu.Unlock()
	s.commit()
	return nil
}

// Remove deletes a reminder and any alert it queued.
func (s *Reminders) Remove(id string) error {
	s.mu.Lock()
	i := s.index(id)
	if i < 0 {
		s.mu.Unlock()
		return errors.New("提醒不存在")
	}
	s.reminders = slices.Delete(s.reminders, i, i+1)
	s.queue = slices.DeleteFunc(s.queue, func(a Alert) bool { return a.ReminderID == id })
	s.mu.Unlock()
	s.commit()
	return nil
}

// TogglePause pauses a running reminder, resumes a paused one, or restarts
// an expired one.
func (s *Reminders) TogglePause(id string) error {
	s.mu.Lock()
	i := s.index(id)
	if i < 0 {
		s.mu.Unlock()
		return errors.New("提醒不存在")
	}
	r := &s.reminders[i]
	switch {
	case r.Expired:
		r.Expired = false
		r.Paused = false
		r.NextTrigger = computeNextTrigger(*r, time.Now())
	case r.Paused:
		r.Paused = false
		r.NextTrigger = computeNextTrigger(*r, time.Now())
	default:
		r.Paused = true
	}
	s.mu.Unlock()
	s.commit()
	return nil
}

// Dismiss acknowledges the alert at the front of the queue.
func (s *Reminders) Dismiss() {
	s.mu.Lock()
	if len(s.queue) > 0 {
		s.queue = s.queue[1:]
	}
	s.mu.Unlock()
	s.commit()
}

// Snooze acknowledges the front alert and reschedules its reminder five
// minutes from now.
func (s *Reminders) Snooze() {
	s.mu.Lock()
	if len(s.queue) > 0 {
		a := s.queue[0]
		s.queue = s.queue[1:]
		if i := s.index(a.ReminderID); i >= 0 {
			r := &s.reminders[i]
			r.Paused = false
			r.Expired = false
			r.NextTrigger = time.Now().UnixMilli() + snoozeMs
		}
	}
	s.mu.Unlock()
	s.commit()
}

// GetAutoStart reports whether the app launches at login.
func (s *Reminders) GetAutoStart() bool {
	return mygo.App.OpenAtLogin()
}

// SetAutoStart enables or disables launching at login.
func (s *Reminders) SetAutoStart(enabled bool) error {
	return mygo.App.SetOpenAtLogin(enabled)
}

// start runs the timer engine until the process exits.
func (s *Reminders) start() {
	go func() {
		t := time.NewTicker(500 * time.Millisecond)
		defer t.Stop()
		for now := range t.C {
			s.tick(now)
		}
	}()
}

func (s *Reminders) tick(now time.Time) {
	nowMs := now.UnixMilli()
	s.mu.Lock()
	pending := make(map[string]bool)
	for _, a := range s.queue {
		pending[a.ReminderID] = true
	}
	var fired []Alert
	for i := range s.reminders {
		r := &s.reminders[i]
		if r.Paused || r.Expired || r.NextTrigger == 0 || r.NextTrigger > nowMs || pending[r.ID] {
			continue
		}
		fired = append(fired, Alert{ID: newID(), ReminderID: r.ID, Content: r.Content, FiredAt: r.NextTrigger})
		pending[r.ID] = true
		if r.Type == "once" || r.Type == "countdown" {
			r.Expired = true
		} else {
			r.NextTrigger = computeNextTrigger(*r, now)
		}
	}
	if len(fired) > 0 {
		s.queue = append(s.queue, fired...)
	}
	s.mu.Unlock()
	if len(fired) == 0 {
		return
	}
	s.commit()
	for _, a := range fired {
		s.notify(a)
	}
}

func (s *Reminders) notify(a Alert) {
	body := a.Content
	if body == "" {
		body = "时间到！"
	}
	n := mygo.NewNotification(mygo.NotificationOptions{
		ID:    a.ID,
		Title: "滴答提醒",
		Body:  body,
	})
	n.OnClick(func() {
		if s.Activate != nil {
			s.Activate()
		}
	})
	if err := n.Show(); err != nil {
		log.Printf("notification %s: %v", a.ID, err)
	}
}

func (s *Reminders) index(id string) int {
	return slices.IndexFunc(s.reminders, func(r Reminder) bool { return r.ID == id })
}

func (s *Reminders) snapshot() State {
	return State{
		Reminders: slices.Clone(s.reminders),
		Queue:     slices.Clone(s.queue),
	}
}

// commit persists the reminders and broadcasts the new state.
func (s *Reminders) commit() {
	s.mu.Lock()
	snap := s.snapshot()
	active := len(s.queue) > 0
	flipped := active != s.queueActive
	s.queueActive = active
	data, err := json.MarshalIndent(s.reminders, "", "  ")
	s.mu.Unlock()
	if err != nil {
		log.Printf("marshal reminders: %v", err)
	} else if werr := os.WriteFile(s.path, data, 0o644); werr != nil {
		log.Printf("write %s: %v", s.path, werr)
	}
	StateChanged.Broadcast(snap)
	if flipped && s.OnQueueActive != nil {
		s.OnQueueActive(active)
	}
}

func newID() string {
	b := make([]byte, 8)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

// ---- schedule computation ----

func clamp(v, lo, hi int) int {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}

func intervalMs(c Config) int64 {
	return (int64(c.H)*3600 + int64(c.M)*60 + int64(c.S)) * 1000
}

func daysInMonth(year int, month time.Month) int {
	return time.Date(year, month+1, 0, 0, 0, 0, 0, time.Local).Day()
}

func atTime(base time.Time, timeStr string) time.Time {
	h, m := 9, 0
	if timeStr != "" {
		parts := strings.Split(timeStr, ":")
		if len(parts) >= 2 {
			h, _ = strconv.Atoi(parts[0])
			m, _ = strconv.Atoi(parts[1])
		}
	}
	return time.Date(base.Year(), base.Month(), base.Day(), h, m, 0, 0, base.Location())
}

// computeNextTrigger returns the next trigger time in Unix milliseconds, or
// 0 when the schedule has none. It mirrors the frontend's preview helper.
func computeNextTrigger(r Reminder, now time.Time) int64 {
	c := r.Config
	nowMs := now.UnixMilli()
	switch r.Type {
	case "interval", "countdown":
		dur := intervalMs(c)
		if dur > 0 {
			return nowMs + dur
		}
		return 0
	case "once":
		if c.Datetime == "" {
			return 0
		}
		for _, layout := range []string{"2006-01-02T15:04", "2006-01-02T15:04:05"} {
			if t, err := time.ParseInLocation(layout, c.Datetime, now.Location()); err == nil {
				return t.UnixMilli()
			}
		}
		return 0
	case "hourly":
		minute := clamp(c.Minute, 0, 59)
		d := time.Date(now.Year(), now.Month(), now.Day(), now.Hour(), minute, 0, 0, now.Location())
		if !d.After(now) {
			d = d.Add(time.Hour)
		}
		return d.UnixMilli()
	case "daily":
		ts := atTime(now, c.Time)
		if !ts.After(now) {
			ts = ts.Add(24 * time.Hour)
		}
		return ts.UnixMilli()
	case "weekdays":
		for i := 0; i < 8; i++ {
			base := now.AddDate(0, 0, i)
			if base.Weekday() == time.Sunday || base.Weekday() == time.Saturday {
				continue
			}
			if ts := atTime(base, c.Time); ts.After(now) {
				return ts.UnixMilli()
			}
		}
		return 0
	case "weekly":
		target := time.Weekday(clamp(c.Weekday, 0, 6))
		for i := 0; i < 8; i++ {
			base := now.AddDate(0, 0, i)
			if base.Weekday() != target {
				continue
			}
			if ts := atTime(base, c.Time); ts.After(now) {
				return ts.UnixMilli()
			}
		}
		return 0
	case "monthly":
		day := c.Day
		if day == 0 {
			day = 1
		}
		day = clamp(day, 1, 31)
		for i := 0; i < 13; i++ {
			first := time.Date(now.Year(), now.Month()+time.Month(i), 1, 0, 0, 0, 0, now.Location())
			d := time.Date(first.Year(), first.Month(), min(day, daysInMonth(first.Year(), first.Month())), 0, 0, 0, 0, now.Location())
			if ts := atTime(d, c.Time); ts.After(now) {
				return ts.UnixMilli()
			}
		}
		return 0
	case "yearly":
		month := c.Month
		if month == 0 {
			month = 1
		}
		month = clamp(month, 1, 12)
		day := c.Day
		if day == 0 {
			day = 1
		}
		day = clamp(day, 1, 31)
		for i := 0; i < 2; i++ {
			y := now.Year() + i
			d := time.Date(y, time.Month(month), min(day, daysInMonth(y, time.Month(month))), 0, 0, 0, 0, now.Location())
			if ts := atTime(d, c.Time); ts.After(now) {
				return ts.UnixMilli()
			}
		}
		return 0
	default:
		return 0
	}
}