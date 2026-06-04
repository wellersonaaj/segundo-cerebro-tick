import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TemporalNormalizerService } from '../../services/temporal-normalizer.service.js';
import {
  TEMPORAL_NORMALIZER_ID,
  TEMPORAL_NORMALIZER_VERSION,
} from '../../types/temporal-normalization.js';
import { compareToBaselineSnapshot, compareToFixtureExpected } from './compare.js';
import { loadTemporalBaseline, loadTemporalCases, TEMPORAL_BASELINE_PATH } from './load-cases.js';
import { buildCalibrationReport } from './metrics.js';
import { writeCalibrationArtifacts } from './report.js';
import { toSemanticSnapshot } from './snapshot.js';
import type {
  CaseComparisonFailure,
  TemporalBaselineFile,
  TemporalCalibrationCase,
} from './types.js';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '../../..');

export interface RunTemporalCalibrationOptions {
  compareBaseline?: boolean;
  writeBaseline?: boolean;
  casesPath?: string;
  baselinePath?: string;
  artifactsDir?: string;
}

export interface RunTemporalCalibrationResult {
  report: ReturnType<typeof buildCalibrationReport>;
  exitCode: number;
  jsonPath: string;
  summaryPath: string;
}

export function runTemporalCalibration(
  options: RunTemporalCalibrationOptions = {},
): RunTemporalCalibrationResult {
  const service = new TemporalNormalizerService();
  const cases = loadTemporalCases(options.casesPath);
  const failures: CaseComparisonFailure[] = [];
  const results = cases.map((c) => service.normalize(c.input));

  if (options.writeBaseline) {
    writeBaselineFromCases(cases, results, options.baselinePath ?? TEMPORAL_BASELINE_PATH);
  }

  if (options.compareBaseline) {
    const baseline = loadTemporalBaseline(options.baselinePath);
    const byId = new Map(baseline.cases.map((c) => [c.case_id, c]));

    for (let i = 0; i < cases.length; i++) {
      const testCase = cases[i]!;
      const actual = results[i]!;
      const frozen = byId.get(testCase.id);
      if (!frozen) {
        failures.push({
          case_id: testCase.id,
          input: testCase.input,
          expected: testCase.expected,
          actual,
          diff: ['baseline: case_id missing from frozen baseline'],
        });
        continue;
      }
      const { passed, diff } = compareToBaselineSnapshot(frozen.snapshot, actual);
      if (!passed) {
        failures.push({
          case_id: testCase.id,
          input: testCase.input,
          expected: frozen.snapshot,
          actual,
          diff,
        });
      }
    }

    const report = buildCalibrationReport({
      results,
      failures,
      compareMode: 'baseline',
      baselineVersion: baseline.normalizerVersion,
      semanticDiffCount: failures.length,
    });

    const { jsonPath, summaryPath } = writeCalibrationArtifacts(
      report,
      options.artifactsDir ?? join(packageRoot, 'artifacts/calibration'),
    );

    return {
      report,
      exitCode: failures.length > 0 ? 1 : 0,
      jsonPath,
      summaryPath,
    };
  }

  for (let i = 0; i < cases.length; i++) {
    const testCase = cases[i]!;
    const actual = results[i]!;
    const { passed, diff } = compareToFixtureExpected(testCase.expected, actual);
    if (!passed) {
      failures.push({
        case_id: testCase.id,
        input: testCase.input,
        expected: testCase.expected,
        actual,
        diff,
      });
    }
  }

  const report = buildCalibrationReport({
    results,
    failures,
    compareMode: 'fixtures',
  });

  const { jsonPath, summaryPath } = writeCalibrationArtifacts(
    report,
    options.artifactsDir ?? join(packageRoot, 'artifacts/calibration'),
  );

  return {
    report,
    exitCode: failures.length > 0 ? 1 : 0,
    jsonPath,
    summaryPath,
  };
}

export function writeBaselineFromCases(
  cases: TemporalCalibrationCase[],
  results: ReturnType<TemporalNormalizerService['normalize']>[],
  baselinePath: string,
): TemporalBaselineFile {
  const baseline: TemporalBaselineFile = {
    normalizerId: TEMPORAL_NORMALIZER_ID,
    normalizerVersion: TEMPORAL_NORMALIZER_VERSION,
    frozenAt: new Date().toISOString(),
    cases: cases.map((c, i) => {
      const actual = results[i]!;
      return {
        case_id: c.id,
        input: {
          literal: c.input.literal ?? '',
          receivedAt: c.input.receivedAt,
          timezone: c.input.timezone,
        },
        snapshot: toSemanticSnapshot(actual),
      };
    }),
  };

  writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`, 'utf8');
  return baseline;
}
