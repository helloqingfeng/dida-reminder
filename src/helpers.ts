export const TYPES = [
  { value: "interval", label: "间隔" },
  { value: "once", label: "仅一次" },
  { value: "countdown", label: "倒计时" },
  { value: "hourly", label: "每小时" },
  { value: "daily", label: "每天" },
  { value: "weekdays", label: "工作日" },
  { value: "weekly", label: "每周" },
  { value: "monthly", label: "每月" },
  { value: "yearly", label: "每年" },
] as const;

export const TYPE_LABEL: Record<string, string> = Object.fromEntries(TYPES.map((t) => [t.value, t.label]));
export const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

// The editor holds input values as strings; the Go service wants numbers.
// These helpers accept either so they serve both the draft and saved shapes.
export type AnyConfig = Record<string, any>;
export interface Schedule {
  type: string;
  config?: AnyConfig;
}

export function pad2(n: number): string {
  return String(n).padStart(2, "0");
}
export function fmtClock(ts: number): string {
  const d = new Date(ts);
  return pad2(d.getHours()) + ":" + pad2(d.getMinutes());
}
export function fmtClockSec(ts: number): string {
  return fmtClock(ts) + ":" + pad2(new Date(ts).getSeconds());
}
export function fmtDateTime(ts: number): string {
  const d = new Date(ts);
  return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()) + " " + fmtClockSec(ts);
}
export function fmtDateLabel(ts: number, now: number): string {
  const d = new Date(ts);
  const n = new Date(now);
  const dayDiff = Math.round(
    (new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() -
      new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime()) /
      86400000,
  );
  if (dayDiff === 0) return "今天";
  if (dayDiff === 1) return "明天";
  if (dayDiff === -1) return "昨天";
  return d.getMonth() + 1 + "月" + d.getDate() + "日";
}
export function fmtCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? h + ":" + pad2(m) + ":" + pad2(s) : pad2(m) + ":" + pad2(s);
}
export function fmtDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const parts: string[] = [];
  if (h > 0) parts.push(h + " 小时");
  if (m > 0) parts.push(m + " 分");
  if (s > 0 || parts.length === 0) parts.push(s + " 秒");
  return parts.join(" ");
}
export function intervalMs(cfg: AnyConfig): number {
  return ((Number(cfg.h) || 0) * 3600 + (Number(cfg.m) || 0) * 60 + (Number(cfg.s) || 0)) * 1000;
}
function daysInMonth(year: number, month0: number): number {
  return new Date(year, month0 + 1, 0).getDate();
}
function atTime(base: number, timeStr: string): number {
  const [h, m] = (timeStr || "09:00").split(":").map(Number);
  const d = new Date(base);
  d.setHours(h || 0, m || 0, 0, 0);
  return d.getTime();
}

// computeNextTrigger mirrors the Go engine for the editor's live preview.
export function computeNextTrigger(r: Schedule, from?: number): number | null {
  const cfg = r.config || {};
  const now = from ?? Date.now();
  switch (r.type) {
    case "interval":
    case "countdown": {
      const dur = intervalMs(cfg);
      return dur > 0 ? now + dur : null;
    }
    case "once": {
      const ts = cfg.datetime ? new Date(cfg.datetime).getTime() : NaN;
      return Number.isFinite(ts) ? ts : null;
    }
    case "hourly": {
      const minute = Math.min(59, Math.max(0, Number(cfg.minute) || 0));
      const d = new Date(now);
      d.setMinutes(minute, 0, 0);
      if (d.getTime() <= now) d.setHours(d.getHours() + 1);
      return d.getTime();
    }
    case "daily": {
      let ts = atTime(now, cfg.time);
      if (ts <= now) ts += 86400000;
      return ts;
    }
    case "weekdays": {
      for (let i = 0; i < 8; i++) {
        const base = now + i * 86400000;
        const dow = new Date(base).getDay();
        if (dow === 0 || dow === 6) continue;
        const ts = atTime(base, cfg.time);
        if (ts > now) return ts;
      }
      return null;
    }
    case "weekly": {
      const target = cfg.weekday == null || cfg.weekday === "" ? 1 : Number(cfg.weekday);
      for (let i = 0; i < 8; i++) {
        const base = now + i * 86400000;
        if (new Date(base).getDay() !== target) continue;
        const ts = atTime(base, cfg.time);
        if (ts > now) return ts;
      }
      return null;
    }
    case "monthly": {
      const day = Math.min(31, Math.max(1, Number(cfg.day) || 1));
      for (let i = 0; i < 13; i++) {
        const d = new Date(now);
        d.setMonth(d.getMonth() + i, 1);
        d.setDate(Math.min(day, daysInMonth(d.getFullYear(), d.getMonth())));
        const ts = atTime(d.getTime(), cfg.time);
        if (ts > now) return ts;
      }
      return null;
    }
    case "yearly": {
      const month = Math.min(12, Math.max(1, Number(cfg.month) || 1));
      const day = Math.min(31, Math.max(1, Number(cfg.day) || 1));
      for (let i = 0; i < 2; i++) {
        const d = new Date(now);
        d.setFullYear(d.getFullYear() + i, month - 1, 1);
        d.setDate(Math.min(day, daysInMonth(d.getFullYear(), month - 1)));
        const ts = atTime(d.getTime(), cfg.time);
        if (ts > now) return ts;
      }
      return null;
    }
    default:
      return null;
  }
}

