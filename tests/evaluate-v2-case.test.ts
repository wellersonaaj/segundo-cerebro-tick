import { describe, expect, it } from 'vitest';
import { evaluateV2Case } from '../src/calibration/extractor-v1.4/evaluate-v2-case.js';
import { matchesMustNotEntityMention } from '../src/calibration/extractor-v1.4/entity-mention-match.js';
import type { CompiledMemoryV2 } from '../src/types/memory-compiler-v2.js';

function minimalCompiled(overrides: Partial<CompiledMemoryV2> = {}): CompiledMemoryV2 {
  return {
    compilerVersion: 'memory-compiler-v2',
    resolvedEntities: [],
    aliases: [],
    events: [],
    assertions: [],
    tasks: [],
    clarificationCandidates: [],
    reviewHints: [],
    droppedArtifacts: [],
    compilerNotes: [],
    decision: { status: 'accepted', reasons: [], confidence: 0.9 },
    flags: {
      negatedReferences: [],
      supersededReferences: [],
      presentSourceBlocks: [],
      contextResolvedTasks: [],
      contextAmbiguousTasks: [],
    },
    taskSignalResolutions: [],
    contextResolutionEvidence: [],
    ...overrides,
  };
}

describe('evaluateV2Case', () => {
  it('must_not entity_mention uses exact match (Fox-3 ≠ Fox)', () => {
    const compiled = minimalCompiled({
      resolvedEntities: [{ mentionText: 'Fox-3', suggestedEntityType: 'person', entityId: null, canonicalName: null, resolutionStatus: 'unresolved', sourceExcerpt: 'x', confidence: 0.9 }],
    });
    const result = evaluateV2Case('t', compiled, 0, {
      must_not_have: { entity_mentions: ['Fox'] },
      decision: 'accepted',
    });
    expect(result.passed).toBe(true);
    expect(matchesMustNotEntityMention('Fox-3', 'Fox')).toBe(false);
  });

  it('accepts needs_clarification decision when primary contract ok and no blocking clarifications', () => {
    const compiled = minimalCompiled({
      decision: { status: 'needs_clarification', reasons: ['x'], confidence: 0.7 },
      assertions: [
        {
          assertionKind: 'opinion',
          subjectReference: 'Alex',
          predicate: 'prefers',
          objectReference: null,
          valueText: 'manhã',
          relatedEntityReferences: [],
          sourceExcerpt: 'x',
          sourceBlockReference: null,
          confidence: 0.9,
          subjectEntityId: null,
        },
      ],
    });
    const result = evaluateV2Case(
      'static',
      compiled,
      0,
      { must_have: { assertion_kinds: ['opinion'] }, decision: 'accepted' },
      { recommended: [] },
    );
    expect(result.passed).toBe(true);
  });

  it('validates task_operations matching', () => {
    const compiled = minimalCompiled({
      tasks: [
        {
          operation: 'update_due_date',
          taskReference: 'QA',
          title: 'QA',
          taskKind: 'other',
          statusSignal: 'unknown',
          assigneeReference: null,
          targetReference: null,
          projectReference: null,
          assigneeEntityId: null,
          projectEntityId: null,
          dueAt: 'segunda',
          blockedReason: null,
          sourceExcerpt: 'x',
          sourceBlockReference: null,
          confidence: 0.9,
        },
      ],
    });
    const result = evaluateV2Case('due', compiled, 0, {
      must_have: { task_operations: ['update_due_date'] },
      decision: 'accepted',
    });
    expect(result.passed).toBe(true);
  });
});
