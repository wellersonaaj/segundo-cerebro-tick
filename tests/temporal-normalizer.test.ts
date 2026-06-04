import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compareToBaselineSnapshot, compareToFixtureExpected } from '../src/calibration/temporal-normalizer/compare.js';
import { loadTemporalCases, TEMPORAL_CASES_PATH } from '../src/calibration/temporal-normalizer/load-cases.js';
import { runTemporalCalibration, writeBaselineFromCases } from '../src/calibration/temporal-normalizer/run-calibration.js';
import { toSemanticSnapshot } from '../src/calibration/temporal-normalizer/snapshot.js';
import {
  normalizeTemporal,
  TemporalNormalizerService,
} from '../src/services/temporal-normalizer.service.js';
import {
  TEMPORAL_NORMALIZER_ID,
  TEMPORAL_NORMALIZER_VERSION,
} from '../src/types/temporal-normalization.js';
import type { TemporalNormalizationInput } from '../src/types/temporal-normalization.js';

const fixtureCases = loadTemporalCases();

describe('TemporalNormalizerService', () => {
  const service = new TemporalNormalizerService();

  describe('fixture matrix', () => {
    it.each(fixtureCases)('$id', ({ input, expected }) => {
      const result = service.normalize(input);
      const { passed, diff } = compareToFixtureExpected(expected, result);
      expect(diff, diff.join('\n')).toEqual([]);
      expect(passed).toBe(true);
      expect(result.literal).toBe(expected.literal ?? input.literal ?? '');
    });
  });

  it('preserves literal byte-for-byte including accents', () => {
    const literal = 'próxima sexta-feira';
    const result = service.normalize({
      literal,
      receivedAt: '2026-06-03T12:00:00-03:00',
      timezone: 'America/Sao_Paulo',
    });
    expect(result.literal).toBe(literal);
  });

  it('is deterministic across repeated calls', () => {
    const input: TemporalNormalizationInput = {
      literal: 'amanhã',
      receivedAt: '2026-06-03T15:00:00-03:00',
      timezone: 'America/Sao_Paulo',
    };
    const a = service.normalize(input);
    const b = service.normalize(input);
    expect(a).toEqual(b);
  });

  it('date-only resolved values never expose instant', () => {
    const result = service.normalize({
      literal: 'hoje',
      receivedAt: '2026-06-03T12:00:00-03:00',
      timezone: 'America/Sao_Paulo',
    });
    expect(result.status).toBe('resolved');
    expect(result.precision).toBe('date');
    expect(result.localDate).toBe('2026-06-03');
    expect(result.localTime).toBeNull();
    expect(result.instant).toBeNull();
    expect(result.dueDateBoundary).toBeNull();
  });

  it('datetime resolved values fill instant with exact boundary', () => {
    const result = service.normalize({
      literal: 'segunda-feira às 14:30',
      receivedAt: '2026-06-03T12:00:00-03:00',
      timezone: 'America/Sao_Paulo',
    });
    expect(result.status).toBe('resolved');
    expect(result.precision).toBe('datetime');
    expect(result.localDate).toBe('2026-06-08');
    expect(result.localTime).toBe('14:30:00');
    expect(result.instant).not.toBeNull();
    expect(result.dueDateBoundary).toBe('exact');
  });

  it('relative_with_time resolves amanhã às 10h as datetime', () => {
    const result = service.normalize({
      literal: 'amanhã às 10h',
      receivedAt: '2026-06-03T15:00:00-03:00',
      timezone: 'America/Sao_Paulo',
    });
    expect(result.status).toBe('resolved');
    expect(result.precision).toBe('datetime');
    expect(result.localDate).toBe('2026-06-04');
    expect(result.localTime).toBe('10:00:00');
    expect(result.instant).toBe('2026-06-04T13:00:00.000Z');
    expect(result.matchedPatternId).toBe('relative_with_time');
  });

  it('ambiguous, failed and not_applicable never set instant', () => {
    const cases: TemporalNormalizationInput[] = [
      {
        literal: 'no fim da semana',
        receivedAt: '2026-06-03T12:00:00-03:00',
        timezone: 'America/Sao_Paulo',
      },
      {
        literal: '31/02/2026',
        receivedAt: '2026-06-03T12:00:00-03:00',
        timezone: 'America/Sao_Paulo',
      },
      {
        literal: 'urgente',
        receivedAt: '2026-06-03T12:00:00-03:00',
        timezone: 'America/Sao_Paulo',
      },
    ];
    for (const input of cases) {
      expect(service.normalize(input).instant).toBeNull();
    }
  });

  it('exports normalizeTemporal helper', () => {
    const result = normalizeTemporal({
      literal: 'ontem',
      receivedAt: '2026-06-03T12:00:00-03:00',
      timezone: 'America/Sao_Paulo',
    });
    expect(result.normalizerId).toBe(TEMPORAL_NORMALIZER_ID);
    expect(result.normalizerVersion).toBe(TEMPORAL_NORMALIZER_VERSION);
    expect(result.localDate).toBe('2026-06-02');
  });

  it('invalid timezone fails without fallback', () => {
    const result = service.normalize({
      literal: 'hoje',
      receivedAt: '2026-06-03T12:00:00-03:00',
      timezone: 'Invalid/Zone',
    });
    expect(result.status).toBe('failed');
    expect(result.reasonCode).toBe('timezone_invalid');
    expect(result.localDate).toBeNull();
    expect(result.instant).toBeNull();
  });
});

