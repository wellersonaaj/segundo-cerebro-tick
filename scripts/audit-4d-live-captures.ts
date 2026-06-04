/**
 * Read-only audit: Bloco 4D live categories — full pipeline trace per run.
 * Does NOT modify production services. Writes artifacts only.
 *
 *   ALLOW_EXTRACTOR_V14_LIVE_CALIBRATION=true tsx scripts/audit-4d-live-captures.ts
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadDotEnv } from '../src/config/load-dotenv.js';
import { loadEnv, resetEnvCache } from '../src/config/env.js';
import { evaluateV2Case } from '../src/calibration/extractor-v1.4/evaluate-v2-case.js';
import {
  buildFullIngestionContext,
  runV14ContextPipeline,
} from '../src/calibration/extractor-v1.4/run-v14-context-pipeline.js';
import {
  filterV14VariationsByCategories,
  hashV14OutputShape,
} from '../src/calibration/extractor-v1.4/live-variations.js';
import { createOpenAiExtractorV14 } from '../src/openai/extractor-v1.4.service.js';
import type { RegistryEntityFixture } from '../src/services/reference-resolver.service.js';
import { readFileSync } from 'node:fs';
import { buildEffectiveInputWithSourceBlocks } from '../src/utils/source-blocks.js';
import { getIngestionContextById } from '../src/calibration/extractor-v1.4/load-ingestion-context.js';

loadDotEnv();
resetEnvCache();
loadEnv();

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const capturesDir = join(root, 'artifacts/calibration/extractor-v1.4-live-captures');
const auditReportPath = join(root, 'artifacts/calibration/bloco-4d-live-audit.json');

const CATEGORIES = [
  'first_contact_task',
  'incremental_due_date_unique',
  'incremental_due_date_ambiguous',
];

if (process.env.ALLOW_EXTRACTOR_V14_LIVE_CALIBRATION !== 'true') {
  console.error('Set ALLOW_EXTRACTOR_V14_LIVE_CALIBRATION=true');
  process.exit(1);
}

const registry = JSON.parse(
  readFileSync(join(root, 'data/calibration/extractor-v1.4/registry-fixture.json'), 'utf8'),
) as { entities: RegistryEntityFixture[] };

const variations = filterV14VariationsByCategories(CATEGORIES);
const extractV14 = createOpenAiExtractorV14();
const repetitions = 5;

function classifyFailure(row: Record<string, unknown>): string {
  const failures = (row.failures as string[]) ?? [];
  const wiring = row.wiring_effective_input_mismatch as boolean;
  const invalidSb = row.invalid_source_block_drops as number;
  const extractorHasOp = row.extractor_has_expected_operation as boolean;
  const compiledHasOp = row.compiled_has_expected_operation as boolean;
  const evidence = (row.context_resolution_evidence as unknown[])?.length ?? 0;
  const resolution = row.resolution_status as string;
  const decision = row.compiled_decision as string;
  const expectedDecision = row.expected_decision as string;

  if (wiring && invalidSb > 0 && extractorHasOp && !compiledHasOp) return 'A';
  if (failures.some((f) => f.includes('extractor must emit'))) return 'B';
  if (
    extractorHasOp &&
    !compiledHasOp &&
    resolution === 'unresolved' &&
    evidence === 0
  ) {
    return 'C';
  }
  if (invalidSb > 0 && !wiring) return 'D';
  if (
    decision === 'needs_clarification' &&
    expectedDecision === 'accepted' &&
    (row.cm_blocking_count as number) > 0 &&
    compiledHasOp
  ) {
    return 'E';
  }
  if (
    decision === 'needs_clarification' &&
    expectedDecision === 'needs_clarification' &&
    !compiledHasOp &&
    extractorHasOp
  ) {
    return 'D';
  }
  if (
    expectedDecision === 'needs_clarification' &&
    decision === 'needs_clarification' &&
    compiledHasOp
  ) {
    return 'G';
  }
  if (!extractorHasOp) return 'B';
  if (wiring && invalidSb > 0) return 'A';
  if (!compiledHasOp && extractorHasOp) return 'D';
  if (decision !== expectedDecision && compiledHasOp) return 'E';
  return 'F';
}

async function main(): Promise<void> {
  mkdirSync(capturesDir, { recursive: true });
  const rows: Record<string, unknown>[] = [];

  for (const variation of variations) {
    for (let rep = 1; rep <= repetitions; rep += 1) {
      const raw_content = variation.buildRawContent(rep);
      const effectiveInput = buildEffectiveInputWithSourceBlocks({ raw_content });

      const output = await extractV14({
        effective_input: effectiveInput,
        source_channel: variation.source_channel,
        source_mode: variation.source_mode,
        received_at: '2026-06-01T12:00:00-03:00',
        timezone: 'America/Sao_Paulo',
      });

      const caseFile = {
        scenario_id: `${variation.category}-r${rep}`,
        raw_content,
        regime: variation.regime ?? variation.expected.regime,
        ingestion_context_id: variation.ingestion_context_id ?? 'empty',
        source_metadata: variation.source_metadata,
      };

      const pipeline = runV14ContextPipeline({
        scenarioId: caseFile.scenario_id,
        extractorOutput: output,
        expected: variation.expected,
        caseFile,
        registryEntities: registry.entities,
      });

      const expectedOps = variation.expected.must_have?.task_operations ?? [];
      const sig = output.task_signals?.[0];
      const resolution = pipeline.taskSignalResolutions[0];
      const ctxId = caseFile.ingestion_context_id ?? 'empty';
      let fixtureLoaded = false;
      try {
        getIngestionContextById(ctxId);
        fixtureLoaded = true;
      } catch {
        fixtureLoaded = false;
      }

      const blocking = pipeline.recommended.filter(
        (c) => c.blockingScope !== 'none' && c.priority !== 'low',
      );
      const invalidSbDrops = pipeline.compiled.droppedArtifacts.filter(
        (d) => d.reason === 'invalid_source_block',
      ).length;

      const extractorHasOp = expectedOps.every((op) =>
        (output.task_signals ?? []).some((s) => s.operation === op),
      );
      const compiledHasOp = expectedOps.every((op) =>
        pipeline.compiled.tasks.some((t) => t.operation === op),
      );

      const wiringMismatch = effectiveInput !== caseFile.raw_content;

      const auditRow: Record<string, unknown> = {
        scenario_id: `live-v14-${variation.category}-r${rep}-${hashV14OutputShape(output).slice(0, 8)}`,
        category: variation.category,
        repetition: rep,
        raw_content,
        effective_input_for_extractor: effectiveInput,
        effective_input_for_pipeline: caseFile.raw_content,
        wiring_effective_input_mismatch: wiringMismatch,
        ingestion_context_id: ctxId,
        ingestion_context_loaded: fixtureLoaded,
        source_metadata: caseFile.source_metadata ?? {},
        full_context_open_tasks: buildFullIngestionContext(caseFile).openTasks.map((t) => ({
          id: t.id,
          reference: t.reference,
          threadReferences: t.threadReferences,
        })),
        task_signals: output.task_signals ?? [],
        operation: sig?.operation ?? null,
        task_reference: sig?.task_reference ?? null,
        title: sig?.title ?? null,
        due_at: sig?.due_at ?? null,
        source_block_reference: sig?.source_block_reference ?? null,
        llm_clarification_candidates: output.clarification_candidates ?? [],
        compact_context_open_tasks: pipeline.compactContext.openTasks.map((t) => ({
          id: t.id,
          reference: t.reference,
        })),
        candidate_count_before_truncation:
          resolution?.outcome.candidateCountBeforeTruncation ?? null,
        resolver_candidates: resolution?.outcome.candidates ?? [],
        best_score: resolution?.outcome.bestScore ?? null,
        second_best_score: resolution?.outcome.secondBestScore ?? null,
        score_margin: resolution?.outcome.scoreMargin ?? null,
        resolution_reason: resolution?.outcome.resolutionReason ?? null,
        resolution_status: resolution?.outcome.status ?? 'no_signal',
        context_resolution_evidence: pipeline.compiled.contextResolutionEvidence,
        compiled_decision: pipeline.compiled.decision.status,
        compiled_tasks: pipeline.compiled.tasks.map((t) => ({
          operation: t.operation,
          taskReference: t.taskReference,
          title: t.title,
        })),
        dropped_artifacts: pipeline.compiled.droppedArtifacts,
        invalid_source_block_drops: invalidSbDrops,
        cm_blocking_clarifications: blocking.map((c) => ({
          issueType: c.issueType,
          targetReference: c.targetReference,
          source: c.source,
          reason: c.reason,
        })),
        expected: variation.expected,
        extractor_has_expected_operation: extractorHasOp,
        compiled_has_expected_operation: compiledHasOp,
        pass: pipeline.evaluation.passed,
        failures: pipeline.evaluation.failures,
      };
      auditRow.root_cause_class = classifyFailure(auditRow);
      rows.push(auditRow);

      writeFileSync(
        join(capturesDir, `${auditRow.scenario_id}.json`),
        JSON.stringify(auditRow, null, 2),
      );
      console.log(
        `${auditRow.pass ? '✓' : '✗'} ${auditRow.scenario_id} [${auditRow.root_cause_class}] ${auditRow.compiled_decision}`,
      );
    }
  }

  const classCounts: Record<string, number> = {};
  for (const r of rows) {
    const c = r.root_cause_class as string;
    classCounts[c] = (classCounts[c] ?? 0) + 1;
  }

  writeFileSync(
    auditReportPath,
    JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        note: 'Original live run did not use --capture-live-fixtures; this audit re-ran extraction.',
        wiring_findings: {
          live_runner_passes_raw_content_to_pipeline: true,
          fixed_runner_passes_source_block_wrapped_raw_content: true,
          effective_input_mismatch_all_runs: rows.every((r) => r.wiring_effective_input_mismatch),
        },
        class_counts: classCounts,
        rows: rows.map((r) => ({
          scenario_id: r.scenario_id,
          category: r.category,
          repetition: r.repetition,
          root_cause_class: r.root_cause_class,
          pass: r.pass,
          compiled_decision: r.compiled_decision,
          extractor_has_expected_operation: r.extractor_has_expected_operation,
          compiled_has_expected_operation: r.compiled_has_expected_operation,
          invalid_source_block_drops: r.invalid_source_block_drops,
          resolution_status: r.resolution_status,
          evidence_count: (r.context_resolution_evidence as unknown[])?.length ?? 0,
          failures: r.failures,
        })),
        full_rows: rows,
      },
      null,
      2,
    ),
  );
  console.log('\nClass counts:', classCounts);
  console.log('Audit report:', auditReportPath);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
