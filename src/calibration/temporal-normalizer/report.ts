import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TemporalCalibrationReport } from './types.js';

export function writeCalibrationArtifacts(
  report: TemporalCalibrationReport,
  artifactsDir: string,
): { jsonPath: string; summaryPath: string } {
  mkdirSync(artifactsDir, { recursive: true });
  const jsonPath = join(artifactsDir, 'temporal-normalizer-v1-report.json');
  const summaryPath = join(artifactsDir, 'temporal-normalizer-v1-summary.md');

  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  writeFileSync(summaryPath, formatSummaryMarkdown(report), 'utf8');

  return { jsonPath, summaryPath };
}

export function formatSummaryMarkdown(report: TemporalCalibrationReport): string {
  const lines: string[] = [
    '# Temporal normalizer calibration summary',
    '',
    `**Executed at:** ${report.executedAt}`,
    `**Mode:** ${report.compareMode}`,
    `**Normalizer:** ${report.normalizerId} @ ${report.normalizerVersion}`,
    '',
    '## Results',
    '',
    `| Metric | Value |`,
    `|--------|-------|`,
    `| Total cases | ${report.totalCases} |`,
    `| Passed | ${report.passedCases} |`,
    `| Failed | ${report.failedCases} |`,
    `| Pass rate | ${(report.passRate * 100).toFixed(1)}% |`,
    '',
  ];

  if (report.compareMode === 'baseline') {
    lines.push(
      `**Baseline version:** ${report.baselineVersion ?? 'unknown'}`,
      `**Semantic diffs:** ${report.semanticDiffCount ?? report.failedCases}`,
      '',
    );
  }

  lines.push(
    '## Status counts',
    '',
    '| Status | Count |',
    '|--------|-------|',
  );
  for (const [status, count] of Object.entries(report.statusCounts)) {
    lines.push(`| ${status} | ${count} |`);
  }

  lines.push('', '## Observability', '', '| Metric | Count |', '|--------|-------|');
  lines.push(`| timezone default | ${report.timezoneDefaultCount} |`);
  lines.push(`| timezone invalid | ${report.timezoneInvalidCount} |`);
  lines.push(`| implicitYear | ${report.implicitYearCount} |`);
  lines.push(`| implicitMonth | ${report.implicitMonthCount} |`);

  lines.push('', '### Pattern counts', '', '| Pattern | Count |', '|---------|-------|');
  for (const [pattern, count] of Object.entries(report.patternCounts).sort((a, b) =>
    a[0].localeCompare(b[0]),
  )) {
    lines.push(`| ${pattern} | ${count} |`);
  }

  lines.push('', '### timezoneSource counts', '', '| Source | Count |', '|--------|-------|');
  for (const [source, count] of Object.entries(report.timezoneSourceCounts)) {
    lines.push(`| ${source} | ${count} |`);
  }

  lines.push('', '### reasonCode counts', '', '| reasonCode | Count |', '|------------|-------|');
  for (const [code, count] of Object.entries(report.reasonCodeCounts).sort((a, b) =>
    a[0].localeCompare(b[0]),
  )) {
    lines.push(`| ${code} | ${count} |`);
  }

  lines.push('', '### Confidence distribution', '', '| Bucket | Count |', '|--------|-------|');
  for (const [bucket, count] of Object.entries(report.confidenceDistribution).sort()) {
    lines.push(`| ${bucket} | ${count} |`);
  }

  if (report.failures.length > 0) {
    lines.push('', '## Failures', '');
    for (const f of report.failures) {
      lines.push(`### ${f.case_id}`, '', '```json', JSON.stringify({ input: f.input, diff: f.diff }, null, 2), '```', '');
    }
  } else {
    lines.push('', '## Failures', '', '_None._', '');
  }

  return `${lines.join('\n')}\n`;
}