export function describeSchedule(r: Schedule): string {
  const cfg = r.config || {};
  switch (r.type) {
    case "interval":
      return "每 " + fmtDuration(intervalMs(cfg));
    case "countdown":
      return "倒计时 " + fmtDuration(intervalMs(cfg));
    case "once":
      return "单次";
    case "hourly":
      return "每小时第 " + (Number(cfg.minute) || 0) + " 分";
    case "daily":
      return "每天 " + (cfg.time || "09:00");
    case "weekdays":
      return "工作日 " + (cfg.time || "09:00");
    case "weekly": {
      const wd = cfg.weekday == null || cfg.weekday === "" ? 1 : Number(cfg.weekday);
      return "每周" + WEEKDAYS[wd] + " " + (cfg.time || "09:00");
    }
    case "monthly":
      return "每月 " + (Number(cfg.day) || 1) + " 日 " + (cfg.time || "09:00");
    case "yearly":
      return "每年 " + (Number(cfg.month) || 1) + "月" + (Number(cfg.day) || 1) + "日 " + (cfg.time || "09:00");
    default:
      return "";
  }
}

export function defaultConfig(type: string): AnyConfig {
  switch (type) {
    case "interval":
      return { h: 0, m: 10, s: 0 };
    case "countdown":
      return { h: 0, m: 25, s: 0 };
    case "once": {
      const d = new Date(Date.now() + 3600000);
      return {
        datetime:
          d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()) + "T" + pad2(d.getHours()) + ":" + pad2(d.getMinutes()),
      };
    }
    case "hourly":
      return { minute: 0 };
    case "weekly":
      return { weekday: 1, time: "09:00" };
    case "monthly":
      return { day: 1, time: "09:00" };
    case "yearly":
      return { month: 1, day: 1, time: "09:00" };
    default:
      return { time: "09:00" };
  }
}

// normalizeConfig turns the editor's string values into the numbers the Go
// service expects, dropping empty fields.
export function normalizeConfig(cfg: AnyConfig): AnyConfig {
  const out: AnyConfig = {};
  for (const k of ["h", "m", "s", "minute", "weekday", "day", "month"]) {
    if (cfg[k] !== undefined && cfg[k] !== "") out[k] = Number(cfg[k]) || 0;
  }
  if (cfg.time) out.time = cfg.time;
  if (cfg.datetime) out.datetime = cfg.datetime;
  return out;
}

let audioCtx: AudioContext | null = null;
export function playChime(): void {
  try {
    const Ctx = window.AudioContext || (window as any).webkitAudioContext;
    audioCtx = audioCtx || new Ctx();
    if (audioCtx.state === "suspended") audioCtx.resume();
    const notes = [880, 1174.66, 1567.98];
    notes.forEach((freq, i) => {
      const osc = audioCtx!.createOscillator();
      const gain = audioCtx!.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      const t0 = audioCtx!.currentTime + i * 0.18;
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(0.22, t0 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.5);
      osc.connect(gain).connect(audioCtx!.destination);
      osc.start(t0);
      osc.stop(t0 + 0.55);
    });
  } catch {
    /* audio unavailable */
  }
}