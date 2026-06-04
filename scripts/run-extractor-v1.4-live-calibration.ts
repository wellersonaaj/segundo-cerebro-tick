/**
 * Live calibration: extractor v1.4 → resolver → compiler v2 (synthetic/anonymized only).
 *
 *   ALLOW_EXTRACTOR_V14_LIVE_CALIBRATION=true \
 *   npm run test:extractor:v1.4:live -- --categories=... --repetitions=10
 *   (captures enriched by default; pass --no-capture-live-fixtures to skip)
 *
 * Captures are written only under artifacts/calibration/extractor-v1.4-live-runs/<run_id>/.
 * Semantic gate report: artifacts/calibration/extractor-v1.4-semantic-gate-report.json
 */

import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadDotEnv } from '../src/config/load-dotenv.js';
import { loadEnv, resetEnvCache } from '../src/config/env.js';
import {
  accumulateV14Metrics,
  checkV14Thresholds,
  createV14MetricsAccumulator,
  finalizeV14Metrics,
  type V14MetricsAccumulator,
} from '../src/calibration/extractor-v1.4/live-metrics.js';
import {
  accumulateContextRegimeMetrics,
  createContextRegimeAccumulator,
  finalizeContextRegimeMetrics,
  type ContextRegimeAccumulator,
} from '../src/calibration/extractor-v1.4/context-regime-metrics.js';
import { runV14ContextPipeline } from '../src/calibration/extractor-v1.4/run-v14-context-pipeline.js';
import {
  filterV14VariationsByCategories,
  hashV14OutputShape,
} from '../src/calibration/extractor-v1.4/live-variations.js';
import {
  buildSemanticGateReport,
  renderSemanticGateSummaryMd,
} from '../src/calibration/extractor-v1.4/semantic-gate-report.js';
import { evaluateSemanticGate } from '../src/calibration/extractor-v1.4/semantic-gate.js';
import {
  EXTRACTOR_V14_PROMPT_VERSION,
  EXTRACTOR_V14_SCHEMA_VERSION,
  EXTRACTOR_V14_VERSION,
} from '../src/openai/extractor-v1.4.prompt.js';
import { createOpenAiExtractorV14 } from '../src/openai/extractor-v1.4.service.js';
import type { RegistryEntityFixture } from '../src/services/reference-resolver.service.js';
import { buildEffectiveInputWithSourceBlocks, listSourceBlockIds } from '../src/utils/source-blocks.js';

loadDotEnv();
resetEnvCache();
loadEnv();

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const artifactsDir = join(root, 'artifacts/calibration');
const liveRunsRoot = join(artifactsDir, 'extractor-v1.4-live-runs');

const captureLiveFixtures = !process.argv.includes('--no-capture-live-fixtures');
const repetitionsArg = process.argv.find((a) => a.startsWith('--repetitions='));
const repetitions = repetitionsArg ? Number(repetitionsArg.split('=')[1]) : 10;
const categoriesArg = process.argv.find((a) => a.startsWith('--categories='));
const categoriesFilter = categoriesArg
  ? categoriesArg.split('=')[1]!.split(',').map((s) => s.trim())
  : [];

if (process.env.ALLOW_EXTRACTOR_V14_LIVE_CALIBRATION !== 'true') {
  console.error(
    'Set ALLOW_EXTRACTOR_V14_LIVE_CALIBRATION=true to run live v1.4 calibration (synthetic/anonymized only).',
  );
  process.exit(1);
}

const registry = JSON.parse(
  readFileSync(join(root, 'data/calibration/extractor-v1.4/registry-fixture.json'), 'utf8'),
) as { entities: RegistryEntityFixture[] };

const variations = filterV14VariationsByCategories(categoriesFilter);
const extractV14 = createOpenAiExtractorV14();

