import { DEFAULT_TIMEZONE } from '../../types/temporal-normalization.js';

export interface CivilDate {
  year: number;
  month: number;
  day: number;
}

export interface ResolvedTimezone {
  timezone: string;
  timezoneSource: 'envelope' | 'default';
}

export function isValidIanaTimezone(timezone: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

export function resolveTimezone(timezone: string | null | undefined): ResolvedTimezone | null {
  const trimmed = timezone?.trim();
  if (!trimmed) {
    return { timezone: DEFAULT_TIMEZONE, timezoneSource: 'default' };
  }
  if (!isValidIanaTimezone(trimmed)) {
    return null;
  }
  return { timezone: trimmed, timezoneSource: 'envelope' };
}

export function parseReceivedInstant(receivedAt: string): Date {
  const ms = Date.parse(receivedAt);
  if (Number.isNaN(ms)) {
    throw new Error(`Invalid receivedAt: ${receivedAt}`);
  }
  return new Date(ms);
}

export function getCivilDate(instant: Date, timezone: string): CivilDate {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = formatter.formatToParts(instant);
  const year = Number(parts.find((p) => p.type === 'year')?.value);
  const month = Number(parts.find((p) => p.type === 'month')?.value);
  const day = Number(parts.find((p) => p.type === 'day')?.value);
  return { year, month, day };
}

export function formatCivilDate(date: CivilDate): string {
  const y = String(date.year).padStart(4, '0');
  const m = String(date.month).padStart(2, '0');
  const d = String(date.day).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function compareCivilDates(a: CivilDate, b: CivilDate): number {
  if (a.year !== b.year) return a.year - b.year;
  if (a.month !== b.month) return a.month - b.month;
  return a.day - b.day;
}

export function civilDateToOrdinal(date: CivilDate): number {
  return date.year * 10000 + date.month * 100 + date.day;
}

export function addDays(date: CivilDate, days: number): CivilDate {
  const utc = Date.UTC(date.year, date.month - 1, date.day + days);
  const d = new Date(utc);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function isValidCivilDate(date: CivilDate): boolean {
  if (date.month < 1 || date.month > 12) return false;
  if (date.day < 1) return false;
  return date.day <= daysInMonth(date.year, date.month);
}

/** ISO weekday: Monday = 1 … Sunday = 7 */
export function isoWeekday(date: CivilDate): number {
  const d = new Date(Date.UTC(date.year, date.month - 1, date.day));
  const day = d.getUTCDay();
  return day === 0 ? 7 : day;
}

export function startOfIsoWeek(date: CivilDate): CivilDate {
  const weekday = isoWeekday(date);
  return addDays(date, -(weekday - 1));
}

export function formatLocalTime(hour: number, minute: number): string {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`;
}

/**
 * Maps local civil datetime in IANA zone to ISO instant (UTC).
 */
export function localDateTimeToInstant(
  localDate: string,
  localTime: string,
  timezone: string,
): string {
  const [yRaw, mRaw, dRaw] = localDate.split('-');
  const y = Number(yRaw);
  const m = Number(mRaw);
  const d = Number(dRaw);
  if ([y, m, d].some((n) => Number.isNaN(n))) {
    throw new Error(`Invalid localDate: ${localDate}`);
  }

  const timeParts = localTime.split(':').map(Number);
  const hour = timeParts[0] ?? 0;
  const minute = timeParts[1] ?? 0;
  const second = timeParts[2] ?? 0;

  let guessMs = Date.UTC(y, m - 1, d, hour, minute, second);

  for (let i = 0; i < 6; i++) {
    const guessDate = new Date(guessMs);
    const civil = getCivilDate(guessDate, timezone);
    const timeFmt = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
    const parts = timeFmt.formatToParts(guessDate);
    const h = Number(parts.find((p) => p.type === 'hour')?.value);
    const min = Number(parts.find((p) => p.type === 'minute')?.value);
    const sec = Number(parts.find((p) => p.type === 'second')?.value);

    if (
      civil.year === y &&
      civil.month === m &&
      civil.day === d &&
      h === hour &&
      min === minute &&
      sec === second
    ) {
      return guessDate.toISOString();
    }

    const civilOrd = y * 10000 + m * 100 + d;
    const guessOrd = civil.year * 10000 + civil.month * 100 + civil.day;
    const dayDiff = civilOrd - guessOrd;
    const secDiff = (hour - h) * 3600 + (minute - min) * 60 + (second - sec) + dayDiff * 86400;
    guessMs += secDiff * 1000;
  }

  return new Date(guessMs).toISOString();
}
