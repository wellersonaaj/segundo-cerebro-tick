import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { buildCurrentOutput, viewForEvaluation } from '../src/calibration/compiler-v1/build-current-output.js';
import {
  aggregateEntityPrecision,
  auditEntityPrecision,
} from '../src/calibration/compiler-v1/entity-audit.js';
import {
  buildComparativeMetrics,
  mapToComparativeCategory,
  type ComparativeCategory,
  type MetricSlice,
} from '../src/calibration/compiler-v1/comparative-metrics.js';
import { evaluateCase } from '../src/calibration/compiler-v1/evaluate-case.js';
import { FixtureMemoryResolver } from '../src/calibration/compiler-v1/fixture-memory-resolver.js';
import {
  accumulateMetrics,
  checkThresholds,
  createAccumulator,
  finalizeMetrics,
  type CalibrationMetrics,
} from '../src/calibration/compiler-v1/metrics.js';
import type { CalibrationCase, CalibrationManifest, RegistryFixture } from '../src/calibration/compiler-v1/types.js';
import {
  buildLiveCaptureRecord,
  classifyLiveDivergence,
  filterVariationsByCategories,
} from '../src/calibration/compiler-v1/live-capture.js';
import {
  buildVariabilityReport,
  formatVariabilitySummary,
} from '../src/calibration/compiler-v1/variability-report.js';
import {
  EXTRACTOR_VERSION,
  PROMPT_VERSION,
  SCHEMA_VERSION,
} from '../src/openai/extractor.prompt.js';
import { loadDotEnv } from '../src/config/load-dotenv.js';
import { loadEnv, resetEnvCache } from '../src/config/env.js';
import { createOpenAiExtractor } from '../src/openai/extractor.service.js';
import { ClarificationManagerService } from '../src/services/clarification-manager.service.js';
import { MemoryCompilerService } from '../src/services/memory-compiler.service.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const calDir = join(root, 'data/calibration/compiler-v1');
const casesDir = join(calDir, 'cases');

const liveMode =
  process.argv.includes('--live-extractor') ||
  process.env.ALLOW_LIVE_EXTRACTOR_CALIBRATION === 'true';

const captureLiveFixtures = process.argv.includes('--capture-live-fixtures');
const liveLimitArg = process.argv.find((a) => a.startsWith('--live-limit='));
const liveLimit = liveLimitArg ? Number(liveLimitArg.split('=')[1]) : 8;
const repetitionsArg = process.argv.find((a) => a.startsWith('--repetitions='));
const repetitions = repetitionsArg ? Number(repetitionsArg.split('=')[1]) : 10;
const categoriesArg = process.argv.find((a) => a.startsWith('--categories='));
const categoriesFilter = categoriesArg
  ? categoriesArg.split('=')[1]!.split(',').map((s) => s.trim())
  : [];

function loadCases(): CalibrationCase[] {
  const files = readdirSync(casesDir).filter((f) => f.endsWith('.json'));
  return files.map((f) => JSON.parse(readFileSync(join(casesDir, f), 'utf8')) as CalibrationCase);
}

function aggregateComparativeByCategory(
  rows: Array<{ category: ComparativeCategory; metrics: Record<string, MetricSlice> }>,
): Record<ComparativeCategory, Record<string, MetricSlice>> {
  const buckets = {} as Record<ComparativeCategory, Record<string, { cur: number; comp: number; n: number }>>;

  for (const row of rows) {
    buckets[row.category] = buckets[row.category] ?? {};
    for (const [key, slice] of Object.entries(row.metrics)) {
      const b = buckets[row.category][key] ?? { cur: 0, comp: 0, n: 0 };
      b.cur += slice.current;
      b.comp += slice.compiled;
      b.n += 1;
      buckets[row.category][key] = b;
    }
  }

  const out = {} as Record<ComparativeCategory, Record<string, MetricSlice>>;
  for (const [cat, keys] of Object.entries(buckets) as [ComparativeCategory, Record<string, { cur: number; comp: number; n: number }>][]) {
    out[cat] = {};
    for (const [key, v] of Object.entries(keys)) {
      const current = Math.round((v.cur / v.n) * 100) / 100;
      const compiled = Math.round((v.comp / v.n) * 100) / 100;
      out[cat][key] = {
        current,
        compiled,
        absolute_diff: Math.round((compiled - current) * 100) / 100,
        percent_diff: current === 0 ? (compiled === 0 ? 0 : null) : Math.round(((compiled - current) / current) * 1000) / 10,
      };
    }
  }
  return out;
}

