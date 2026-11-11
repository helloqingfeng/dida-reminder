import React, { useState } from "react";
import type { Alert, Reminder } from "./mygo";
import {
  TYPES,
  TYPE_LABEL,
  WEEKDAYS,
  computeNextTrigger,
  defaultConfig,
  describeSchedule,
  fmtClock,
  fmtCountdown,
  fmtDateLabel,
  fmtDateTime,
  fmtDuration,
  intervalMs,
  type AnyConfig,
} from "./helpers";

export interface Draft {
  type: string;
  config: AnyConfig;
  content: string;
}

// Keeps keyboard focus inside an open dialog and restores it on close.
function useFocusTrap(ref: React.RefObject<HTMLElement | null>) {
  React.useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const prev = document.activeElement as HTMLElement | null;
    const selector =
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const focusables = () =>
      Array.from(node.querySelectorAll<HTMLElement>(selector)).filter((el) => el.getClientRects().length > 0);
    const initial = node.querySelector<HTMLElement>("[data-autofocus]") ?? focusables()[0] ?? node;
    initial.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const items = focusables();
      if (items.length === 0) {
        e.preventDefault();
        node.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) {
        e.preventDefault();
        node.focus();
        return;
      }
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && (active === first || active === node)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    node.addEventListener("keydown", onKey);
    return () => {
      node.removeEventListener("keydown", onKey);
      if (prev && prev.isConnected) prev.focus();
    };
  }, [ref]);
}

export function ReminderRow({
  r,
  now,
  onTogglePause,
  onEdit,
  onDelete,
}: {
  r: Reminder;
  now: number;
  onTogglePause: (id: string) => void;
  onEdit: (r: Reminder) => void;
  onDelete: (id: string) => void;
}) {
  const status = r.expired ? "expired" : r.paused ? "paused" : "running";
  const statusLabel = { running: "进行中", paused: "已暂停", expired: "已过期" }[status];
  const isCount = r.type === "interval" || r.type === "countdown";
  let big: React.ReactNode;
  let sub: string;
  if (status === "running" && isCount) {
    const remaining = r.nextTrigger - now;
    const urgent = remaining < 60000;
    big = <span className={"countdown" + (urgent ? " is-urgent" : "")}>{fmtCountdown(remaining)}</span>;
    sub = describeSchedule(r) + " · 下次 " + fmtClock(r.nextTrigger);
  } else if (status === "running") {
    big = <span className="countdown">{fmtClock(r.nextTrigger)}</span>;
    sub = describeSchedule(r) + " · " + fmtDateLabel(r.nextTrigger, now);
  } else if (status === "paused") {
    big = <span className="countdown">暂停中</span>;
    sub = describeSchedule(r);
  } else {
    big = <span className="countdown">{fmtClock(r.nextTrigger)}</span>;
    sub = "已过期 · " + fmtDateLabel(r.nextTrigger, now);
  }
  return (
    <li className={"reminder-row is-" + status} onDoubleClick={() => onTogglePause(r.id)} title="双击暂停 / 恢复">
      <div className="row-time">
        {big}
        <span className="row-sub">{sub}</span>
      </div>
      <div className="row-main">
        <div className="row-content">{r.content || "无提醒内容"}</div>
        <div className="row-tags">
          <span className="badge">{TYPE_LABEL[r.type]}</span>
          <span className={"badge badge-" + status}>{statusLabel}</span>
        </div>
      </div>
      <div className="row-actions">
        <button className="btn btn-sm" onClick={() => onTogglePause(r.id)}>
          {r.expired ? "重启" : r.paused ? "恢复" : "暂停"}
        </button>
        <button className="btn btn-sm" onClick={() => onEdit(r)}>
          编辑
        </button>
        <button className="btn btn-sm btn-danger" onClick={() => onDelete(r.id)}>
          删除
        </button>
      </div>
    </li>
  );
}

