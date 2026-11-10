package main

import (
	"testing"
	"time"
)

// testLoc is a fixed +08:00 zone so results never depend on the machine's
// local time or DST rules.
var testLoc = time.FixedZone("CST", 8*3600)

func msIn(ms int64) time.Time { return time.UnixMilli(ms).In(testLoc) }

// 2026-03-15 is a Sunday, 10:30 local.
var refNow = time.Date(2026, 3, 15, 10, 30, 0, 0, testLoc)

func TestComputeNextTrigger(t *testing.T) {
	now := refNow

	t.Run("interval", func(t *testing.T) {
		got := computeNextTrigger(Reminder{Type: "interval", Config: Config{M: 10}}, now)
		if want := now.Add(10 * time.Minute).UnixMilli(); got != want {
			t.Fatalf("interval got %v want %v", msIn(got), msIn(want))
		}
	})
	t.Run("interval_zero", func(t *testing.T) {
		if got := computeNextTrigger(Reminder{Type: "interval", Config: Config{}}, now); got != 0 {
			t.Fatalf("zero interval should be 0, got %v", got)
		}
	})
	t.Run("countdown", func(t *testing.T) {
		got := computeNextTrigger(Reminder{Type: "countdown", Config: Config{M: 45}}, now)
		if want := now.Add(45 * time.Minute).UnixMilli(); got != want {
			t.Fatalf("countdown got %v want %v", msIn(got), msIn(want))
		}
	})
	t.Run("once", func(t *testing.T) {
		got := computeNextTrigger(Reminder{Type: "once", Config: Config{Datetime: "2026-03-16T08:00"}}, now)
		if want := time.Date(2026, 3, 16, 8, 0, 0, 0, testLoc).UnixMilli(); got != want {
			t.Fatalf("once got %v want %v", msIn(got), msIn(want))
		}
	})
	t.Run("once_bad", func(t *testing.T) {
		if got := computeNextTrigger(Reminder{Type: "once", Config: Config{Datetime: "nope"}}, now); got != 0 {
			t.Fatalf("bad once should be 0, got %v", got)
		}
	})
	t.Run("hourly_rollover", func(t *testing.T) {
		got := msIn(computeNextTrigger(Reminder{Type: "hourly", Config: Config{Minute: 5}}, now))
		if got.Hour() != 11 || got.Minute() != 5 || !got.After(now) {
			t.Fatalf("hourly(5) expected 11:05, got %v", got)
		}
	})
	t.Run("hourly_same_hour", func(t *testing.T) {
		got := msIn(computeNextTrigger(Reminder{Type: "hourly", Config: Config{Minute: 40}}, now))
		if got.Hour() != 10 || got.Minute() != 40 {
			t.Fatalf("hourly(40) expected 10:40, got %v", got)
		}
	})
	t.Run("daily_rollover", func(t *testing.T) {
		got := msIn(computeNextTrigger(Reminder{Type: "daily", Config: Config{Time: "09:00"}}, now))
		if got.Day() != 16 || got.Hour() != 9 || !got.After(now) {
			t.Fatalf("daily 09:00 passed should roll to next day, got %v", got)
		}
	})
	t.Run("daily_today", func(t *testing.T) {
		got := msIn(computeNextTrigger(Reminder{Type: "daily", Config: Config{Time: "18:00"}}, now))
		if got.Day() != 15 || got.Hour() != 18 {
			t.Fatalf("daily 18:00 should be today, got %v", got)
		}
	})
	t.Run("weekdays_skips_weekend", func(t *testing.T) {
		got := msIn(computeNextTrigger(Reminder{Type: "weekdays", Config: Config{Time: "09:30"}}, now))
		if got.Weekday() == time.Saturday || got.Weekday() == time.Sunday {
			t.Fatalf("weekdays must land Mon-Fri, got %v", got.Weekday())
		}
		if !got.After(now) || got.Hour() != 9 || got.Minute() != 30 {
			t.Fatalf("weekdays wrong time, got %v", got)
		}
	})
	t.Run("weekly_sunday", func(t *testing.T) {
		got := msIn(computeNextTrigger(Reminder{Type: "weekly", Config: Config{Weekday: 0, Time: "09:00"}}, now))
		if got.Weekday() != time.Sunday {
			t.Fatalf("weekly Sunday(0) expected Sunday, got %v", got.Weekday())
		}
		if !got.After(now) {
			t.Fatalf("weekly Sunday must be after now, got %v", got)
		}
	})
	t.Run("weekly_same_day_later", func(t *testing.T) {
		got := msIn(computeNextTrigger(Reminder{Type: "weekly", Config: Config{Weekday: int(now.Weekday()), Time: "23:00"}}, now))
		if got.Weekday() != now.Weekday() || got.Hour() != 23 {
			t.Fatalf("weekly same-day 23:00 expected today 23:00, got %v", got)
		}
	})
	t.Run("monthly_clamp_feb", func(t *testing.T) {
		feb := time.Date(2026, 2, 10, 10, 0, 0, 0, testLoc)
		got := msIn(computeNextTrigger(Reminder{Type: "monthly", Config: Config{Day: 31, Time: "10:30"}}, feb))
		if got.Month() != time.February || got.Day() != 28 {
			t.Fatalf("monthly day31 in Feb 2026 should clamp to 28, got %v", got)
		}
	})
	t.Run("monthly_leap_feb", func(t *testing.T) {
		feb := time.Date(2028, 2, 10, 10, 0, 0, 0, testLoc)
		got := msIn(computeNextTrigger(Reminder{Type: "monthly", Config: Config{Day: 31, Time: "10:30"}}, feb))
		if got.Day() != 29 {
			t.Fatalf("monthly day31 in Feb 2028 (leap) should clamp to 29, got %v", got)
		}
	})
	t.Run("yearly", func(t *testing.T) {
		jun := time.Date(2026, 6, 1, 10, 0, 0, 0, testLoc)
		got := msIn(computeNextTrigger(Reminder{Type: "yearly", Config: Config{Month: 12, Day: 25, Time: "08:00"}}, jun))
		if got.Year() != 2026 || got.Month() != time.December || got.Day() != 25 {
			t.Fatalf("yearly 12-25 expected 2026-12-25, got %v", got)
		}
	})
	t.Run("yearly_feb29_nonleap", func(t *testing.T) {
		jun := time.Date(2024, 6, 1, 10, 0, 0, 0, testLoc)
		got := msIn(computeNextTrigger(Reminder{Type: "yearly", Config: Config{Month: 2, Day: 29, Time: "08:00"}}, jun))
		// 2024-02-29 already passed; 2025 Feb has 28 days, so day clamps to 28.
		want := time.Date(2025, 2, 28, 8, 0, 0, 0, testLoc)
		if !got.Equal(want) {
			t.Fatalf("yearly Feb29 from 2024 expected 2025-02-28, got %v", got)
		}
	})
	t.Run("unknown_type", func(t *testing.T) {
		if got := computeNextTrigger(Reminder{Type: "bogus"}, now); got != 0 {
			t.Fatalf("unknown type should be 0, got %v", got)
		}
	})
}