async function resolveExtractorOutput(
  testCase: CalibrationCase,
  liveExtract: ReturnType<typeof createOpenAiExtractor> | null,
): Promise<CalibrationCase['extractor_output']> {
  if (!liveExtract) {
    return {
      ...testCase.extractor_output,
      inbox_item_id: testCase.extractor_output.inbox_item_id ?? randomUUID(),
    };
  }
  const out = await liveExtract({
    inbox_item_id: randomUUID(),
    raw_content: testCase.raw_content,
    source_channel: testCase.source_channel,
    source_mode: testCase.source_mode,
    received_at: testCase.received_at,
    timezone: testCase.timezone,
  });
  return out;
}

async function runLiveCaptureExpansion(): Promise<void> {
  if (process.env.ALLOW_LIVE_EXTRACTOR_CALIBRATION !== 'true') {
    console.error('Set ALLOW_LIVE_EXTRACTOR_CALIBRATION=true for live capture');
    process.exit(1);
  }

  loadDotEnv();
  resetEnvCache();
  const liveExtract = createOpenAiExtractor();
  const env = loadEnv();
  const variations = filterVariationsByCategories(categoriesFilter);
  const reps = repetitions > 0 ? repetitions : 10;

  console.log(`\n=== Live capture expansion ===`);
  console.log(`Categories: ${variations.map((v) => v.category).join(', ')}`);
  console.log(`Repetitions per category: ${reps}`);
  console.log(`Total planned executions: ${variations.length * reps}\n`);

  const compiler = new MemoryCompilerService();
  const clarificationManager = new ClarificationManagerService();
  const registry = JSON.parse(
    readFileSync(join(calDir, 'registry-fixture.json'), 'utf8'),
  ) as RegistryFixture;
  const resolver = new FixtureMemoryResolver(registry);

  const captures = [];
  const audits: ReturnType<typeof auditEntityPrecision>[] = [];
  const metricsPerRun: ReturnType<typeof finalizeMetrics>[] = [];
  const divergences: Array<{
    scenario_id: string;
    category: string;
    classification: ReturnType<typeof classifyLiveDivergence>;
    rationale: string;
  }> = [];
  const acc = createAccumulator();

  const liveCapturesDir = join(root, 'artifacts/calibration/live-captures');
  mkdirSync(liveCapturesDir, { recursive: true });

  for (const variation of variations) {
    const shapeCounts = new Map<string, number>();

    for (let rep = 1; rep <= reps; rep++) {
      const raw_content = variation.buildRawContent(rep);
      const output = await liveExtract({
        inbox_item_id: randomUUID(),
        raw_content,
        source_channel: variation.source_channel,
        source_mode: variation.source_mode,
        received_at: '2026-06-01T12:00:00-03:00',
        timezone: 'America/Sao_Paulo',
      });

      const record = buildLiveCaptureRecord(variation, rep, output, {
        extractorVersion: EXTRACTOR_VERSION,
        schemaVersion: SCHEMA_VERSION,
        promptVersion: PROMPT_VERSION,
        modelName: env.OPENAI_MODEL,
      });

      const testCase: CalibrationCase = {
        scenario_id: record.scenario_id,
        category: record.category,
        raw_content: record.raw_content,
        source_channel: record.source_channel,
        source_mode: record.source_mode,
        received_at: record.received_at,
        timezone: record.timezone,
        fixture_origin: 'captured',
        extractor_version: record.extractor_version,
        captured_at: record.captured_at,
        extractor_output: output,
        expected: record.expected,
      };

      const resolvedMap = resolver.resolveEntities('live', output.entities, raw_content);
      const current = buildCurrentOutput(output, resolvedMap, variation.source_channel);
      const compiled = compiler.compile({
        rawContent: raw_content,
        sourceChannel: variation.source_channel,
        sourceMode: variation.source_mode,
        extractorOutput: output,
        resolvedMap,
      });
      compiled.clarificationCandidates = clarificationManager.recommend({
        suggestedClarifications: output.clarification_requests,
        resolvedMap,
        compilerFlags: compiled.flags,
      });

      const evaluation = evaluateCase(testCase, current, compiled);
      const runAcc = createAccumulator();
      accumulateMetrics(runAcc, testCase, current, compiled, evaluation);
      const runMetrics = finalizeMetrics(runAcc);
      accumulateMetrics(acc, testCase, current, compiled, evaluation);

      const audit = auditEntityPrecision(testCase, output, compiled);
      audits.push(audit);
      metricsPerRun.push(runMetrics);
      captures.push(record);

      const shape = record.output_shape_hash;
      shapeCounts.set(shape, (shapeCounts.get(shape) ?? 0) + 1);
      const medianShape = shapeCounts.size <= 1;
      const classification = classifyLiveDivergence({
        category: variation.category,
        evaluationFailures: evaluation.failures,
        compiledPassed: evaluation.passed,
        shapeDiffersFromMedian: !medianShape,
      });
      divergences.push({
        scenario_id: record.scenario_id,
        category: variation.category,
        classification,
        rationale: evaluation.failures.join('; ') || 'ok',
      });

      const fileName = `${record.scenario_id}.json`;
      writeFileSync(join(liveCapturesDir, fileName), JSON.stringify(record, null, 2));
      console.log(`  captured ${fileName} shape=${shape} pass=${evaluation.passed}`);
    }
  }

  const aggregate = finalizeMetrics(acc);
  const variability = buildVariabilityReport({
    captures,
    audits,
    metricsPerRun,
    divergences,
    aggregate,
  });

  const outDir = join(root, 'artifacts/calibration');
  mkdirSync(outDir, { recursive: true });
  writeFileSync(
    join(outDir, 'compiler-v1-live-variability-report.json'),
    JSON.stringify(variability, null, 2),
  );
  writeFileSync(
    join(outDir, 'compiler-v1-live-variability-summary.md'),
    formatVariabilitySummary(variability),
  );
  writeFileSync(join(outDir, 'compiler-v1-live-report.json'), JSON.stringify({
    generated_at: new Date().toISOString(),
    mode: 'live-capture-expansion',
    executions: captures.length,
    categories: variability.categories,
    aggregate_metrics: aggregate,
    captures_dir: liveCapturesDir,
  }, null, 2));

  console.log('\n=== Live expansion complete ===');
  console.log('Captures:', liveCapturesDir);
  console.log('Variability:', join(outDir, 'compiler-v1-live-variability-report.json'));
  console.log('Summary:', join(outDir, 'compiler-v1-live-variability-summary.md'));
}

