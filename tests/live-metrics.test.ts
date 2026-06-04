import { describe, expect, it } from 'vitest';
import {
  accumulateV14Metrics,
  checkV14Thresholds,
  collectSourceBlockRefs,
  createV14MetricsAccumulator,
  finalizeV14Metrics,
} from '../src/calibration/extractor-v1.4/live-metrics.js';
import type { ExtractorOutputV14 } from '../src/openai/extractor-v1.4.types.js';
import type { CompiledMemoryV2 } from '../src/types/memory-compiler-v2.js';

function minimalOutput(overrides: Partial<ExtractorOutputV14> = {}): ExtractorOutputV14 {
  return {
    schema_version: '1.4',
    entity_mentions: [],
    aliases: [],
    events: [],
    correction_signals: [],
    assertions: [],
    task_signals: [],
    clarification_candidates: [],
    review_hints: [],
    extraction_notes: [],
    ...overrides,
  };
}

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

describe('live-metrics SOURCE_BLOCK', () => {
  it('counts only source_block_reference fields, not entity refs', () => {
    const acc = createV14MetricsAccumulator();
    const output = minimalOutput({
      assertions: [
        {
          assertion_kind: 'fact',
          subject_reference: 'Alex',
          predicate: 'is',
          object_reference: 'Chris',
          value_text: null,
          related_entity_references: ['Alex', 'Chris'],
          source_excerpt: 'x',
          source_block_reference: '[SOURCE_BLOCK:raw]',
          confidence: 0.9,
        },
      ],
    });

    accumulateV14Metrics(
      acc,
      { decision: 'accepted' },
      output,
      minimalCompiled(),
      { scenario_id: 't', passed: true, failures: [] },
      0,
      '[SOURCE_BLOCK:raw]\ntext',
      'static_preferences',
    );

    const metrics = finalizeV14Metrics(acc);
    expect(metrics.source_block_reference_validity).toBe(1);
  });

  it('ignores null source_block_reference', () => {
    const refs = collectSourceBlockRefs(
      minimalOutput({
        task_signals: [
          {
            operation: 'create',
            task_reference: null,
            title: 'T',
            task_kind: 'follow_up',
            status_signal: 'open',
            assignee_reference: null,
            target_reference: null,
            project_reference: null,
            due_at: null,
            blocked_reason: null,
            source_excerpt: 'x',
            source_block_reference: null,
            confidence: 0.9,
          },
        ],
      }),
    );
    expect(refs).toEqual([]);
  });
});

describe('live-metrics entity_precision N/A', () => {
  it('returns null when no applicable runs', () => {
    const acc = createV14MetricsAccumulator();
    accumulateV14Metrics(
      acc,
      { decision: 'accepted' },
      minimalOutput(),
      minimalCompiled(),
      { scenario_id: 't', passed: true, failures: [] },
      0,
      '[SOURCE_BLOCK:raw]',
      'task_open',
    );

    const metrics = finalizeV14Metrics(acc);
    expect(metrics.entity_precision_applicable_runs).toBe(0);
    expect(metrics.entity_precision_global).toBeNull();
    expect(metrics.entity_precision).toBeNull();
  });

  it('marks entity_precision threshold as not_applicable', () => {
    const acc = createV14MetricsAccumulator();
    const metrics = finalizeV14Metrics(acc);
    const checks = checkV14Thresholds(metrics, acc);
    const ep = checks.find((c) => c.metric === 'entity_precision_global');
    expect(ep).toMatchObject({ status: 'not_applicable', passed: true });
  });
});

describe('live-metrics preference_to_event_rate N/A', () => {
  it('marks preference_to_event_rate not_applicable when no static_preferences runs', () => {
    const acc = createV14MetricsAccumulator();
    accumulateV14Metrics(
      acc,
      { decision: 'accepted' },
      minimalOutput(),
      minimalCompiled(),
      { scenario_id: 't', passed: true, failures: [] },
      0,
      '[SOURCE_BLOCK:raw]',
      'explicit_alias',
    );
    const metrics = finalizeV14Metrics(acc);
    const checks = checkV14Thresholds(metrics, acc);
    const pref = checks.find((c) => c.metric === 'preference_to_event_rate');
    expect(pref).toMatchObject({ status: 'not_applicable', passed: true, value: null });
  });

  it('fails preference_to_event_rate when preference run emits events', () => {
    const acc = createV14MetricsAccumulator();
    accumulateV14Metrics(
      acc,
      { must_have: { assertion_kinds: ['opinion'] }, decision: 'accepted' },
      minimalOutput(),
      minimalCompiled({
        events: [
          {
            eventKind: 'meeting',
            title: 'meeting',
            occurredAt: null,
            relatedEntities: [],
            sourceExcerpt: 'x',
            sourceBlockReference: null,
            episodicConfidence: 0.9,
            confidence: 0.9,
          },
        ],
      }),
      { scenario_id: 't', passed: true, failures: [] },
      0,
      '[SOURCE_BLOCK:raw]',
      'static_preferences',
    );
    const metrics = finalizeV14Metrics(acc);
    expect(metrics.preference_to_event_rate).toBe(1);
    const checks = checkV14Thresholds(metrics, acc);
    const pref = checks.find((c) => c.metric === 'preference_to_event_rate');
    expect(pref).toMatchObject({ passed: false, value: 1 });
  });
});