export function EditDialog({
  initial,
  now,
  onSave,
  onClose,
}: {
  initial: Reminder | null;
  now: number;
  onSave: (draft: Draft) => void;
  onClose: () => void;
}) {
  const isNew = !initial;
  const dialogRef = React.useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef);
  const [type, setType] = useState(initial ? initial.type : "interval");
  const [config, setConfig] = useState<AnyConfig>(initial ? { ...defaultConfig(initial.type), ...initial.config } : defaultConfig("interval"));
  const [content, setContent] = useState(initial ? initial.content : "");
  const setCfg = (key: string, value: string) => setConfig((c) => ({ ...c, [key]: value }));
  const changeType = (t: string) => {
    setType(t);
    setConfig(defaultConfig(t));
  };

  const next = computeNextTrigger({ type, config }, now);
  let error: string | null = null;
  if ((type === "interval" || type === "countdown") && intervalMs(config) <= 0) error = "间隔时长必须大于 0";
  else if (type === "once" && (!next || next <= now)) error = "请选择一个将来的时间";
  else if (!next) error = "无法计算下次提醒时间";

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && !error) {
        e.preventDefault();
        onSave({ type, config, content });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [error, type, config, content, onSave, onClose]);

  const num = (key: string, min: number, max: number) => (
    <input type="number" min={min} max={max} value={config[key]} onChange={(e) => setCfg(key, e.target.value)} />
  );
  const timeInput = <input type="time" value={config.time || "09:00"} onChange={(e) => setCfg("time", e.target.value)} />;

  return (
    <div
      className="overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="dialog" role="dialog" aria-modal="true" tabIndex={-1} ref={dialogRef} aria-label={isNew ? "新建提醒" : "编辑提醒"}>
        <div className="dialog-head">
          <h2>{isNew ? "新建提醒" : "编辑提醒"}</h2>
          <button className="dialog-close" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </div>
        <div className="dialog-body">
          <div className="field">
            <label>提醒类型</label>
            <div className="field-row">
              <select data-autofocus value={type} onChange={(e) => changeType(e.target.value)}>
                {TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
              {type === "interval" && (
                <React.Fragment>
                  <span className="unit">每</span>
                  {num("h", 0, 99)}
                  <span className="unit">时</span>
                  {num("m", 0, 59)}
                  <span className="unit">分</span>
                  {num("s", 0, 59)}
                  <span className="unit">秒</span>
                </React.Fragment>
              )}
              {type === "countdown" && (
                <React.Fragment>
                  {num("h", 0, 99)}
                  <span className="unit">时</span>
                  {num("m", 0, 59)}
                  <span className="unit">分</span>
                  {num("s", 0, 59)}
                  <span className="unit">秒后提醒</span>
                </React.Fragment>
              )}
              {type === "once" && <input type="datetime-local" value={config.datetime || ""} onChange={(e) => setCfg("datetime", e.target.value)} />}
              {type === "hourly" && (
                <React.Fragment>
                  <span className="unit">每小时第</span>
                  {num("minute", 0, 59)}
                  <span className="unit">分</span>
                </React.Fragment>
              )}
              {(type === "daily" || type === "weekdays") && timeInput}
              {type === "weekly" && (
                <React.Fragment>
                  <span className="unit">星期</span>
                  <select value={config.weekday} onChange={(e) => setCfg("weekday", e.target.value)}>
                    {WEEKDAYS.map((w, i) => (
                      <option key={i} value={i}>
                        {w}
                      </option>
                    ))}
                  </select>
                  {timeInput}
                </React.Fragment>
              )}
              {type === "monthly" && (
                <React.Fragment>
                  <span className="unit">每月</span>
                  {num("day", 1, 31)}
                  <span className="unit">日</span>
                  {timeInput}
                </React.Fragment>
              )}
              {type === "yearly" && (
                <React.Fragment>
                  {num("month", 1, 12)}
                  <span className="unit">月</span>
                  {num("day", 1, 31)}
                  <span className="unit">日</span>
                  {timeInput}
                </React.Fragment>
              )}
            </div>
            {type === "interval" && <span className="hint">提示：把秒数设为 5，即可快速看到弹窗效果</span>}
          </div>
          <div className="field">
            <div className="hint-row">
              <label>提醒内容</label>
              <span>{content.length} / 128</span>
            </div>
            <textarea
              maxLength={128}
              value={content}
              placeholder="弹窗时显示的文字，例如：喝口水，休息一下眼睛"
              onChange={(e) => setContent(e.target.value)}
            ></textarea>
          </div>
          <div className={"preview-box" + (error ? " invalid" : "")}>
            <span className="preview-label">下次提醒</span>
            {error ? (
              <span>{error}</span>
            ) : (
              <span>
                <strong>{fmtDateTime(next!)}</strong>（{fmtDuration(next! - now)}后）
              </span>
            )}
          </div>
        </div>
        <div className="dialog-foot">
          <button className="btn" onClick={onClose}>
            取消
          </button>
          <button className="btn btn-primary" disabled={!!error} onClick={() => onSave({ type, config, content })}>
            确定
          </button>
        </div>
      </div>
    </div>
  );
}

export function AlertPopup({
  alert,
  now,
  onDismiss,
  onSnooze,
}: {
  alert: Alert;
  now: number;
  onDismiss: () => void;
  onSnooze: () => void;
}) {
  const overdue = Math.max(0, now - alert.firedAt);
  const dialogRef = React.useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef);
  return (
    <div className="overlay overlay-alert">
      <div className="dialog alert-dialog alert-pulse" role="alertdialog" aria-modal="true" tabIndex={-1} ref={dialogRef} aria-label="提醒弹窗">
        <div className="dialog-head">
          <h2>时间到！</h2>
          <button className="dialog-close" onClick={onDismiss} aria-label="关闭">
            ×
          </button>
        </div>
        <div className="alert-body">
          <div className="alert-content">{alert.content || "无提醒内容"}</div>
          <div className="alert-meta">
            <div className="meta-row">
              <span className="meta-label">提醒时间</span>
              <span className="meta-value">{fmtDateTime(alert.firedAt)}</span>
            </div>
            <div className="meta-row">
              <span className="meta-label">已超时</span>
              <span className="meta-value overdue">+{fmtCountdown(overdue)}</span>
            </div>
            <div className="meta-row">
              <span className="meta-label">当前时间</span>
              <span className="meta-value">{fmtDateTime(now)}</span>
            </div>
          </div>
        </div>
        <div className="alert-foot">
          <button className="btn" onClick={onSnooze}>
            重复提醒<span className="sub">5 分钟后再响</span>
          </button>
          <button className="btn btn-primary" data-autofocus onClick={onDismiss}>
            知道了<span className="sub">关闭本次提醒</span>
          </button>
        </div>
      </div>
    </div>
  );
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel = "确定",
  cancelLabel = "取消",
  danger,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const dialogRef = React.useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef);
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div
      className="overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="dialog" role="alertdialog" aria-modal="true" tabIndex={-1} ref={dialogRef} aria-label={title}>
        <div className="dialog-head">
          <h2>{title}</h2>
          <button className="dialog-close" onClick={onCancel} aria-label="关闭">
            ×
          </button>
        </div>
        <div className="dialog-body">
          <p className="confirm-message">{message}</p>
        </div>
        <div className="dialog-foot">
          <button className="btn" data-autofocus onClick={onCancel}>
            {cancelLabel}
          </button>
          <button className={"btn" + (danger ? " btn-danger" : " btn-primary")} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}