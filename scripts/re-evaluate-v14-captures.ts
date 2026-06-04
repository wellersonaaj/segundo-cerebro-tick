/**
 * Re-evaluate live captures on disk (no OpenAI) after metric/CM/evaluator fixes.
 *
 *   tsx scripts/re-evaluate-v14-captures.ts
 *   tsx scripts/re-evaluate-v14-captures.ts --captures-dir=artifacts/calibration/extractor-v1.4-live-runs/<run_id>/captures
 */

import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildCaseFileFromLiveCapture,
  type LiveV14CaptureForReeval,
} from '../src/calibration/extractor-v1.4/live-capture-reeval.js';
import {
  accumulateV14Metrics,
  checkV14Thresholds,
  createV14MetricsAccumulator,
  finalizeV14Metrics,
} from '../src/calibration/extractor-v1.4/live-metrics.js';
import { resolveExpected } from '../src/calibration/extractor-v1.4/live-audit-detail.js';
import {
  evaluateSemanticGate,
  SEMANTIC_GATE_THRESHOLDS,
} from '../src/calibration/extractor-v1.4/semantic-gate.js';
import {
  accumulateContextRegimeMetrics,
  createContextRegimeAccumulator,
  finalizeContextRegimeMetrics,
} from '../src/calibration/extractor-v1.4/context-regime-metrics.js';
import { runV14ContextPipeline } from '../src/calibration/extractor-v1.4/run-v14-context-pipeline.js';
import type { RegistryEntityFixture } from '../src/services/reference-resolver.service.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const capturesDirArg = process.argv.find((a) => a.startsWith('--captures-dir='));
const capturesDir = capturesDirArg
  ? join(root, capturesDirArg.split('=')[1]!)
  : join(root, 'artifacts/calibration/extractor-v1.4-live-captures');
const reportPathArg = process.argv.find((a) => a.startsWith('--report-path='));
const reportPath = reportPathArg
  ? join(root, reportPathArg.split('=')[1]!)
  : join(root, 'artifacts/calibration/extractor-v1.4-offline-reeval-report.json');

const categoriesArg = process.argv.find((a) => a.startsWith('--categories='));
const categoriesFilter = categoriesArg
  ? categoriesArg.split('=')[1]!.split(',').map((s) => s.trim())
  : [];

const registry = JSON.parse(
  readFileSync(join(root, 'data/calibration/extractor-v1.4/registry-fixture.json'), 'utf8'),
) as { entities: RegistryEntityFixture[] };

const captures = readdirSync(capturesDir)
  .filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(readFileSync(join(capturesDir, f), 'utf8')) as LiveV14CaptureForReeval)
  .filter((c) => categoriesFilter.length === 0 || categoriesFilter.includes(c.category));

const acc = createV14MetricsAccumulator();
const contextAcc = createContextRegimeAccumulator();
const byCategory: Record<string, { passed: number; total: number }> = {};
const failures: Array<{ scenario_id: string; category: string; failures: string[] }> = [];

for (const capture of captures) {
  const expected = resolveExpected(capture.category, capture.repetition_index);
  const caseFile = buildCaseFileFromLiveCapture(capture);

  const pipeline = runV14ContextPipeline({
    scenarioId: capture.scenario_id,
    extractorOutput: capture.extractor_output,
    expected,
    caseFile,
    registryEntities: registry.entities,
    evaluationCategory: capture.category,
  });

  const { compiled, recommended, clarificationMateriality, evaluation } = pipeline;

  accumulateContextRegimeMetrics(
    contextAcc,
    expected.regime ?? caseFile.regime,
    expected,
    capture.extractor_output,
    compiled,
    recommended,
  );

  accumulateV14Metrics(
    acc,
    expected,
    capture.extractor_output,
    compiled,
    evaluation,
    recommended.length,
    capture.effective_input,
    capture.category,
    recommended,
    clarificationMateriality,
  );

  byCategory[capture.category] ??= { passed: 0, total: 0 };
  byCategory[capture.category]!.total += 1;
  if (evaluation.passed) {
    byCategory[capture.category]!.passed += 1;
  } else {
    failures.push({
      scenario_id: capture.scenario_id,
      category: capture.category,
      failures: evaluation.failures,
    });
  }
}

const metrics = finalizeV14Metrics(acc);
const contextMetrics = finalizeContextRegimeMetrics(contextAcc);
const legacyThresholds = checkV14Thresholds(metrics, acc);
const semanticGate = evaluateSemanticGate(acc, metrics, contextAcc, contextMetrics);
const casePassed = captures.length - failures.length;
const casePassRate = captures.length === 0 ? 1 : casePassed / captures.length;

const report = {
  generated_at: new Date().toISOString(),
  captures_dir: capturesDir,
  total_captures: captures.length,
  case_pass_rate: Math.round(casePassRate * 1000) / 1000,
  case_passed: casePassed,
  by_category: byCategory,
  metrics,
  context_metrics: contextMetrics,
  semantic_gate: semanticGate,
  legacy_thresholds: legacyThresholds,
  failed_cases: failures,
  thresholds: SEMANTIC_GATE_THRESHOLDS,
};

mkdirSync(dirname(reportPath), { recursive: true });
writeFileSync(reportPath, JSON.stringify(report, null, 2));

console.log('Captures:', captures.length);
console.log('Case pass rate:', `${casePassed}/${captures.length}`);
console.log('By category:', byCategory);
console.log('negation_error_rate:', metrics.negation_error_rate);
console.log('false_blocking_clarification_rate:', metrics.false_blocking_clarification_rate);
console.log('Semantic gate:', semanticGate.all_passed ? 'PASS' : 'FAIL', semanticGate.failed_metrics);
console.log('Report:', reportPath);

if (failures.length > 0) {
  console.log('Failures:', failures.slice(0, 20));
  process.exit(1);
}
