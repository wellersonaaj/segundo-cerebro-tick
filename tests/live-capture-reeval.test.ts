import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FIXED_CALIBRATION_EXPECTATIONS } from '../src/calibration/extractor-v1.4/fixed-calibration-expectations.js';
import { FIXED_EXTRACTOR_FIXTURES } from '../src/calibration/extractor-v1.4/fixed-extractor-fixtures.js';
import { buildCaseFileFromLiveCapture } from '../src/calibration/extractor-v1.4/live-capture-reeval.js';
import { runV14ContextPipeline } from '../src/calibration/extractor-v1.4/run-v14-context-pipeline.js';
import type { RegistryEntityFixture } from '../src/services/reference-resolver.service.js';

const registry = JSON.parse(
  readFileSync(join('data/calibration/extractor-v1.4/registry-fixture.json'), 'utf8'),
) as { entities: RegistryEntityFixture[] };

describe('live capture re-eval contextual pipeline', () => {
  it('incremental_due_date_unique passes with ingestion context + TaskContextResolver', () => {
    const sid = 'v14-ctx-due-date-unique';
    const caseFile = JSON.parse(
      readFileSync(join('data/calibration/extractor-v1.4/cases', `${sid}.json`), 'utf8'),
    );
    const extractorOutput = FIXED_EXTRACTOR_FIXTURES[sid]!;
    const expected = FIXED_CALIBRATION_EXPECTATIONS[sid]!;

    const pipeline = runV14ContextPipeline({
      scenarioId: sid,
      extractorOutput,
      expected,
      caseFile,
      registryEntities: registry.entities,
      evaluationCategory: 'incremental_due_date_unique',
    });

    expect(pipeline.compiled.contextResolutionEvidence.length).toBeGreaterThan(0);
    expect(pipeline.evaluation.passed).toBe(true);
    expect(pipeline.finalDecision.status).toBe('accepted');
  });

  it('buildCaseFileFromLiveCapture restores ingestion_context from capture fields', () => {
    const caseFile = buildCaseFileFromLiveCapture({
      scenario_id: 'live-v14-incremental_due_date_unique-r1',
      category: 'incremental_due_date_unique',
      repetition_index: 1,
      raw_content: 'O prazo da revisão 1 mudou para sexta-feira.',
      effective_input: '[SOURCE_BLOCK:raw]\nO prazo da revisão 1 mudou para sexta-feira.',
      extractor_output: FIXED_EXTRACTOR_FIXTURES['v14-ctx-due-date-unique']!,
      ingestion_context_id: 'atlas_single_task',
      source_metadata: { thread_reference: 'thread-atlas-1' },
      regime: 'incremental_single',
    });

    expect(caseFile.ingestion_context_id).toBe('atlas_single_task');
    expect(caseFile.source_metadata?.thread_reference).toBe('thread-atlas-1');
    expect(caseFile.regime).toBe('incremental_single');
  });
});