func TestCatchUpRecurring(t *testing.T) {
	now := refNow
	past := now.Add(-time.Hour).UnixMilli()

	t.Run("interval_advances", func(t *testing.T) {
		r := Reminder{Type: "interval", Config: Config{M: 10}, NextTrigger: past}
		catchUpRecurring(&r, now)
		if r.NextTrigger <= now.UnixMilli() {
			t.Fatalf("interval should advance past now, got %v", msIn(r.NextTrigger))
		}
	})
	t.Run("daily_advances", func(t *testing.T) {
		r := Reminder{Type: "daily", Config: Config{Time: "09:00"}, NextTrigger: past}
		catchUpRecurring(&r, now)
		if r.NextTrigger <= now.UnixMilli() {
			t.Fatalf("daily should advance past now, got %v", msIn(r.NextTrigger))
		}
	})
	t.Run("once_untouched", func(t *testing.T) {
		r := Reminder{Type: "once", Config: Config{Datetime: "2026-03-15T09:00"}, NextTrigger: past}
		catchUpRecurring(&r, now)
		if r.NextTrigger != past {
			t.Fatalf("once must keep its absolute time, got %v", msIn(r.NextTrigger))
		}
	})
	t.Run("countdown_untouched", func(t *testing.T) {
		r := Reminder{Type: "countdown", Config: Config{M: 5}, NextTrigger: past}
		catchUpRecurring(&r, now)
		if r.NextTrigger != past {
			t.Fatalf("countdown must keep catch-up fire, got %v", msIn(r.NextTrigger))
		}
	})
	t.Run("paused_untouched", func(t *testing.T) {
		r := Reminder{Type: "interval", Config: Config{M: 10}, Paused: true, NextTrigger: past}
		catchUpRecurring(&r, now)
		if r.NextTrigger != past {
			t.Fatalf("paused should not change, got %v", msIn(r.NextTrigger))
		}
	})
	t.Run("expired_untouched", func(t *testing.T) {
		r := Reminder{Type: "daily", Config: Config{Time: "09:00"}, Expired: true, NextTrigger: past}
		catchUpRecurring(&r, now)
		if r.NextTrigger != past {
			t.Fatalf("expired should not change, got %v", msIn(r.NextTrigger))
		}
	})
	t.Run("future_untouched", func(t *testing.T) {
		fut := now.Add(time.Hour).UnixMilli()
		r := Reminder{Type: "interval", Config: Config{M: 10}, NextTrigger: fut}
		catchUpRecurring(&r, now)
		if r.NextTrigger != fut {
			t.Fatalf("future trigger should not change, got %v", msIn(r.NextTrigger))
		}
	})
}
