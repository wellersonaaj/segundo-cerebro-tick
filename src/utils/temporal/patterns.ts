import {
  addDays,
  compareCivilDates,
  formatCivilDate,
  formatLocalTime,
  getCivilDate,
  isoWeekday,
  isValidCivilDate,
  startOfIsoWeek,
  type CivilDate,
} from './anchor.js';

export const WEEKDAY_NAMES = [
  'domingo',
  'segunda',
  'terca',
  'terça',
  'quarta',
  'quinta',
  'sexta',
  'sabado',
  'sábado',
] as const;

/** ISO weekday 1=Monday … 7=Sunday */
export const WEEKDAY_TO_ISO: Record<string, number> = {
  segunda: 1,
  terca: 2,
  terça: 2,
  quarta: 3,
  quinta: 4,
  sexta: 5,
  sabado: 6,
  sábado: 6,
  domingo: 7,
};

export interface PatternMatchResult {
  matchedPatternId: string;
  localDate: string;
  localTime: string | null;
  reasonCode:
    | 'relative_day_resolved'
    | 'weekday_resolved'
    | 'weekday_this_week_resolved'
    | 'weekday_next_week_resolved'
    | 'absolute_date_resolved'
    | 'absolute_datetime_resolved'
    | 'partial_date_inferred_year'
    | 'partial_date_inferred_month';
  implicitYear: boolean;
  implicitMonth: boolean;
}

export type PatternOutcome =
  | { kind: 'match'; result: PatternMatchResult }
  | { kind: 'ambiguous'; matchedPatternId: string; reasonDetail: string }
  | { kind: 'failed'; matchedPatternId: string; reasonCode: 'impossible_date' | 'impossible_time' }
  | { kind: 'not_applicable'; matchedPatternId: string; reasonCode: 'no_temporal_tokens' | 'vague_expression' }
  | { kind: 'none' };

