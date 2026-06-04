import {
  DEFAULT_TIMEZONE,
  TEMPORAL_NORMALIZER_ID,
  TEMPORAL_NORMALIZER_VERSION,
  type NormalizedTemporalValue,
  type TemporalNormalizationInput,
  type TemporalReasonCode,
} from '../types/temporal-normalization.js';
import { confidenceForReason } from '../utils/temporal/confidence.js';
import {
  anchorFromReceived,
  matchTemporalPattern,
  normalizeLiteralForMatch,
} from '../utils/temporal/patterns.js';
import { localDateTimeToInstant, parseReceivedInstant, resolveTimezone } from '../utils/temporal/anchor.js';

function baseResult(
  literal: string,
  timezone: string,
  timezoneSource: 'envelope' | 'default',
  overrides: Partial<NormalizedTemporalValue>,
): NormalizedTemporalValue {
  return {
    literal,
    status: 'not_applicable',
    precision: 'unknown',
    localDate: null,
    localTime: null,
    instant: null,
    timezone,
    timezoneSource,
    dueDateBoundary: null,
    implicitYear: false,
    implicitMonth: false,
    confidence: 0,
    reasonCode: 'no_temporal_tokens',
    reasonDetail: null,
    matchedPatternId: null,
    normalizerId: TEMPORAL_NORMALIZER_ID,
    normalizerVersion: TEMPORAL_NORMALIZER_VERSION,
    ...overrides,
  };
}

function resolvedDate(
  literal: string,
  timezone: string,
  timezoneSource: 'envelope' | 'default',
  localDate: string,
  reasonCode: TemporalReasonCode,
  matchedPatternId: string,
  implicitYear: boolean,
  implicitMonth: boolean,
): NormalizedTemporalValue {
  const confidence = confidenceForReason(reasonCode);
  return baseResult(literal, timezone, timezoneSource, {
    status: 'resolved',
    precision: 'date',
    localDate,
    localTime: null,
    instant: null,
    dueDateBoundary: null,
    implicitYear,
    implicitMonth,
    confidence,
    reasonCode,
    matchedPatternId,
  });
}

function resolvedDateTime(
  literal: string,
  timezone: string,
  timezoneSource: 'envelope' | 'default',
  localDate: string,
  localTime: string,
  reasonCode: TemporalReasonCode,
  matchedPatternId: string,
): NormalizedTemporalValue {
  const instant = localDateTimeToInstant(localDate, localTime, timezone);
  const confidence = confidenceForReason(reasonCode);
  return baseResult(literal, timezone, timezoneSource, {
    status: 'resolved',
    precision: 'datetime',
    localDate,
    localTime,
    instant,
    dueDateBoundary: 'exact',
    implicitYear: false,
    implicitMonth: false,
    confidence,
    reasonCode,
    matchedPatternId,
  });
}

export class TemporalNormalizerService {
  normalize(input: TemporalNormalizationInput): NormalizedTemporalValue {
    const literalRaw = input.literal ?? '';
    const literal = typeof literalRaw === 'string' ? literalRaw : String(literalRaw);

    if (!literal.trim()) {
      return baseResult(literal, DEFAULT_TIMEZONE, 'default', {
        status: 'not_applicable',
        reasonCode: 'empty_literal',
        confidence: confidenceForReason('empty_literal'),
      });
    }

    const tzResolved = resolveTimezone(input.timezone);
    if (!tzResolved) {
      return baseResult(literal, input.timezone?.trim() || '', 'envelope', {
        status: 'failed',
        precision: 'unknown',
        reasonCode: 'timezone_invalid',
        reasonDetail: `Invalid IANA timezone: ${input.timezone}`,
        confidence: confidenceForReason('timezone_invalid'),
        matchedPatternId: 'timezone_validation',
      });
    }

    const { timezone, timezoneSource } = tzResolved;

    let anchorInstant: Date;
    try {
      anchorInstant = parseReceivedInstant(input.receivedAt);
    } catch (e) {
      return baseResult(literal, timezone, timezoneSource, {
        status: 'failed',
        reasonCode: 'parse_error',
        reasonDetail: e instanceof Error ? e.message : String(e),
        confidence: confidenceForReason('parse_error'),
        matchedPatternId: 'received_at_parse',
      });
    }

    const anchor = anchorFromReceived(anchorInstant, timezone);
    const outcome = matchTemporalPattern(literal, anchor);

    if (outcome.kind === 'match') {
      const { result } = outcome;
      if (result.localTime) {
        return resolvedDateTime(
          literal,
          timezone,
          timezoneSource,
          result.localDate,
          result.localTime,
          result.reasonCode,
          result.matchedPatternId,
        );
      }
      return resolvedDate(
        literal,
        timezone,
        timezoneSource,
        result.localDate,
        result.reasonCode,
        result.matchedPatternId,
        result.implicitYear,
        result.implicitMonth,
      );
    }

    if (outcome.kind === 'ambiguous') {
      return baseResult(literal, timezone, timezoneSource, {
        status: 'ambiguous',
        precision: 'unknown',
        reasonCode: 'vague_expression',
        reasonDetail: outcome.reasonDetail,
        confidence: confidenceForReason('vague_expression'),
        matchedPatternId: outcome.matchedPatternId,
      });
    }

    if (outcome.kind === 'failed') {
      return baseResult(literal, timezone, timezoneSource, {
        status: 'failed',
        precision: 'unknown',
        reasonCode: outcome.reasonCode,
        confidence: confidenceForReason(outcome.reasonCode),
        matchedPatternId: outcome.matchedPatternId,
      });
    }

    if (outcome.kind === 'not_applicable') {
      return baseResult(literal, timezone, timezoneSource, {
        status: 'not_applicable',
        precision: 'unknown',
        reasonCode: outcome.reasonCode,
        confidence: confidenceForReason(outcome.reasonCode),
        matchedPatternId: outcome.matchedPatternId,
      });
    }

    const norm = normalizeLiteralForMatch(literal);
    if (norm.match(/^\d{1,2}h$/) || norm.match(/^(?:as|às)\s+\d/)) {
      return baseResult(literal, timezone, timezoneSource, {
        status: 'ambiguous',
        precision: 'time_only',
        reasonCode: 'missing_date',
        reasonDetail: 'time without date',
        confidence: confidenceForReason('missing_date'),
        matchedPatternId: 'time_only_unsupported',
      });
    }

    return baseResult(literal, timezone, timezoneSource, {
      status: 'not_applicable',
      reasonCode: 'no_temporal_tokens',
      confidence: confidenceForReason('no_temporal_tokens'),
      matchedPatternId: 'unmatched',
    });
  }
}

export function normalizeTemporal(input: TemporalNormalizationInput): NormalizedTemporalValue {
  return new TemporalNormalizerService().normalize(input);
}

/** Compiler integration when due_at is set but temporalAnchor is absent. */
export function buildMissingTemporalAnchorResult(literal: string): NormalizedTemporalValue {
  return {
    literal,
    status: 'failed',
    precision: 'unknown',
    localDate: null,
    localTime: null,
    instant: null,
    timezone: DEFAULT_TIMEZONE,
    timezoneSource: 'default',
    dueDateBoundary: null,
    implicitYear: false,
    implicitMonth: false,
    confidence: confidenceForReason('missing_temporal_anchor'),
    reasonCode: 'missing_temporal_anchor',
    reasonDetail: 'temporalAnchor is required to normalize due_at',
    matchedPatternId: 'missing_temporal_anchor',
    normalizerId: TEMPORAL_NORMALIZER_ID,
    normalizerVersion: TEMPORAL_NORMALIZER_VERSION,
  };
}
