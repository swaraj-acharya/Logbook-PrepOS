/* Calendar helpers for exam countdowns and time windows. Local dates only; no time zones leak in. */
import { keyToDate, ymd, addDays, daysBetween } from './engine.js';
import type { ClockTime, DateKey } from './types';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const CLOCK_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** A real calendar date in YYYY-MM-DD form (rejects 2027-02-30 and friends). */
export function isDateKey(k: unknown): k is DateKey {
  if (typeof k !== 'string' || !DATE_RE.test(k)) return false;
  const [y, m, d] = k.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}
export function isClock(t: unknown): t is ClockTime { return typeof t === 'string' && CLOCK_RE.test(t); }
export function clockToMin(t: ClockTime): number { const m = CLOCK_RE.exec(t); return m ? Number(m[1]) * 60 + Number(m[2]) : 0; }
export function minToClock(min: number): ClockTime {
  const m = Math.max(0, Math.min(24 * 60 - 1, Math.round(min)));
  return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
}
/** Today's calendar date on this device. The exam countdown uses the calendar, not the study day. */
export function calendarToday(now: number = Date.now()): DateKey { return ymd(new Date(now)); }
export function weekdayOf(k: DateKey): number { return keyToDate(k).getDay(); }
export function diffDays(a: DateKey, b: DateKey): number { return daysBetween(a, b); }
export function shiftDays(k: DateKey, n: number): DateKey { return addDays(k, n); }

/** Adds calendar months, clamping the day (31 Jan + 1 month = 28 or 29 Feb). */
export function addMonths(k: DateKey, n: number): DateKey {
  const [y, m, d] = k.split('-').map(Number);
  const first = new Date(y, m - 1 + n, 1);
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  return ymd(new Date(first.getFullYear(), first.getMonth(), Math.min(d, last)));
}

export type CountdownStatus = 'none' | 'past' | 'today' | 'tomorrow' | 'upcoming';
export type Countdown = {
  status: CountdownStatus; days: number;
  weeks: number; weekDays: number;      // 20 weeks 3 days
  months: number; monthDays: number;    // 4 months 14 days
  label: string;                        // "142 days remaining"
};

export function examCountdown(todayKey: DateKey, examDate: DateKey | null | undefined): Countdown {
  if (!examDate || !isDateKey(examDate) || !isDateKey(todayKey)) {
    return { status: 'none', days: 0, weeks: 0, weekDays: 0, months: 0, monthDays: 0, label: 'No exam date set' };
  }
  const days = daysBetween(todayKey, examDate);
  if (days < 0) {
    const n = -days;
    return { status: 'past', days, weeks: 0, weekDays: 0, months: 0, monthDays: 0, label: 'Exam was ' + n + (n === 1 ? ' day' : ' days') + ' ago' };
  }
  if (days === 0) return { status: 'today', days, weeks: 0, weekDays: 0, months: 0, monthDays: 0, label: 'Exam is today' };
  let months = 0;
  while (months < 1200 && addMonths(todayKey, months + 1) <= examDate) months++;
  const monthDays = daysBetween(addMonths(todayKey, months), examDate);
  return {
    status: days === 1 ? 'tomorrow' : 'upcoming', days,
    weeks: Math.floor(days / 7), weekDays: days % 7, months, monthDays,
    label: days === 1 ? 'Exam is tomorrow' : days + ' days remaining'
  };
}

/** Parses "06:00-08:00, 18:00–21:00" into windows; invalid pieces are reported, not guessed. */
export function parseWindows(text: string): { windows: { start: ClockTime; end: ClockTime }[]; errors: string[] } {
  const windows: { start: ClockTime; end: ClockTime }[] = [], errors: string[] = [];
  for (const raw of String(text || '').split(/[,;\n]+/)) {
    const part = raw.trim(); if (!part) continue;
    const m = /^(\d{1,2}):?(\d{2})\s*[-–—to]+\s*(\d{1,2}):?(\d{2})$/i.exec(part);
    if (!m) { errors.push(part); continue; }
    const s = m[1].padStart(2, '0') + ':' + m[2], e = m[3].padStart(2, '0') + ':' + m[4];
    if (!isClock(s) || !isClock(e) || clockToMin(e) <= clockToMin(s)) { errors.push(part); continue; }
    windows.push({ start: s, end: e });
  }
  windows.sort((a, b) => clockToMin(a.start) - clockToMin(b.start));
  return { windows, errors };
}
export function windowsMinutes(ws: { start: ClockTime; end: ClockTime }[]): number {
  return ws.reduce((a, w) => a + Math.max(0, clockToMin(w.end) - clockToMin(w.start)), 0);
}
