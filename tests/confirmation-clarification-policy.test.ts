import { describe, expect, it } from 'vitest';
import type { ExtractorOutputV14 } from '../src/openai/extractor-v1.4.types.js';
import { MemoryCompilerV2Service } from '../src/services/memory-compiler-v2.service.js';
import {
  answeredClarificationResolvesConfirmationState,
  clarificationBundlesDayWithConfirmation,
  expandClarificationAnswerFromOptions,
  shouldSuppressConfirmationContradictionClarification,
  suppressStaleConfirmationContradictions,
} from '../src/services/confirmation-clarification-policy.js';
import { isTelegramPromptableClarification } from '../src/telegram/telegram-metadata.js';
import type { ClarificationRequest } from '../src/types/domain.js';

describe('confirmation-clarification-policy', () => {
  const answered = [
    {
      question: 'O Breno já confirmou que pode almoçar ou ainda está pendente?',
      answer: 'Breno confirmou apenas a disponibilidade (dia ainda não definido)',
      issue_type: 'possible_contradiction',
      target_reference: 'Breno confirmation',
    },
  ];

  it('expandClarificationAnswerFromOptions maps "3" to availability-only when options imply it', () => {
    const options = [
      'Sábado (manhã/tarde)',
      'Domingo (manhã/tarde)',
      'Apenas confirmou disponibilidade (sem dia)',
    ];
    expect(expandClarificationAnswerFromOptions('3', options)).toBe(options[2]);
  });

  it('detects bundled day+confirmation suggested answers', () => {
    expect(
      clarificationBundlesDayWithConfirmation({
        question: 'O Breno já confirmou?',
        suggested_answers: [
          'Breno confirmou que pode almoçar (indicar dia: sábado ou domingo)',
          'Ainda não, estou aguardando confirmação do Breno',
        ],
      }),
    ).toBe(true);
  });

  it('suppresses possible_contradiction after availability answer', () => {
    const contradiction = {
      issue_type: 'possible_contradiction',
      question: 'O Breno já confirmou que pode almoçar ou ainda está pendente?',
      reason: 'histórico conflitante',
      target_reference: 'Breno confirmation vs awaiting reply',
      suggested_answers: [] as string[],
    };
    expect(answeredClarificationResolvesConfirmationState(answered)).toBe(true);
    expect(shouldSuppressConfirmationContradictionClarification(contradiction, answered)).toBe(
      true,
    );
  });

  it('suppressStaleConfirmationContradictions strips LLM contradiction output', () => {
    const output: ExtractorOutputV14 = {
      schema_version: '1.4',
      events: [],
      aliases: [],
      assertions: [],
      review_hints: [
        {
          issue_type: 'possible_contradiction',
          target_reference: 'Breno',
          reason: 'conflito',
          source_excerpt: 'confirmou vs aguardando',
          confidence: 0.9,
        },
      ],
      task_signals: [],
      extraction_notes: [],
      correction_signals: [],
      entity_mentions: [],
      clarification_candidates: [
        {
          target_type: 'assertion',
          target_reference: 'Breno',
          issue_type: 'possible_contradiction',
          question: 'O Breno já confirmou?',
          reason: 'x',
          priority: 'high',
          blocking_scope: 'knowledge_confirmation',
          suggested_answers: [],
          source_excerpt: 'x',
          source_block_reference: null,
          confidence: 0.9,
        },
      ],
    };

    const next = suppressStaleConfirmationContradictions(output, answered);
    expect(next.clarification_candidates).toHaveLength(0);
    expect(next.review_hints).toHaveLength(0);
  });

  it('compiler drops contradiction when answered clarifications provided', () => {
    const compiler = new MemoryCompilerV2Service();
    const output: ExtractorOutputV14 = {
      schema_version: '1.4',
      events: [],
      aliases: [],
      assertions: [],
      review_hints: [],
      task_signals: [
        {
          title: 'Aguardar confirmação do Breno',
          due_at: 'sábado ou domingo',
          operation: 'create',
          task_kind: 'follow_up',
          confidence: 0.9,
          status_signal: 'open',
          blocked_reason: null,
          source_excerpt: 'O breno confirmou. Não sei, estou aguardando o retorno dele',
          task_reference: null,
          target_reference: 'Breno',
          project_reference: null,
          assignee_reference: 'eu',
          source_block_reference: null,
        },
      ],
      extraction_notes: [],
      correction_signals: [],
      entity_mentions: [],
      clarification_candidates: [
        {
          target_type: 'assertion',
          target_reference: 'Breno confirmation vs awaiting reply',
          issue_type: 'possible_contradiction',
          question: 'O Breno já confirmou que pode almoçar ou ainda está pendente?',
          reason: 'conflito',
          priority: 'high',
          blocking_scope: 'knowledge_confirmation',
          suggested_answers: [
            'Breno confirmou que pode almoçar (indicar dia: sábado ou domingo)',
            'Ainda não, estou aguardando confirmação do Breno',
          ],
          source_excerpt: 'O breno confirmou\nNão sei, estou aguardando o retorno dele',
          source_block_reference: null,
          confidence: 0.9,
        },
      ],
    };

    const compiled = compiler.compile({
      extractorOutput: output,
      effectiveInput: '[SOURCE_BLOCK:raw]\nO breno confirmou',
      resolverResult: { references: [], byReferenceText: new Map() },
      answeredClarifications: answered,
    });

    expect(compiled.clarificationCandidates).toHaveLength(0);
    expect(compiled.decision.status).toBe('accepted');
  });

  it('isTelegramPromptableClarification hides suppressed contradiction', () => {
    const c = {
      id: '1',
      status: 'pending',
      issue_type: 'possible_contradiction',
      blocking_scope: 'knowledge_confirmation',
      question: 'O Breno já confirmou?',
      reason: 'x',
      target_reference: 'Breno',
      suggested_answers: [
        'Breno confirmou (sábado ou domingo)',
        'Ainda aguardando',
      ],
    } as ClarificationRequest;
    expect(isTelegramPromptableClarification(c, answered)).toBe(false);
  });
});