describe('live-metrics negation_error_rate', () => {
  it('does not count evaluation.passed failure when only person name mentions negated former', () => {
    const acc = createV14MetricsAccumulator();
    const output = minimalOutput({
      aliases: [
        {
          alias: 'Zeta-1',
          target_reference: 'Gabriel Nova',
          negated_former_references: ['Helcio Zeta'],
          source_excerpt: 'x',
          confidence: 0.9,
        },
      ],
      entity_mentions: [
        {
          mention_text: 'Helcio Zeta',
          suggested_entity_type: 'person',
          source_excerpt: 'x',
          confidence: 0.9,
        },
      ],
    });
    accumulateV14Metrics(
      acc,
      { must_have: { alias_targets: ['Gabriel Nova'] }, decision: 'accepted' },
      output,
      minimalCompiled({
        aliases: [
          {
            alias: 'Zeta-1',
            targetReference: 'Gabriel Nova',
            targetEntityId: null,
            targetCanonicalName: 'Gabriel Nova',
            negatedFormerReferences: ['Helcio Zeta'],
            sourceExcerpt: 'x',
            confidence: 0.9,
            sourceBlockReference: null,
          },
        ],
        resolvedEntities: [
          {
            mentionText: 'Helcio Zeta',
            suggestedEntityType: 'person',
            entityId: null,
            canonicalName: null,
            resolutionStatus: 'resolved',
            sourceExcerpt: 'x',
            confidence: 0.9,
          },
        ],
      }),
      { scenario_id: 't', passed: false, failures: ['must_not_have entity_mention Zeta'] },
      0,
      '[SOURCE_BLOCK:raw]',
      'alias_negation',
    );
    expect(finalizeV14Metrics(acc).negation_error_rate).toBe(0);
  });

  it('counts event linking negated reference as negation error', () => {
    const acc = createV14MetricsAccumulator();
    const output = minimalOutput({
      aliases: [
        {
          alias: 'Fox-1',
          target_reference: 'Pat Lee',
          negated_former_references: ['Sam Fox'],
          source_excerpt: 'x',
          confidence: 0.9,
        },
      ],
      events: [
        {
          event_kind: 'meeting',
          title: 'x',
          source_excerpt: 'x',
          occurred_at: null,
          episodic_confidence: 0.9,
          related_entities: [{ entity_reference: 'Sam Fox', relation_type: 'participant', role: null }],
        },
      ],
    });
    accumulateV14Metrics(
      acc,
      { decision: 'accepted' },
      output,
      minimalCompiled({
        events: [
          {
            eventKind: 'meeting',
            title: 'x',
            occurredAt: null,
            episodicConfidence: 0.9,
            sourceExcerpt: 'x',
            confidence: 0.9,
            relatedEntities: [
              {
                entityReference: 'Sam Fox',
                entityId: null,
                canonicalName: null,
                relationType: 'participant',
                role: null,
                resolutionStatus: 'resolved',
              },
            ],
            sourceBlockReference: null,
          },
        ],
      }),
      { scenario_id: 't', passed: true, failures: [] },
      0,
      '[SOURCE_BLOCK:raw]',
      'alias_reassignment',
    );
    expect(finalizeV14Metrics(acc).negation_error_rate).toBe(1);
  });
});

describe('live-metrics task_operations', () => {
  it('task_recall uses compiled task operation', () => {
    const acc = createV14MetricsAccumulator();
    accumulateV14Metrics(
      acc,
      { must_have: { task_operations: ['update_due_date'] }, decision: 'accepted' },
      minimalOutput(),
      minimalCompiled({
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
            dueAt: 'segunda-feira',
            dueAtTemporal: null,
            blockedReason: null,
            sourceExcerpt: 'x',
            sourceBlockReference: null,
            confidence: 0.9,
          },
        ],
      }),
      { scenario_id: 't', passed: true, failures: [] },
      0,
      '[SOURCE_BLOCK:raw]',
      'task_due_date_change',
    );

    expect(finalizeV14Metrics(acc).task_recall).toBe(1);
  });
});
