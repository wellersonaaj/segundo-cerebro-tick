import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { TemporalBaselineFile, TemporalCalibrationCase } from './types.js';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '../../..');

export const TEMPORAL_CASES_PATH = join(
  packageRoot,
  'data/calibration/temporal-normalizer/cases.json',
);

export const TEMPORAL_BASELINE_PATH = join(
  packageRoot,
  'data/calibration/temporal-normalizer/v1.0.0-baseline.json',
);

export function loadTemporalCases(path: string = TEMPORAL_CASES_PATH): TemporalCalibrationCase[] {
  const raw = JSON.parse(readFileSync(path, 'utf8')) as TemporalCalibrationCase[];
  return raw;
}

export function loadTemporalBaseline(path: string = TEMPORAL_BASELINE_PATH): TemporalBaselineFile {
  return JSON.parse(readFileSync(path, 'utf8')) as TemporalBaselineFile;
}
