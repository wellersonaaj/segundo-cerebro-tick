import { describe, expect, it } from 'vitest';
import type { ClarificationRequest } from '../src/types/domain.js';
import {
  aggregateUncertaintyGaps,
  filterPersistableEphemeralGaps,
} from '../src/services/uncertainty-aggregator.js';
import type { ExtractorOutputV14 } from '../src/openai/extractor-v1.4.types.js';

describe('uncertainty-aggregator ephemeral dedupe', () => {
  const extractorOutput: ExtractorOutputV14 = {
    schema_version: '1.4',
    events: [],
    aliases: [],
    assertions: [],
    task_signals: [],
    extraction_notes: [],
    correction_signals: [],
    clarification_candidates: [],
    entity_mentions: [],
    review_hints: [
      {
        issue_type: 'ambiguous_identity',
        target_reference: 'ele',
        reason: 'pronome',
        source_excerpt: 'com ele',
        confidence: 0.5,
      },
    ],
  };

  const pendingClarification = {
    id: 'cl-1',
    status: 'pending',
    target_reference: 'ele',
    question: "Quem é 'ele'?",
    reason: 'x',
    priority: 'medium',
    blocking_scope: 'none',
    suggested_answers: [],
    source_excerpt: 'com ele',
  } as ClarificationRequest;

  it('does not surface review_hint gap for ele when compiled resolvedEntities say Breno', () => {
    const gaps = aggregateUncertaintyGaps({
      clarifications: [pendingClarification],
      extractorOutput,
      resolvedEntities: [
        {
          mentionText: 'ele',
          suggestedEntityType: 'person',
          entityId: 'breno-id',
          canonicalName: 'Breno Moreira',
          resolutionStatus: 'resolved',
          sourceExcerpt: 'com ele',
          confidence: 0.8,
        },
      ],
    });

    expect(gaps.some((g) => g.kind === 'review_hint' && g.target_reference === 'ele')).toBe(false);
    expect(gaps.some((g) => g.clarification_id === 'cl-1')).toBe(true);
  });

  it('filterPersistableEphemeralGaps skips duplicate review_hint when clarification pending', () => {
    const gaps = aggregateUncertaintyGaps({
      clarifications: [],
      extractorOutput,
    });
    const ephemeral = filterPersistableEphemeralGaps(gaps, [pendingClarification]);
    expect(ephemeral).toHaveLength(0);
  });

  it('does not emit unresolved_entity gap for monetary literals like "5 reais"', () => {
    const gaps = aggregateUncertaintyGaps({
      clarifications: [],
      extractorOutput: {
        ...extractorOutput,
        entity_mentions: [
          {
            mention_text: '5 reais',
            suggested_entity_type: 'other',
            source_excerpt: 'comprei café por 5 reais',
            confidence: 0.7,
            source_block_reference: '[SOURCE_BLOCK:raw]',
          },
        ],
      },
    });
    expect(gaps.some((g) => g.question.includes('5 reais'))).toBe(false);
  });
});
