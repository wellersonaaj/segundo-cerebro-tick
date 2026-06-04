import { describe, expect, it } from 'vitest';
import { ClarificationManagerService } from '../src/services/clarification-manager.service.js';

describe('ClarificationManagerService', () => {
  const manager = new ClarificationManagerService();

  it('drops clarification for negated identity', () => {
    const recommended = manager.recommend({
      suggestedClarifications: [
        {
          target_type: 'entity',
          target_reference: 'Helcio',
          issue_type: 'ambiguous_entity_identity',
          question: 'Confirmar Helcio?',
          reason: 'ambiguidade',
          priority: 'low',
          blocking_scope: 'none',
          suggested_answers: [],
          source_excerpt: 'Helcio',
        },
      ],
      resolvedMap: { byExtractedName: new Map(), resolutions: [] },
      compilerFlags: {
        negatedTerms: [],
        explicitAliasLabels: [],
        blockedClarificationRefs: ['helcio'],
        weakTopicsPreserved: [],
      },
    });
    expect(recommended).toHaveLength(0);
  });

  it('keeps missing_task_target clarification', () => {
    const recommended = manager.recommend({
      suggestedClarifications: [
        {
          target_type: 'task',
          target_reference: 'Cobrar',
          issue_type: 'missing_task_target',
          question: 'Qual fornecedor?',
          reason: 'alvo ausente',
          priority: 'medium',
          blocking_scope: 'task_execution',
          suggested_answers: [],
          source_excerpt: 'fornecedor',
        },
      ],
      resolvedMap: { byExtractedName: new Map(), resolutions: [] },
      compilerFlags: {
        negatedTerms: [],
        explicitAliasLabels: [],
        blockedClarificationRefs: [],
        weakTopicsPreserved: [],
      },
    });
    expect(recommended).toHaveLength(1);
  });
});