async function main(): Promise<void> {
  if (captureLiveFixtures) {
    loadDotEnv();
    resetEnvCache();
    await runLiveCaptureExpansion();
    return;
  }

  if (liveMode && process.env.ALLOW_LIVE_EXTRACTOR_CALIBRATION !== 'true') {
    console.error(
      'Live extractor blocked. Set ALLOW_LIVE_EXTRACTOR_CALIBRATION=true and pass --live-extractor',
    );
    process.exit(1);
  }

  const manifest = JSON.parse(
    readFileSync(join(calDir, 'manifest.json'), 'utf8'),
  ) as CalibrationManifest;
  const registry = JSON.parse(
    readFileSync(join(calDir, 'registry-fixture.json'), 'utf8'),
  ) as RegistryFixture;

  const allCases = loadCases();
  const cases = liveMode ? allCases.slice(0, liveLimit) : allCases;
  if (liveMode) {
    console.log(`Live mode: running ${cases.length}/${allCases.length} cases (limit ${liveLimit})`);
  }
  const compiler = new MemoryCompilerService();
  const clarificationManager = new ClarificationManagerService();
  const resolver = new FixtureMemoryResolver(registry);
  const acc = createAccumulator();
  const liveExtract = liveMode ? createOpenAiExtractor() : null;

  const entityAuditRows = [];
  const comparativeRows: Array<{ category: ComparativeCategory; metrics: Record<string, MetricSlice> }> = [];
  const results: Array<{
    scenario_id: string;
    category: string;
    fixture_origin: string;
    passed: boolean;
    failures: string[];
    current: Record<string, unknown>;
    compiled: Record<string, unknown>;
    fixture_extractor_entities?: string[];
    live_extractor_entities?: string[];
  }> = [];

  const byCategory: Record<string, { passed: number; total: number }> = {};
  const currentAcc = createAccumulator();

  for (const testCase of cases) {
    const fixtureOutput = {
      ...testCase.extractor_output,
      inbox_item_id: testCase.extractor_output.inbox_item_id ?? randomUUID(),
    };
    const output = await resolveExtractorOutput(testCase, liveExtract);

    const resolvedMap = resolver.resolveEntities('cal-inbox', output.entities, testCase.raw_content);
    const current = buildCurrentOutput(output, resolvedMap, testCase.source_channel);
    const compiled = compiler.compile({
      rawContent: testCase.raw_content,
      sourceChannel: testCase.source_channel,
      sourceMode: testCase.source_mode,
      extractorOutput: output,
      resolvedMap,
    });
    const recommended = clarificationManager.recommend({
      suggestedClarifications: output.clarification_requests,
      resolvedMap,
      compilerFlags: compiled.flags,
    });
    compiled.clarificationCandidates = recommended;

    const evaluation = evaluateCase(testCase, current, compiled);
    accumulateMetrics(acc, testCase, current, compiled, evaluation);

    if (liveMode) {
      const fixtureResolved = resolver.resolveEntities(
        'cal-fixture',
        fixtureOutput.entities,
        testCase.raw_content,
      );
      const fixtureCurrent = buildCurrentOutput(fixtureOutput, fixtureResolved, testCase.source_channel);
      const fixtureCompiled = compiler.compile({
        rawContent: testCase.raw_content,
        sourceChannel: testCase.source_channel,
        sourceMode: testCase.source_mode,
        extractorOutput: fixtureOutput,
        resolvedMap: fixtureResolved,
      });
      accumulateMetrics(currentAcc, testCase, fixtureCurrent, fixtureCompiled, evaluation);
    }

    entityAuditRows.push(auditEntityPrecision(testCase, output, compiled));
    comparativeRows.push({
      category: mapToComparativeCategory(testCase.category),
      metrics: buildComparativeMetrics(testCase, current, compiled),
    });

    byCategory[testCase.category] = byCategory[testCase.category] ?? { passed: 0, total: 0 };
    byCategory[testCase.category].total += 1;
    if (evaluation.passed) byCategory[testCase.category].passed += 1;

    results.push({
      scenario_id: testCase.scenario_id,
      category: testCase.category,
      fixture_origin: testCase.fixture_origin,
      passed: evaluation.passed,
      failures: evaluation.failures,
      current: viewForEvaluation(current),
      compiled: evaluation.compiled,
      fixture_extractor_entities: fixtureOutput.entities.map((e) => e.name),
      ...(liveMode ? { live_extractor_entities: output.entities.map((e) => e.name) } : {}),
    });

    if (!evaluation.passed) {
      console.log(`\n--- ${testCase.scenario_id} (${testCase.category}) ---`);
      for (const f of evaluation.failures) console.log(`  FAIL: ${f}`);
    }
  }

  const metrics = finalizeMetrics(acc);
  const fixtureMetrics = liveMode ? finalizeMetrics(currentAcc) : metrics;
  const auditPrecision = aggregateEntityPrecision(entityAuditRows);
  const bootstrapResults = results.filter((r) => r.category.startsWith('bootstrap'));
  const bootstrapEntityPrecision =
    bootstrapResults.length > 0
      ? bootstrapResults.filter((r) => r.passed).length / bootstrapResults.length
      : 1;
  const thresholdFailures = checkThresholds(metrics, manifest.thresholds, bootstrapEntityPrecision);

  const captured = cases.filter((c) => c.fixture_origin === 'captured').length;
  const synthetic = cases.filter((c) => c.fixture_origin === 'synthetic').length;

  const outDir = join(root, 'artifacts/calibration');
  mkdirSync(outDir, { recursive: true });

  const entityAuditReport = {
    generated_at: new Date().toISOString(),
    mode: liveMode ? 'live' : 'fixture',
    initial_metric_entity_precision: metrics.entity_precision,
    audit_aggregate_entity_precision: auditPrecision,
    rows: entityAuditRows,
    classification_summary: entityAuditRows.reduce(
      (acc, row) => {
        for (const d of row.divergence_classifications) {
          acc[d.classification] = (acc[d.classification] ?? 0) + 1;
        }
        return acc;
      },
      {} as Record<string, number>,
    ),
  };
  writeFileSync(
    join(outDir, 'compiler-v1-entity-precision-audit.json'),
    JSON.stringify(entityAuditReport, null, 2),
  );

  const comparativeReport = {
    generated_at: new Date().toISOString(),
    by_category: aggregateComparativeByCategory(comparativeRows),
    per_scenario: results.map((r, i) => ({
      scenario_id: r.scenario_id,
      category: mapToComparativeCategory(r.category),
      metrics: comparativeRows[i]!.metrics,
    })),
  };
  writeFileSync(
    join(outDir, 'compiler-v1-comparative-current-vs-compiled.json'),
    JSON.stringify(comparativeReport, null, 2),
  );

  const report = {
    generated_at: new Date().toISOString(),
    mode: liveMode ? 'live' : 'fixture',
    manifest,
    case_count: cases.length,
    fixture_origins: { captured, synthetic },
    metrics,
    ...(liveMode
      ? {
          fixture_frozen_metrics: fixtureMetrics as CalibrationMetrics,
          live_vs_fixture: {
            entity_precision_delta: metrics.entity_precision - fixtureMetrics.entity_precision,
            event_precision_delta: metrics.event_precision - fixtureMetrics.event_precision,
          },
        }
      : {}),
    entity_precision_audit_aggregate: auditPrecision,
    metrics_current_vs_compiled: {
      note: 'current path = productive sanitizer; compiled = memory-compiler-v1',
      aggregate: metrics,
      comparative_by_category: comparativeReport.by_category,
    },
    bootstrap_entity_precision: bootstrapEntityPrecision,
    thresholds_passed: thresholdFailures.length === 0,
    threshold_failures: thresholdFailures,
    by_category: byCategory,
    failed_scenarios: results.filter((r) => !r.passed).map((r) => r.scenario_id),
    results,
  };

  const reportPath = join(outDir, liveMode ? 'compiler-v1-live-report.json' : 'compiler-v1-report.json');
  writeFileSync(reportPath, JSON.stringify(report, null, 2));

  console.log('\n=== Calibration summary ===');
  console.log('Mode:', liveMode ? 'live-extractor' : 'fixture');
  console.log('Cases:', cases.length, `(captured: ${captured}, synthetic: ${synthetic})`);
  console.log('Metrics:', JSON.stringify(metrics, null, 2));
  console.log('Entity audit precision:', auditPrecision);
  console.log('Entity audit:', join(outDir, 'compiler-v1-entity-precision-audit.json'));
  console.log('Comparative:', join(outDir, 'compiler-v1-comparative-current-vs-compiled.json'));
  console.log('Report:', reportPath);

  const compiledFailures = results.filter((r) => !r.passed);
  if (!liveMode && (thresholdFailures.length > 0 || compiledFailures.length > 0)) {
    console.error('\nCalibration FAILED');
    process.exit(1);
  }
  if (liveMode && (thresholdFailures.length > 0 || compiledFailures.length > 0)) {
    console.warn('\nLive calibration completed with divergences (exploratory — no exit 1)');
  } else {
    console.log('\nCalibration PASSED');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