export function normalizeLiteralForMatch(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

function weekdayFromToken(token: string): number | null {
  const t = token.replace(/-feira$/, '').replace(/-feiras$/, '');
  return WEEKDAY_TO_ISO[t] ?? null;
}

function civilFromIsoWeekday(anchor: CivilDate, targetIso: number): CivilDate {
  const anchorIso = isoWeekday(anchor);
  let delta = targetIso - anchorIso;
  if (delta <= 0) delta += 7;
  return addDays(anchor, delta);
}

function nextStrictWeekday(anchor: CivilDate, targetIso: number): CivilDate {
  const anchorIso = isoWeekday(anchor);
  if (anchorIso === targetIso) {
    return addDays(anchor, 7);
  }
  return civilFromIsoWeekday(anchor, targetIso);
}

function thisWeekWeekday(anchor: CivilDate, targetIso: number): CivilDate {
  const monday = startOfIsoWeek(anchor);
  const target = addDays(monday, targetIso - 1);
  if (compareCivilDates(target, anchor) < 0) {
    return nextStrictWeekday(anchor, targetIso);
  }
  return target;
}

function nextWeekWeekday(anchor: CivilDate, targetIso: number): CivilDate {
  const monday = startOfIsoWeek(anchor);
  const nextMonday = addDays(monday, 7);
  return addDays(nextMonday, targetIso - 1);
}

function parseTimeFromGroups(hour: string, minute?: string): { time: string } | { error: 'impossible_time' } {
  const h = Number(hour);
  const m = minute != null ? Number(minute) : 0;
  if (h < 0 || h > 23 || m < 0 || m > 59) {
    return { error: 'impossible_time' };
  }
  return { time: formatLocalTime(h, m) };
}

const VAGUE_AMBIGUOUS = new Set(['no fim da semana']);
const VAGUE_NOT_APPLICABLE = new Set([
  'mais tarde',
  'depois',
  'em breve',
  'na proxima etapa',
]);

const RELATIVE_DAYS: Record<string, number> = {
  hoje: 0,
  ontem: -1,
  amanha: 1,
  amanhã: 1,
};

export function matchTemporalPattern(
  literal: string,
  anchor: CivilDate,
): PatternOutcome {
  const norm = normalizeLiteralForMatch(literal);

  if (VAGUE_AMBIGUOUS.has(norm)) {
    return { kind: 'ambiguous', matchedPatternId: 'vague_ambiguous', reasonDetail: norm };
  }
  if (VAGUE_NOT_APPLICABLE.has(norm)) {
    return {
      kind: 'not_applicable',
      matchedPatternId: 'vague_not_applicable',
      reasonCode: norm === 'na proxima etapa' ? 'no_temporal_tokens' : 'vague_expression',
    };
  }

  const relativeOffset = RELATIVE_DAYS[norm];
  if (relativeOffset !== undefined) {
    const date = addDays(anchor, relativeOffset);
    return {
      kind: 'match',
      result: {
        matchedPatternId: 'relative_day',
        localDate: formatCivilDate(date),
        localTime: null,
        reasonCode: 'relative_day_resolved',
        implicitYear: false,
        implicitMonth: false,
      },
    };
  }

  const nextWeekRe =
    /^(?:proxima|próxima)\s+(segunda|terca|terça|quarta|quinta|sexta|sabado|sábado|domingo)(?:-feira)?$/;
  const nextWeekMatch = norm.match(nextWeekRe);
  if (nextWeekMatch?.[1]) {
    const iso = weekdayFromToken(nextWeekMatch[1]);
    if (iso == null) return { kind: 'none' };
    const date = nextWeekWeekday(anchor, iso);
    return {
      kind: 'match',
      result: {
        matchedPatternId: 'weekday_next_week',
        localDate: formatCivilDate(date),
        localTime: null,
        reasonCode: 'weekday_next_week_resolved',
        implicitYear: false,
        implicitMonth: false,
      },
    };
  }

  const thisWeekRe =
    /^(?:esta|essa)\s+(segunda|terca|terça|quarta|quinta|sexta|sabado|sábado|domingo)(?:-feira)?$/;
  const thisWeekMatch = norm.match(thisWeekRe);
  if (thisWeekMatch?.[1]) {
    const iso = weekdayFromToken(thisWeekMatch[1]);
    if (iso == null) return { kind: 'none' };
    const date = thisWeekWeekday(anchor, iso);
    return {
      kind: 'match',
      result: {
        matchedPatternId: 'weekday_this_week',
        localDate: formatCivilDate(date),
        localTime: null,
        reasonCode: 'weekday_this_week_resolved',
        implicitYear: false,
        implicitMonth: false,
      },
    };
  }

  const weekdayTimeRe =
    /^(segunda|terca|terça|quarta|quinta|sexta|sabado|sábado|domingo)(?:-feira)?\s+(?:as|às)\s+(\d{1,2})(?::(\d{2}))?\s*(?:h)?$/;
  const weekdayTimeAltRe =
    /^(segunda|terca|terça|quarta|quinta|sexta|sabado|sábado|domingo)(?:-feira)?\s+(\d{1,2})(?::(\d{2}))?\s*h$/;
  const weekdayTimeMatch = norm.match(weekdayTimeRe) ?? norm.match(weekdayTimeAltRe);
  if (weekdayTimeMatch?.[1] && weekdayTimeMatch[2]) {
    const iso = weekdayFromToken(weekdayTimeMatch[1]);
    if (iso == null) return { kind: 'none' };
    const parsed = parseTimeFromGroups(weekdayTimeMatch[2], weekdayTimeMatch[3]);
    if ('error' in parsed) {
      return { kind: 'failed', matchedPatternId: 'weekday_with_time', reasonCode: 'impossible_time' };
    }
    const date = nextStrictWeekday(anchor, iso);
    return {
      kind: 'match',
      result: {
        matchedPatternId: 'weekday_with_time',
        localDate: formatCivilDate(date),
        localTime: parsed.time,
        reasonCode: 'absolute_datetime_resolved',
        implicitYear: false,
        implicitMonth: false,
      },
    };
  }

  const plainWeekdayRe =
    /^(segunda|terca|terça|quarta|quinta|sexta|sabado|sábado|domingo)(?:-feira)?$/;
  const plainWeekdayMatch = norm.match(plainWeekdayRe);
  if (plainWeekdayMatch?.[1]) {
    const iso = weekdayFromToken(plainWeekdayMatch[1]);
    if (iso == null) return { kind: 'none' };
    const date = nextStrictWeekday(anchor, iso);
    return {
      kind: 'match',
      result: {
        matchedPatternId: 'weekday_plain',
        localDate: formatCivilDate(date),
        localTime: null,
        reasonCode: 'weekday_resolved',
        implicitYear: false,
        implicitMonth: false,
      },
    };
  }

  const fullDateRe = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
  const fullDateMatch = norm.match(fullDateRe);
  if (fullDateMatch) {
    const day = Number(fullDateMatch[1]);
    const month = Number(fullDateMatch[2]);
    const year = Number(fullDateMatch[3]);
    const civil: CivilDate = { year, month, day };
    if (!isValidCivilDate(civil)) {
      return { kind: 'failed', matchedPatternId: 'absolute_date_dmy', reasonCode: 'impossible_date' };
    }
    return {
      kind: 'match',
      result: {
        matchedPatternId: 'absolute_date_dmy',
        localDate: formatCivilDate(civil),
        localTime: null,
        reasonCode: 'absolute_date_resolved',
        implicitYear: false,
        implicitMonth: false,
      },
    };
  }

  const partialDmRe = /^(\d{1,2})\/(\d{1,2})$/;
  const partialDmMatch = norm.match(partialDmRe);
  if (partialDmMatch) {
    const day = Number(partialDmMatch[1]);
    const month = Number(partialDmMatch[2]);
    let year = anchor.year;
    let civil: CivilDate = { year, month, day };
    if (!isValidCivilDate(civil)) {
      return { kind: 'failed', matchedPatternId: 'partial_date_dm', reasonCode: 'impossible_date' };
    }
    if (compareCivilDates(civil, anchor) < 0) {
      year += 1;
      civil = { year, month, day };
      if (!isValidCivilDate(civil)) {
        return { kind: 'failed', matchedPatternId: 'partial_date_dm', reasonCode: 'impossible_date' };
      }
    }
    return {
      kind: 'match',
      result: {
        matchedPatternId: 'partial_date_dm',
        localDate: formatCivilDate(civil),
        localTime: null,
        reasonCode: 'partial_date_inferred_year',
        implicitYear: true,
        implicitMonth: false,
      },
    };
  }

  const dayOnlyRe = /^dia\s+(\d{1,2})$/;
  const dayOnlyMatch = norm.match(dayOnlyRe);
  if (dayOnlyMatch) {
    const day = Number(dayOnlyMatch[1]);
    let month = anchor.month;
    let year = anchor.year;
    let civil: CivilDate = { year, month, day };
    if (!isValidCivilDate(civil)) {
      return { kind: 'failed', matchedPatternId: 'partial_day_of_month', reasonCode: 'impossible_date' };
    }
    if (compareCivilDates(civil, anchor) < 0) {
      month += 1;
      if (month > 12) {
        month = 1;
        year += 1;
      }
      civil = { year, month, day };
      if (!isValidCivilDate(civil)) {
        return { kind: 'failed', matchedPatternId: 'partial_day_of_month', reasonCode: 'impossible_date' };
      }
    }
    return {
      kind: 'match',
      result: {
        matchedPatternId: 'partial_day_of_month',
        localDate: formatCivilDate(civil),
        localTime: null,
        reasonCode: 'partial_date_inferred_month',
        implicitYear: false,
        implicitMonth: true,
      },
    };
  }

  const relativeWithBadTime =
    /^(hoje|ontem|amanha)\s+(?:as|às)\s+(\d{1,2})(?::(\d{2}))?\s*(?:h)?$/;
  const relativeBadMatch = norm.match(relativeWithBadTime);
  if (relativeBadMatch?.[1] && relativeBadMatch[2]) {
    const parsed = parseTimeFromGroups(relativeBadMatch[2], relativeBadMatch[3]);
    if ('error' in parsed) {
      return { kind: 'failed', matchedPatternId: 'relative_with_time', reasonCode: 'impossible_time' };
    }
    const offset = RELATIVE_DAYS[relativeBadMatch[1]] ?? 0;
    const date = addDays(anchor, offset);
    return {
      kind: 'match',
      result: {
        matchedPatternId: 'relative_with_time',
        localDate: formatCivilDate(date),
        localTime: parsed.time,
        reasonCode: 'absolute_datetime_resolved',
        implicitYear: false,
        implicitMonth: false,
      },
    };
  }

  const relativeCompactTimeRe = /^(hoje|ontem|amanha)\s+(\d{1,2})(?::(\d{2}))?\s*h$/;
  const relativeCompactMatch = norm.match(relativeCompactTimeRe);
  if (relativeCompactMatch?.[1] && relativeCompactMatch[2]) {
    const parsed = parseTimeFromGroups(relativeCompactMatch[2], relativeCompactMatch[3]);
    if ('error' in parsed) {
      return { kind: 'failed', matchedPatternId: 'relative_with_time', reasonCode: 'impossible_time' };
    }
    const offset = RELATIVE_DAYS[relativeCompactMatch[1]] ?? 0;
    const date = addDays(anchor, offset);
    return {
      kind: 'match',
      result: {
        matchedPatternId: 'relative_with_time',
        localDate: formatCivilDate(date),
        localTime: parsed.time,
        reasonCode: 'absolute_datetime_resolved',
        implicitYear: false,
        implicitMonth: false,
      },
    };
  }

  return { kind: 'none' };
}

export function anchorFromReceived(instant: Date, timezone: string): CivilDate {
  return getCivilDate(instant, timezone);
}
