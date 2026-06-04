import { describe, expect, it } from 'vitest';
import { evaluateCase } from '../src/calibration/compiler-v1/evaluate-case.js';
import type { CalibrationCase } from '../src/calibration/compiler-v1/types.js';
import { MEMORY_COMPILER_VERSION } from '../src/types/memory-compiler.js';

describe('calibration evaluateCase allowed/optional', () => {
  it('does not fail when optional entities are absent', () => {
    const testCase: CalibrationCase = {
      scenario_id: 'test-optional',
      category: 'test',
      raw_content: 'text',
      source_channel: 'test',
      source_mode: 'conversational',
      received_at: '2026-06-01T12:00:00-03:00',
      timezone: 'America/Sao_Paulo',
      fixture_origin: 'synthetic',
      extractor_version: 'extractor-v1.3',
      captured_at: '2026-06-02T12:00:00Z',
      extractor_output: {
        schema_version: '1.3',
        inbox_item_id: '00000000-0000-4000-8000-000000000001',
        events: [],
        entities: [{ name: 'Alex', entity_type: 'person', source_excerpt: 'x', confidence: 0.9, aliases: [] }],
        assertions: [],
        tasks: [],
        clarification_requests: [],
        requires_review: false,
        review_reasons: [],
        processing_notes: [],
      },
      expected: {
        must_have: { entities: ['Alex'] },
        optional: { entities: ['São Paulo'] },
      },
    };

    const result = evaluateCase(
      testCase,
      testCase.extractor_output,
      {
        compilerVersion: MEMORY_COMPILER_VERSION,
        entities: [{ name: 'Alex', entityType: 'person', sourceExcerpt: 'x', confidence: 0.9 }],
        aliases: [],
        events: [],
        assertions: [],
        tasks: [],
        clarificationCandidates: [],
        compilerNotes: [],
        droppedArtifacts: [],
        flags: {
          negatedTerms: [],
          explicitAliasLabels: [],
          blockedClarificationRefs: [],
          weakTopicsPreserved: [],
        },
      },
    );
    expect(result.passed).toBe(true);
  });
});
