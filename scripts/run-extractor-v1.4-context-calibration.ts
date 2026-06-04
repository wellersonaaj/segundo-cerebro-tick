/**
 * Context calibration (4D): fixture extractor → context resolver → compiler → CM.
 * No OpenAI. No database.
 *
 *   npm run test:extractor:v1.4:context
 */

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  accumulateContextRegimeMetrics,
  CONTEXT_REGIME_THRESHOLDS,
  createContextRegimeAccumulator,
  finalizeContextRegimeMetrics,
} from '../src/calibration/extractor-v1.4/context-regime-metrics.js';
import { FIXED_CALIBRATION_EXPECTATIONS } from '../src/calibration/extractor-v1.4/fixed-calibration-expectations.js';
import { FIXED_EXTRACTOR_FIXTURES } from '../src/calibration/extractor-v1.4/fixed-extractor-fixtures.js';
import {
  runV14ContextPipeline,
  type V14ContextCaseFile,
} from '../src/calibration/extractor-v1.4/run-v14-context-pipeline.js';
import type { RegistryEntityFixture } from '../src/services/reference-resolver.service.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const casesDir = join(root, 'data/calibration/extractor-v1.4/cases');

const CONTEXT_SCENARIOS = new Set([
  'v14-fc-task-new',
  'v14-fc-project-new',
  'v14-fc-status-new',
  'v14-fc-blocked-new',
  'v14-ctx-due-date-unique',
  'v14-ctx-assignee-unique',
  'v14-ctx-complete-unique',
  'v14-ctx-due-date-ambiguous',
]);

function main(): void {
  const registry = JSON.parse(
    readFileSync(join(root, 'data/calibration/extractor-v1.4/registry-fixture.json'), 'utf8'),
  ) as { entities: RegistryEntityFixture[] };

  const regimeAcc = createContextRegimeAccumulator();
  let passed = 0;
  let total = 0;
  const failures: string[] = [];
  const byRegime: Record<string, { passed: number; total: number }> = {};

  for (const file of readdirSync(casesDir).filter((f) => f.endsWith('.json'))) {
    const caseFile = JSON.parse(
      readFileSync(join(casesDir, file), 'utf8'),
    ) as V14ContextCaseFile;
    if (!CONTEXT_SCENARIOS.has(caseFile.scenario_id)) continue;

    total += 1;
    const expected = FIXED_CALIBRATION_EXPECTATIONS[caseFile.scenario_id];
    const extractorOutput = FIXED_EXTRACTOR_FIXTURES[caseFile.scenario_id];
    if (!expected || !extractorOutput) {
      failures.push(`${caseFile.scenario_id}: missing fixture or expectations`);
      continue;
    }

    const result = runV14ContextPipeline({
      scenarioId: caseFile.scenario_id,
      extractorOutput,
      expected,
      caseFile,
      registryEntities: registry.entities,
    });

    accumulateContextRegimeMetrics(
      regimeAcc,
      expected.regime ?? caseFile.regime,
      expected,
      extractorOutput,
      result.compiled,
      result.recommended,
    );

    const regime = expected.regime ?? caseFile.regime ?? 'unknown';
    byRegime[regime] ??= { passed: 0, total: 0 };
    byRegime[regime].total += 1;

    if (result.evaluation.passed) {
      passed += 1;
      byRegime[regime].passed += 1;
      console.log(`✓ ${caseFile.scenario_id} (${regime})`);
    } else {
      failures.push(`${caseFile.scenario_id}: ${result.evaluation.failures.join('; ')}`);
      console.log(`✗ ${caseFile.scenario_id}: ${result.evaluation.failures.join('; ')}`);
    }
  }

  const metrics = finalizeContextRegimeMetrics(regimeAcc);
  console.log('\n=== Context calibration 4D ===');
  console.log(`Cases: ${passed}/${total} passed`);
  console.log('By regime:', byRegime);
  console.log('Metrics:', metrics);

  const reportPath = join(root, 'artifacts/calibration/extractor-v1.4-context-report.md');
  const md = `# Bloco 4D — Context calibration report

Generated: ${new Date().toISOString()}

## Pass rate by regime

| Regime | Passed | Total |
|--------|--------|-------|
${Object.entries(byRegime)
  .map(([r, s]) => `| ${r} | ${s.passed} | ${s.total} |`)
  .join('\n')}

## Metrics

| Metric | Value | Threshold |
|--------|-------|-----------|
| first_contact_false_blocking_rate | ${metrics.first_contact_false_blocking_rate} | <= ${CONTEXT_REGIME_THRESHOLDS.first_contact_false_blocking_rate} |
| incremental_update_false_blocking_rate | ${metrics.incremental_update_false_blocking_rate} | <= ${CONTEXT_REGIME_THRESHOLDS.incremental_update_false_blocking_rate} |
| task_signal_emission_recall | ${metrics.task_signal_emission_recall} | >= ${CONTEXT_REGIME_THRESHOLDS.task_signal_emission_recall} |
| context_resolution_success_rate | ${metrics.context_resolution_success_rate} | >= ${CONTEXT_REGIME_THRESHOLDS.context_resolution_success_rate} |
| true_ambiguity_clarification_recall | ${metrics.true_ambiguity_clarification_recall} | >= ${CONTEXT_REGIME_THRESHOLDS.true_ambiguity_clarification_recall} |

## Cases

${failures.length === 0 ? 'All context cases passed.' : failures.map((f) => `- ${f}`).join('\n')}
`;
  writeFileSync(reportPath, md, 'utf8');
  console.log(`Report: ${reportPath}`);

  if (failures.length > 0) {
    process.exit(1);
  }
}

main();
