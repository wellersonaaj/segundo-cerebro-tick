/**
 * Offline calibration for TemporalNormalizer v1.
 * No OpenAI. No database.
 *
 *   npm run calibrate:temporal:normalizer
 *   npm run calibrate:temporal:normalizer -- --compare-baseline
 *   npm run calibrate:temporal:normalizer -- --write-baseline
 */

import { runTemporalCalibration } from '../src/calibration/temporal-normalizer/run-calibration.js';

function parseArgs(argv: string[]): {
  compareBaseline: boolean;
  writeBaseline: boolean;
} {
  return {
    compareBaseline: argv.includes('--compare-baseline'),
    writeBaseline: argv.includes('--write-baseline'),
  };
}

function main(): void {
  const { compareBaseline, writeBaseline } = parseArgs(process.argv.slice(2));

  if (compareBaseline && writeBaseline) {
    console.error('Use either --compare-baseline or --write-baseline, not both.');
    process.exit(1);
  }

  const { report, exitCode, jsonPath, summaryPath } = runTemporalCalibration({
    compareBaseline,
    writeBaseline,
  });

  const modeLabel = compareBaseline ? 'baseline compare' : 'fixtures';
  console.log(
    `\n=== Temporal normalizer calibration (${modeLabel}) @ ${report.normalizerVersion} ===`,
  );
  console.log(`Cases: ${report.passedCases}/${report.totalCases} passed`);
  console.log(`Report: ${jsonPath}`);
  console.log(`Summary: ${summaryPath}`);

  if (report.failures.length > 0) {
    console.log('\nFailures:');
    for (const f of report.failures) {
      console.log(`  ✗ ${f.case_id}`);
      for (const line of f.diff) {
        console.log(`      ${line}`);
      }
    }
    process.exit(1);
  }

  console.log('\nAll cases passed.');
  process.exit(exitCode);
}

main();