const runId = `v14-live-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
const startedAt = new Date().toISOString();
const runDir = join(liveRunsRoot, runId);
const capturesDir = join(runDir, 'captures');

interface RunRow {
  category: string;
  repetition: number;
  scenario_id: string;
  passed: boolean;
  failures: string[];
  compiled_decision: string;
  final_decision: string;
  shape_hash: string;
}

function ensureCategoryBucket(
  map: Record<
    string,
    {
      live: V14MetricsAccumulator;
      context: ContextRegimeAccumulator;
      passed: number;
      total: number;
    }
  >,
  category: string,
): void {
  if (!map[category]) {
    map[category] = {
      live: createV14MetricsAccumulator(),
      context: createContextRegimeAccumulator(),
      passed: 0,
      total: 0,
    };
  }
}

async function main(): Promise<void> {
  mkdirSync(runDir, { recursive: true });
  mkdirSync(capturesDir, { recursive: true });

  const acc = createV14MetricsAccumulator();
  const contextAcc = createContextRegimeAccumulator();
  const byCategoryAcc: Record<
    string,
    {
      live: V14MetricsAccumulator;
      context: ContextRegimeAccumulator;
      passed: number;
      total: number;
    }
  > = {};

  const rows: RunRow[] = [];
  const byCategory: Record<string, { passed: number; total: number }> = {};

  const runManifest = {
    run_id: runId,
    extractor_version: EXTRACTOR_V14_VERSION,
    schema_version: EXTRACTOR_V14_SCHEMA_VERSION,
    prompt_version: EXTRACTOR_V14_PROMPT_VERSION,
    started_at: startedAt,
    categories: categoriesFilter.length
      ? categoriesFilter
      : variations.map((v) => v.category),
    repetitions,
    capture_live_fixtures: captureLiveFixtures,
  };

  writeFileSync(join(runDir, 'manifest.json'), JSON.stringify(runManifest, null, 2));

  console.log(
    `Live v1.4 calibration [${runId}]: ${variations.length} categories × ${repetitions} repetitions`,
  );

  for (const variation of variations) {
    byCategory[variation.category] = { passed: 0, total: 0 };
    ensureCategoryBucket(byCategoryAcc, variation.category);

    for (let rep = 1; rep <= repetitions; rep += 1) {
      const raw_content = variation.buildRawContent(rep);
      const corrections = variation.corrections?.(rep);
      const effectiveInput = buildEffectiveInputWithSourceBlocks({ raw_content, corrections });

      const output = await extractV14({
        effective_input: effectiveInput,
        source_channel: variation.source_channel,
        source_mode: variation.source_mode,
        received_at: '2026-06-01T12:00:00-03:00',
        timezone: 'America/Sao_Paulo',
      });

      const caseFile = {
        scenario_id: `${variation.category}-r${rep}`,
        raw_content: effectiveInput,
        regime: variation.regime ?? variation.expected.regime,
        ingestion_context_id: variation.ingestion_context_id ?? 'empty',
        source_metadata: variation.source_metadata,
      };
      if (variation.source_metadata) {
        caseFile.source_metadata = {
          ...caseFile.source_metadata,
          ...variation.source_metadata,
        };
      }

      const pipeline = runV14ContextPipeline({
        scenarioId: caseFile.scenario_id,
        extractorOutput: output,
        expected: variation.expected,
        caseFile,
        registryEntities: registry.entities,
        temporalAnchor: {
          receivedAt: '2026-06-01T12:00:00-03:00',
          timezone: 'America/Sao_Paulo',
        },
      });
      const {
        compiled,
        recommended,
        clarificationMateriality,
        finalDecision,
        compilerDecision,
        evaluation,
        taskSignalResolutions,
      } = pipeline;

      const catBucket = byCategoryAcc[variation.category]!;

      accumulateContextRegimeMetrics(
        contextAcc,
        variation.regime ?? variation.expected.regime,
        variation.expected,
        output,
        compiled,
        recommended,
      );
      accumulateContextRegimeMetrics(
        catBucket.context,
        variation.regime ?? variation.expected.regime,
        variation.expected,
        output,
        compiled,
        recommended,
      );

      accumulateV14Metrics(
        acc,
        variation.expected,
        output,
        compiled,
        evaluation,
        recommended.length,
        effectiveInput,
        variation.category,
        recommended,
        clarificationMateriality,
      );
      accumulateV14Metrics(
        catBucket.live,
        variation.expected,
        output,
        compiled,
        evaluation,
        recommended.length,
        effectiveInput,
        variation.category,
        recommended,
        clarificationMateriality,
      );

      const scenario_id = `live-v14-${variation.category}-r${rep}-${hashV14OutputShape(output).slice(0, 8)}`;

      if (captureLiveFixtures) {
        writeFileSync(
          join(capturesDir, `${scenario_id}.json`),
          JSON.stringify(
            {
              run_id: runId,
              extractor_version: EXTRACTOR_V14_VERSION,
              schema_version: EXTRACTOR_V14_SCHEMA_VERSION,
              prompt_version: EXTRACTOR_V14_PROMPT_VERSION,
              scenario_id,
              category: variation.category,
              repetition_index: rep,
              raw_content,
              effective_input: effectiveInput,
              source_block_ids: listSourceBlockIds(effectiveInput),
              ingestion_context_id: caseFile.ingestion_context_id,
              source_metadata: caseFile.source_metadata,
              extractor_output: output,
              compiled_output: {
                tasks: compiled.tasks,
                clarificationCandidates: compiled.clarificationCandidates,
                droppedArtifacts: compiled.droppedArtifacts,
                flags: compiled.flags,
                taskSignalResolutions,
              },
              context_resolution_evidence: compiled.contextResolutionEvidence,
              compiler_decision: compilerDecision.status,
              final_decision: finalDecision,
              decision: compiled.decision,
              clarification_materiality: {
                blocking: clarificationMateriality.blocking,
                non_blocking: clarificationMateriality.nonBlocking,
                discarded: clarificationMateriality.discarded,
              },
              final_clarifications: recommended,
              evaluation,
            },
            null,
            2,
          ),
        );
      }

      const row: RunRow = {
        category: variation.category,
        repetition: rep,
        scenario_id,
        passed: evaluation.passed,
        failures: evaluation.failures,
        compiled_decision: compilerDecision.status,
        final_decision: finalDecision.status,
        shape_hash: hashV14OutputShape(output),
      };
      rows.push(row);
      byCategory[variation.category]!.total += 1;
      catBucket.total += 1;
      if (row.passed) {
        byCategory[variation.category]!.passed += 1;
        catBucket.passed += 1;
      }

      const mark = row.passed ? '✓' : '✗';
      console.log(
        `${mark} ${variation.category} r${rep} (compiler=${row.compiled_decision} final=${row.final_decision})`,
      );
    }
  }

  const metrics = finalizeV14Metrics(acc);
  const contextMetrics = finalizeContextRegimeMetrics(contextAcc);
  const legacyThresholds = checkV14Thresholds(metrics, acc);
  const semanticGate = evaluateSemanticGate(acc, metrics, contextAcc, contextMetrics);

  const casePassed = rows.filter((r) => r.passed).length;
  const semanticReport = buildSemanticGateReport({
    meta: {
      run_id: runId,
      extractor_version: EXTRACTOR_V14_VERSION,
      schema_version: EXTRACTOR_V14_SCHEMA_VERSION,
      prompt_version: EXTRACTOR_V14_PROMPT_VERSION,
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      categories: runManifest.categories,
      repetitions,
      total_runs: rows.length,
    },
    liveAcc: acc,
    contextAcc,
    contextMetrics,
    byCategoryAcc,
    failedRows: rows
      .filter((r) => !r.passed)
      .map((r) => ({
        scenario_id: r.scenario_id,
        category: r.category,
        repetition: r.repetition,
        failures: r.failures,
      })),
    casePassed,
    caseTotal: rows.length,
  });

  const report = {
    run_id: runId,
    generated_at: new Date().toISOString(),
    extractor_version: EXTRACTOR_V14_VERSION,
    schema_version: EXTRACTOR_V14_SCHEMA_VERSION,
    prompt_version: EXTRACTOR_V14_PROMPT_VERSION,
    categories: runManifest.categories,
    repetitions,
    total_runs: rows.length,
    pass_rate_by_category: byCategory,
    metrics,
    context_metrics: contextMetrics,
    legacy_thresholds: legacyThresholds,
    semantic_gate: semanticGate,
    failed_cases: rows.filter((r) => !r.passed).slice(0, 50),
    captures_dir: captureLiveFixtures ? capturesDir : null,
  };

  writeFileSync(
    join(runDir, 'live-report.json'),
    JSON.stringify(report, null, 2),
  );
  writeFileSync(
    join(artifactsDir, 'extractor-v1.4-live-report.json'),
    JSON.stringify({ ...report, note: 'Latest run; see extractor-v1.4-live-runs/<run_id>/ for isolated captures' }, null, 2),
  );

  writeFileSync(
    join(artifactsDir, 'extractor-v1.4-semantic-gate-report.json'),
    JSON.stringify(semanticReport, null, 2),
  );
  writeFileSync(
    join(artifactsDir, 'extractor-v1.4-semantic-gate-summary.md'),
    renderSemanticGateSummaryMd(semanticReport),
  );
  writeFileSync(join(runDir, 'semantic-gate-report.json'), JSON.stringify(semanticReport, null, 2));

  const belowThreshold = semanticGate.metrics.filter((t) => !t.passed);
  const summaryLines = [
    '# Extractor v1.4 live calibration summary',
    '',
    `Run ID: \`${runId}\``,
    `Generated: ${report.generated_at}`,
    `Runs: ${report.total_runs}`,
    '',
    '## Global metrics',
    ...Object.entries(metrics).map(([k, v]) => `- **${k}**: ${v}`),
    '',
    '## Semantic gate',
    ...semanticGate.metrics.map(
      (t) =>
        `- ${t.metric}: ${t.status === 'not_applicable' ? 'N/A' : t.value} ${t.passed ? 'PASS' : 'FAIL'}`,
    ),
    '',
    semanticReport.aggregate.recommendation,
    '',
    `Captures (this run only): \`${capturesDir}\``,
  ];

  writeFileSync(join(runDir, 'live-summary.md'), summaryLines.join('\n'));
  writeFileSync(join(artifactsDir, 'extractor-v1.4-live-summary.md'), summaryLines.join('\n'));

  console.log('\nMetrics:', metrics);
  console.log('Context regime metrics:', contextMetrics);
  console.log('Semantic gate:', semanticGate.all_passed ? 'PASS' : 'FAIL', semanticGate.failed_metrics);
  console.log('Run dir:', runDir);
  console.log('Semantic gate report:', join(artifactsDir, 'extractor-v1.4-semantic-gate-report.json'));

  process.exit(semanticGate.all_passed ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
