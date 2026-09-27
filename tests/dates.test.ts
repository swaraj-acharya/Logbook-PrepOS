// @ts-nocheck
import { describe, it, expect } from 'vitest';
import { examCountdown, isDateKey, addMonths, parseWindows, windowsMinutes, clockToMin, minToClock } from '../lib/dates';

describe('exam countdown', () => {
  it('counts days, weeks and months to a future exam', () => {
    const c = examCountdown('2026-09-27', '2027-02-10');
    expect(c.days).toBe(136);
    expect(c.status).toBe('upcoming');
    expect(c.label).toBe('136 days remaining');
    expect([c.weeks, c.weekDays]).toEqual([19, 3]);
    expect([c.months, c.monthDays]).toEqual([4, 14]);
  });
  it('handles exam day, tomorrow and a past exam', () => {
    expect(examCountdown('2027-02-10', '2027-02-10')).toMatchObject({ status: 'today', days: 0, label: 'Exam is today' });
    expect(examCountdown('2027-02-09', '2027-02-10')).toMatchObject({ status: 'tomorrow', days: 1, label: 'Exam is tomorrow' });
    expect(examCountdown('2027-02-13', '2027-02-10')).toMatchObject({ status: 'past', days: -3, label: 'Exam was 3 days ago' });
  });
  it('gets leap years right', () => {
    expect(examCountdown('2028-02-28', '2028-03-01').days).toBe(2);   // 29 Feb 2028 exists
    expect(examCountdown('2027-02-28', '2027-03-01').days).toBe(1);
    expect(examCountdown('2027-01-01', '2028-01-01').days).toBe(365);
    expect(examCountdown('2028-01-01', '2029-01-01').days).toBe(366);
  });
  it('is not thrown off by daylight-saving changes (whole calendar days)', () => {
    // Spans both DST switches in zones that have them; local-midnight arithmetic must still give whole days.
    expect(examCountdown('2026-03-01', '2026-11-30').days).toBe(274);
  });
  it('refuses invalid dates instead of guessing', () => {
    expect(isDateKey('2027-02-30')).toBe(false);
    expect(isDateKey('2027-2-3')).toBe(false);
    expect(isDateKey('2028-02-29')).toBe(true);
    expect(examCountdown('2026-09-27', '2027-02-30').status).toBe('none');
    expect(examCountdown('2026-09-27', null).label).toBe('No exam date set');
  });
  it('adds months with day clamping', () => {
    expect(addMonths('2027-01-31', 1)).toBe('2027-02-28');
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29');
    expect(addMonths('2026-11-15', 3)).toBe('2027-02-15');
  });
});

describe('study windows', () => {
  it('parses time windows and reports what it cannot read', () => {
    const r = parseWindows('18:00–21:00, 06:00-08:00; 10:00 to 12:00, 25:00-26:00, 9-10');
    expect(r.windows).toEqual([{ start: '06:00', end: '08:00' }, { start: '10:00', end: '12:00' }, { start: '18:00', end: '21:00' }]);
    expect(r.errors).toEqual(['25:00-26:00', '9-10']);
    expect(windowsMinutes(r.windows)).toBe(420);
    expect(clockToMin('07:45')).toBe(465);
    expect(minToClock(465)).toBe('07:45');
  });
});
