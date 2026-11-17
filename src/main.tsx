import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { currentWindow, isMyGo } from "mygo-runtime";
import { Reminders, events, type Alert, type Reminder } from "./mygo";
import { fmtClock, fmtDateTime, normalizeConfig, playChime } from "./helpers";
import { AlertPopup, ConfirmDialog, EditDialog, ReminderRow, type Draft } from "./components";
import "./style.css";

type Editing = { mode: "new" } | { mode: "edit"; reminder: Reminder } | null;
type Filter = "all" | "running" | "paused" | "expired";

const isAlertView = new URLSearchParams(window.location.search).get("view") === "alert";
document.body.dataset.view = isAlertView ? "alert" : "main";
document.addEventListener("visibilitychange", () => {
  document.body.classList.toggle("bg-paused", document.hidden);
});

function App() {
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [filter, setFilter] = useState<Filter>("all");
  const [editing, setEditing] = useState<Editing>(null);
  const [pendingDelete, setPendingDelete] = useState<Reminder | null>(null);
  const [autoStart, setAutoStart] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);

  // The window has no OS title bar; keep the maximize/restore icon in sync with
  // the native state, including maximize triggered by double-clicking the bar.
  useEffect(() => {
    if (!isMyGo()) return;
    const sync = () => currentWindow.isMaximized().then(setMaximized).catch(() => {});
    sync();
    window.addEventListener("resize", sync);
    return () => window.removeEventListener("resize", sync);
  }, []);

  useEffect(() => {
    const off = events.state.on((s) => setReminders(s.reminders ?? []));
    const offUi = events.ui.on((action) => {
      if (action === "new") setEditing({ mode: "new" });
    });
    Reminders.getState().then((s) => setReminders(s.reminders ?? []));
    Reminders.getAutoStart().then(setAutoStart);
    return () => {
      off();
      offUi();
    };
  }, []);

  const togglePause = (id: string) => void Reminders.togglePause(id);
  const requestDelete = (id: string) => {
    const r = reminders.find((x) => x.id === id);
    if (r) setPendingDelete(r);
  };
  const confirmDelete = () => {
    if (pendingDelete) void Reminders.remove(pendingDelete.id);
    setPendingDelete(null);
  };
  const saveReminder = (data: Draft) => {
    const id = editing && editing.mode === "edit" ? editing.reminder.id : "";
    Reminders.save({ id, type: data.type, config: normalizeConfig(data.config), content: data.content })
      .then(() => setEditing(null))
      .catch((err) => console.error(err));
  };
  const toggleAutoStart = () => {
    const next = !autoStart;
    Reminders.setAutoStart(next)
      .then(() => setAutoStart(next))
      .catch((err) => console.error(err));
  };

  const statusOf = (r: Reminder) => (r.expired ? "expired" : r.paused ? "paused" : "running");
  const rankOf = (r: Reminder) => (r.expired ? 2 : r.paused ? 1 : 0);
  const visible = reminders
    .filter((r) => filter === "all" || statusOf(r) === filter)
    .sort((a, b) => rankOf(a) - rankOf(b) || a.nextTrigger - b.nextTrigger);
  const runningCount = reminders.filter((r) => statusOf(r) === "running").length;
  const nextUp = reminders
    .filter((r) => statusOf(r) === "running" && r.nextTrigger > now)
    .sort((a, b) => a.nextTrigger - b.nextTrigger)[0];

  return (
    <div className="page">
      <div className="app-window">
        <header className="app-header">
          <div className="brand">
            <span className="brand-clock" aria-hidden="true"></span>
            <div>
              <h1>滴答提醒</h1>
              <p>计时提醒小工具</p>
            </div>
          </div>
          <div className="header-right">
            <div className="header-actions">
              <button className={"btn btn-toggle" + (autoStart ? " active" : "")} onClick={toggleAutoStart} title="开机时自动启动">
                <span className="toggle-dot" aria-hidden="true"></span>
                开机自启
              </button>
              <button className="btn btn-primary" onClick={() => setEditing({ mode: "new" })}>
                ＋ 新建提醒
              </button>
              <button className="btn btn-danger" onClick={() => void Reminders.quit()} title="完全退出程序">
                退出
              </button>
            </div>
            <div className="win-controls">
              <button onClick={() => void currentWindow.minimize()} title="最小化" aria-label="最小化">
                <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
                  <path d="M2 6h8" stroke="currentColor" strokeWidth="1.2" fill="none" />
                </svg>
              </button>
              <button
                onClick={() => {
                  currentWindow
                    .toggleMaximize()
                    .then(() => currentWindow.isMaximized().then(setMaximized))
                    .catch(() => {});
                }}
                title={maximized ? "还原" : "最大化"}
                aria-label={maximized ? "还原" : "最大化"}
              >
                {maximized ? (
                  <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
                    <path d="M3.5 4.5V2.5h6v6h-2" stroke="currentColor" strokeWidth="1.1" fill="none" />
                    <rect x="2.5" y="4.5" width="5" height="5" stroke="currentColor" strokeWidth="1.1" fill="none" />
                  </svg>
                ) : (
                  <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
                    <rect x="2.5" y="2.5" width="7" height="7" stroke="currentColor" strokeWidth="1.1" fill="none" />
                  </svg>
                )}
              </button>
              <button className="wc-close" onClick={() => void currentWindow.close()} title="关闭到托盘" aria-label="关闭">
                <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
                  <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.2" fill="none" />
                </svg>
              </button>
            </div>
          </div>
        </header>
        <div className="toolbar">
          <label>
            显示
            <select value={filter} onChange={(e) => setFilter(e.target.value as Filter)}>
              <option value="all">全部</option>
              <option value="running">进行中</option>
              <option value="paused">已暂停</option>
              <option value="expired">已过期</option>
            </select>
          </label>
          <span>
            共 {reminders.length} 条 · 进行中 {runningCount}
          </span>
        </div>
        <div className="list-head">
          <span>时间 / 倒计时</span>
          <span>描述</span>
          <span>操作</span>
        </div>
        {visible.length > 0 ? (
          <ul className="reminder-list">
            {visible.map((r) => (
              <ReminderRow
                key={r.id}
                r={r}
                now={now}
                onTogglePause={togglePause}
                onEdit={(rem) => setEditing({ mode: "edit", reminder: rem })}
                onDelete={requestDelete}
              />
            ))}
          </ul>
        ) : (
          <div className="empty-state">
            <strong>暂无提醒</strong>
            <span>点击右上角「＋ 新建提醒」，试试每 10 分钟提醒一次</span>
          </div>
        )}
        <footer className="statusbar">
          <span>
            当前时间 <span className="clock">{fmtDateTime(now)}</span>
          </span>
          <span>{nextUp ? "下次提醒 " + fmtClock(nextUp.nextTrigger) + " · " + (nextUp.content || "无提醒内容") : "暂无进行中的提醒"}</span>
        </footer>
      </div>
      {editing && (
        <EditDialog
          initial={editing.mode === "edit" ? editing.reminder : null}
          now={now}
          onSave={saveReminder}
          onClose={() => setEditing(null)}
        />
      )}
      {pendingDelete && (
        <ConfirmDialog
          title="删除提醒"
          message={"确定删除「" + (pendingDelete.content || "无提醒内容") + "」？此操作不可撤销。"}
          confirmLabel="删除"
          danger
          onConfirm={confirmDelete}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  );
}

// AlertWindow runs in the small frameless topmost window: it shows only the
// popup card (transparent elsewhere) and owns the chime.
function AlertWindow() {
  const [queue, setQueue] = useState<Alert[]>([]);
  const [now, setNow] = useState(Date.now());
  const seenRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const off = events.state.on((s) => {
      const q = s.queue ?? [];
      setQueue(q);
      const ids = new Set(q.map((a) => a.id));
      for (const a of q) {
        if (!seenRef.current.has(a.id)) playChime();
      }
      seenRef.current = ids;
    });
    Reminders.getState().then((s) => {
      const q = s.queue ?? [];
      setQueue(q);
      seenRef.current = new Set(q.map((a) => a.id));
    });
    return off;
  }, []);

  const hasAlert = queue.length > 0;
  useEffect(() => {
    if (!hasAlert) return;
    const t = setInterval(playChime, 8000);
    return () => clearInterval(t);
  }, [hasAlert]);

  const frontAlert = queue[0];
  return (
    <div className="alert-window">
      {frontAlert && (
        <AlertPopup
          alert={frontAlert}
          now={now}
          onDismiss={() => void Reminders.dismiss()}
          onSnooze={() => void Reminders.snooze()}
        />
      )}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(isAlertView ? <AlertWindow /> : <App />);