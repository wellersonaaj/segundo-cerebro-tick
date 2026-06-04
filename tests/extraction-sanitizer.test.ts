import { describe, expect, it } from 'vitest';
import {
  applyPostResolutionSanitization,
  enrichEventDescriptionFromResolution,
  filterClarificationsAfterResolution,
  filterReviewReasonsAfterResolution,
} from '../src/services/extraction-sanitizer.service.js';
import type { EntityResolutionResult, ExtractorOutput } from '../src/types/domain.js';
import type { ResolvedEntityMap } from '../src/services/memory-resolver.service.js';

const geniusResolution: EntityResolutionResult = {
  extractedName: 'Genius',
  status: 'resolved',
  resolvedEntityId: 'e1',
  resolvedEntityName: 'Genius Hotels',
  method: 'exact_alias',
  confidence: 0.95,
  evidence: { match_type: 'exact_alias' },
  candidates: [],
};

const resolvedMap: ResolvedEntityMap = {
  byExtractedName: new Map([['genius', 'e1']]),
  resolutions: [geniusResolution],
};

describe('filterReviewReasonsAfterResolution', () => {
  it('remove review_reason obsoleto sobre tipo ambíguo de Genius', () => {
    const reasons = filterReviewReasonsAfterResolution(
      [
        "Tipo da entidade 'Genius' ambíguo entre empresa/produto/projeto",
        "Tipo da entidade 'Genius' é ambíguo e pode afetar recuperação futura.",
        "Ambiguidade no tipo da entidade 'Genius' que afeta como será armazenada e consultada.",
      ],
      [geniusResolution],
    );
    expect(reasons).toHaveLength(0);
  });
});

describe('filterClarificationsAfterResolution', () => {
  it('entidade ambígua resolvida por alias remove clarification obsoleta', () => {
    const { remaining, autoResolvedIndices } = filterClarificationsAfterResolution(
      [
        {
          target_type: 'entity',
          target_reference: 'Genius',
          issue_type: 'ambiguous_entity_type',
          question: 'Qual o tipo da entidade Genius?',
          reason: 'Tipo ambíguo',
          priority: 'medium',
          blocking_scope: 'knowledge_confirmation',
          suggested_answers: [],
          source_excerpt: 'Genius',
        },
      ],
      resolvedMap,
      resolvedMap.resolutions,
    );
    expect(autoResolvedIndices).toHaveLength(1);
    expect(remaining).toHaveLength(0);
  });

  it('tarefa incompleta gera pergunta mínima e suggested_answers sem contato/e-mail', () => {
    const { remaining } = filterClarificationsAfterResolution(
      [
        {
          target_type: 'task',
          target_reference: 'Cobrar o fornecedor',
          issue_type: 'missing_task_target',
          question: 'Qual fornecedor específico deve ser cobrado (nome/contato)?',
          reason: 'Alvo genérico',
          priority: 'medium',
          blocking_scope: 'task_execution',
          suggested_answers: [
            'Contato ou e-mail do fornecedor',
            'Confirmar qual fornecedor ou número do contrato',
          ],
          source_excerpt: 'cobrar o fornecedor',
        },
      ],
      { byExtractedName: new Map(), resolutions: [] },
      [],
    );
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.question).toBe('Qual fornecedor deve ser cobrado?');
    expect(remaining[0]?.reason).not.toMatch(/contato|e-?mail/i);
    expect(remaining[0]?.suggested_answers).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/contato|e-?mail/i)]),
    );
    expect(remaining[0]?.suggested_answers).toEqual(['Genius Hotels', 'Outro fornecedor']);
  });
});

describe('enrichEventDescriptionFromResolution', () => {
  it('evento preserva entidade relevante na descrição a partir do source_excerpt', () => {
    const event = enrichEventDescriptionFromResolution(
      {
        event_type: 'conversation',
        description: 'Conversa com Bruno sobre integração',
        occurred_at: null,
        source_excerpt:
          'Conversei com o Bruno sobre a integração da Genius. Acho que a liberação do IP pode atrasar.',
        confidence: 0.9,
        entity_names: ['Bruno', 'Genius'],
      },
      [geniusResolution],
    );
    expect(event.description.toLowerCase()).toMatch(/genius/);
    expect(event.description).toMatch(/integra/i);
  });

  it('normaliza Genius para Genius Hotels após resolução confiável', () => {
    const event = enrichEventDescriptionFromResolution(
      {
        event_type: 'conversation',
        description: 'Conversa com Bruno sobre a integração da Genius',
        occurred_at: null,
        source_excerpt: 'Conversei com o Bruno sobre a integração da Genius.',
        confidence: 0.9,
      },
      [geniusResolution],
    );
    expect(event.description).toContain('Genius Hotels');
  });
});

describe('applyPostResolutionSanitization', () => {
  it('combina filtros no output final', () => {
    const output: ExtractorOutput = {
      schema_version: '1.2',
      inbox_item_id: 'x',
      events: [
        {
          event_type: 'conversation',
          description: 'Conversa com Bruno sobre integração',
          occurred_at: null,
          source_excerpt: 'Conversei com o Bruno sobre a integração da Genius.',
          confidence: 0.9,
        },
      ],
      entities: [],
      assertions: [],
      tasks: [],
      clarification_requests: [
        {
          target_type: 'entity',
          target_reference: 'Genius',
          issue_type: 'ambiguous_entity_type',
          question: 'Tipo?',
          reason: 'x',
          priority: 'low',
          blocking_scope: 'knowledge_confirmation',
          suggested_answers: [],
          source_excerpt: 'x',
        },
      ],
      requires_review: true,
      review_reasons: ["Tipo da entidade 'Genius' ambíguo entre empresa/produto/projeto"],
      processing_notes: [],
    };

    const sanitized = applyPostResolutionSanitization(output, resolvedMap, {
      remaining: [],
      autoResolvedIndices: [0],
    });

    expect(sanitized.review_reasons).toHaveLength(0);
    expect(sanitized.requires_review).toBe(false);
    expect(sanitized.events[0]?.description.toLowerCase()).toMatch(/genius/);
  });
});
