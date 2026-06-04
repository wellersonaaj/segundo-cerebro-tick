import { describe, expect, it } from 'vitest';
import type { ExtractorOutputV14 } from '../src/openai/extractor-v1.4.types.js';
import { composeFollowUpMessage } from '../src/services/assistant-response-composer.js';
import { aggregateUncertaintyGaps } from '../src/services/uncertainty-aggregator.js';
import type { ClarificationRequest } from '../src/types/domain.js';

const esxClarification = {
  id: 'c1',
  inbox_item_id: 'inbox-1',
  status: 'pending',
  target_reference: 'ESX',
  question: 'O que é ESX?',
  suggested_answers: ['conferência de games', 'empresa'],
  source_excerpt: 'ir ao ESX',
  blocking_scope: 'knowledge_confirmation',
  issue_type: 'ambiguous_entity_type',
} as ClarificationRequest;

const esxOutput: ExtractorOutputV14 = {
  schema_version: '1.4',
  events: [],
  aliases: [],
  assertions: [],
  task_signals: [
    {
      title: 'Descobrir se ir ao ESX será bom para a Velt',
      due_at: null,
      operation: 'create',
      task_kind: 'follow_up',
      confidence: 0.9,
      status_signal: 'open',
      blocked_reason: null,
      source_excerpt: 'Preciso descobrir se ir ao ESX vai ser bom para nós da Velt',
      task_reference: null,
      target_reference: 'ESX',
      project_reference: null,
      assignee_reference: null,
      source_block_reference: '[SOURCE_BLOCK:raw]',
    },
  ],
  review_hints: [
    {
      issue_type: 'ambiguous_identity',
      target_reference: 'ESX',
      reason: 'referência ambígua',
      source_excerpt: 'ir ao ESX',
      confidence: 0.7,
    },
  ],
  extraction_notes: [],
  correction_signals: [],
  clarification_candidates: [],
  entity_mentions: [
    {
      mention_text: 'ESX',
      suggested_entity_type: 'other',
      source_excerpt: 'ir ao ESX',
      confidence: 0.9,
    },
  ],
};

describe('UncertaintyAggregator', () => {
  it('consolidates ESX-like gaps from clarifications and review hints', () => {
    const gaps = aggregateUncertaintyGaps({
      clarifications: [esxClarification],
      extractorOutput: esxOutput,
      maxGaps: 2,
    });
    expect(gaps.length).toBeGreaterThan(0);
    expect(gaps.some((g) => g.target_reference === 'ESX')).toBe(true);
  });

  it('limits to maxGaps', () => {
    const gaps = aggregateUncertaintyGaps({
      clarifications: [esxClarification],
      extractorOutput: esxOutput,
      maxGaps: 1,
    });
    expect(gaps.length).toBe(1);
  });
});

describe('AssistantResponseComposer', () => {
  it('includes task summary and clarification prompt', () => {
    const gaps = aggregateUncertaintyGaps({
      clarifications: [esxClarification],
      extractorOutput: esxOutput,
    });
    const message = composeFollowUpMessage({
      raw_content: 'Preciso descobrir se ir ao ESX vai ser bom para nós da Velt',
      processing_status: 'completed',
      tasks: [
        {
          id: 't1',
          inbox_item_id: 'inbox-1',
          title: 'Descobrir se ir ao ESX será bom para a Velt',
          description: null,
          status: 'open',
          task_kind: 'follow_up',
          due_at: null,
          target: null,
          source_excerpt: 'ESX',
        },
      ],
      clarifications: [esxClarification],
      gaps,
    });
    expect(message).toContain('Organizei sua captura');
    expect(message).toContain('Registrei');
    expect(message).toContain('ESX');
    expect(message).toContain('Confirmação');
  });

  it('reports failure explicitly', () => {
    const message = composeFollowUpMessage({
      raw_content: 'teste',
      processing_status: 'failed',
      tasks: [],
      clarifications: [],
      gaps: [],
      processing_error: 'compiler_rejected',
    });
    expect(message).toContain('Não consegui processar');
  });
});
