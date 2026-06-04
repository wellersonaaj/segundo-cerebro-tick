import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FIXED_EXTRACTOR_FIXTURES } from '../src/calibration/extractor-v1.4/fixed-extractor-fixtures.js';
import { FIXED_CALIBRATION_EXPECTATIONS } from '../src/calibration/extractor-v1.4/fixed-calibration-expectations.js';
import { runV14ContextPipeline } from '../src/calibration/extractor-v1.4/run-v14-context-pipeline.js';
import {
  buildEffectiveInputWithSourceBlocks,
  listSourceBlockIds,
  SOURCE_BLOCK_RAW,
} from '../src/utils/source-blocks.js';
import type { RegistryEntityFixture } from '../src/services/reference-resolver.service.js';

/** Mirrors scripts/run-extractor-v1.4-live-calibration.ts caseFile wiring after 4D fix. */
function buildLiveCalibrationCaseFile(params: {
  raw_content: string;
  ingestion_context_id: string;
}) {
  const effectiveInput = buildEffectiveInputWithSourceBlocks({ raw_content: params.raw_content });
  return {
    scenario_id: 'wiring-regression',
    raw_content: effectiveInput,
    regime: 'incremental_single' as const,
    ingestion_context_id: params.ingestion_context_id,
    source_metadata: { thread_reference: 'thread-atlas-1' },
    effectiveInput,
  };
}

describe('live v1.4 calibration wiring', () => {
  const registry = JSON.parse(
    readFileSync(join('data/calibration/extractor-v1.4/registry-fixture.json'), 'utf8'),
  ) as { entities: RegistryEntityFixture[] };

  it('passes the same effectiveInput with SOURCE_BLOCK to extractor path and compiler pipeline', () => {
    const plainBody = 'O prazo da revisão mudou para sexta.';
    const live = buildLiveCalibrationCaseFile({
      raw_content: plainBody,
      ingestion_context_id: 'atlas_single_task',
    });

    expect(live.effectiveInput).toContain(SOURCE_BLOCK_RAW);
    expect(listSourceBlockIds(live.effectiveInput)).toContain(SOURCE_BLOCK_RAW);
    expect(live.raw_content).toBe(live.effectiveInput);

    const sid = 'v14-ctx-due-date-unique';
    const output = FIXED_EXTRACTOR_FIXTURES[sid]!;
    const expected = FIXED_CALIBRATION_EXPECTATIONS[sid]!;

    const result = runV14ContextPipeline({
      scenarioId: sid,
      extractorOutput: output,
      expected,
      caseFile: live,
      registryEntities: registry.entities,
    });

    const invalidSourceBlockDrops = result.compiled.droppedArtifacts.filter(
      (d) => d.reason === 'invalid_source_block',
    );
    expect(invalidSourceBlockDrops).toHaveLength(0);
    expect(result.compiled.tasks).toHaveLength(1);
    expect(result.compiled.tasks[0]?.operation).toBe('update_due_date');
    expect(result.compiled.contextResolutionEvidence.length).toBeGreaterThan(0);
    expect(result.evaluation.passed).toBe(true);
  });

  it('drops tasks when pipeline receives plain raw_content without SOURCE_BLOCK (broken wiring)', () => {
    const sid = 'v14-ctx-due-date-unique';
    const caseWithBlock = JSON.parse(
      readFileSync(join('data/calibration/extractor-v1.4/cases', `${sid}.json`), 'utf8'),
    );
    const casePlain = {
      ...caseWithBlock,
      raw_content: 'O prazo da revisão mudou para sexta.',
    };
    const output = FIXED_EXTRACTOR_FIXTURES[sid]!;
    const expected = FIXED_CALIBRATION_EXPECTATIONS[sid]!;

    const result = runV14ContextPipeline({
      scenarioId: sid,
      extractorOutput: output,
      expected,
      caseFile: casePlain,
      registryEntities: registry.entities,
    });

    expect(result.compiled.droppedArtifacts.some((d) => d.reason === 'invalid_source_block')).toBe(
      true,
    );
    expect(result.compiled.tasks).toHaveLength(0);
  });
});