describe('temporal fixture count', () => {
  it('has at least 45 cases', () => {
    expect(fixtureCases.length).toBeGreaterThanOrEqual(45);
  });

  it('loads from canonical data path', () => {
    expect(TEMPORAL_CASES_PATH).toContain('data/calibration/temporal-normalizer/cases.json');
  });
});

describe('temporal calibration runner', () => {
  it('exits 0 when fixtures match (default mode)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'temporal-cal-'));
    const result = runTemporalCalibration({ artifactsDir: dir });
    expect(result.exitCode).toBe(0);
    expect(result.report.failedCases).toBe(0);
    expect(result.report.compareMode).toBe('fixtures');
    expect(result.report.normalizerVersion).toBe(TEMPORAL_NORMALIZER_VERSION);
    const reportJson = JSON.parse(readFileSync(result.jsonPath, 'utf8')) as {
      normalizerVersion: string;
    };
    expect(reportJson.normalizerVersion).toBe(TEMPORAL_NORMALIZER_VERSION);
  });

  it('detects semantic diff against baseline snapshot', () => {
    const service = new TemporalNormalizerService();
    const cases = loadTemporalCases();
    const results = cases.map((c) => service.normalize(c.input));
    const snapshot = toSemanticSnapshot(results[0]!);
    const tampered = { ...snapshot, localDate: '2099-01-01' };
    const { passed, diff } = compareToBaselineSnapshot(tampered, results[0]!);
    expect(passed).toBe(false);
    expect(diff.some((d) => d.startsWith('localDate:'))).toBe(true);
  });

  it('ignores reasonDetail in baseline semantic compare', () => {
    const service = new TemporalNormalizerService();
    const actual = service.normalize({
      literal: 'Foo/Bar',
      receivedAt: '2026-06-03T12:00:00-03:00',
      timezone: 'Foo/Bar',
    });
    const baseline = toSemanticSnapshot(actual);
    const withDetail = {
      ...actual,
      reasonDetail: 'diagnostic only change',
    };
    const { passed } = compareToBaselineSnapshot(baseline, withDetail);
    expect(passed).toBe(true);
  });

  it('baseline compare passes when frozen baseline matches current normalizer', () => {
    const dir = mkdtempSync(join(tmpdir(), 'temporal-base-'));
    const baselinePath = join(dir, 'baseline.json');
    const cases = loadTemporalCases();
    const service = new TemporalNormalizerService();
    const results = cases.map((c) => service.normalize(c.input));
    writeBaselineFromCases(cases, results, baselinePath);

    const result = runTemporalCalibration({
      compareBaseline: true,
      baselinePath,
      artifactsDir: dir,
    });
    expect(result.exitCode).toBe(0);
    expect(result.report.compareMode).toBe('baseline');
  });

  it('includes relative_with_time in canonical cases', () => {
    const rel = fixtureCases.filter((c) =>
      c.expected.matchedPatternId === 'relative_with_time' || c.id.startsWith('rel-amanha-as'),
    );
    expect(rel.length).toBeGreaterThanOrEqual(4);
  });
});
