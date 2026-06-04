import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ExtractorOutputV14 } from '../src/openai/extractor-v1.4.types.js';
import { FIXED_EXTRACTOR_FIXTURES } from '../src/calibration/extractor-v1.4/fixed-extractor-fixtures.js';
import { FIXED_CALIBRATION_EXPECTATIONS } from '../src/calibration/extractor-v1.4/fixed-calibration-expectations.js';
import { runV14ContextPipeline } from '../src/calibration/extractor-v1.4/run-v14-context-pipeline.js';
import {
  ClarificationManagerV2Service,
  type ClarificationManagerV2Input,
} from '../src/services/clarification-manager-v2.service.js';
import type { RegistryEntityFixture } from '../src/services/reference-resolver.service.js';

const baseOutput = (): ExtractorOutputV14 => ({
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
});

const emptyInput = (): ClarificationManagerV2Input => ({
  llmCandidates: [],
  compilerCandidates: [],
  resolverResult: { references: [], byReferenceText: new Map() },
  flags: {
    negatedReferences: [],
    supersededReferences: [],
    presentSourceBlocks: [],
    contextResolvedTasks: [],
    contextAmbiguousTasks: [],
  },
});

describe('ClarificationManagerV2Service', () => {
  const manager = new ClarificationManagerV2Service();

  it('drops clarification when correction_signal resolves current_reference', () => {
    const output: ExtractorOutputV14 = {
      ...baseOutput(),
      correction_signals: [
        {
          correction_type: 'replace_subject',
          previous_reference: 'Chris Oliveira',
          current_reference: 'Bruno Vega',
          source_excerpt: 'correção',
          source_block_reference: null,
          confidence: 0.9,
        },
      ],
      events: [
        {
          event_kind: 'meeting',
          title: 'Reunião',
          source_excerpt: 'x',
          occurred_at: null,
          episodic_confidence: 0.9,
          related_entities: [
            { entity_reference: 'Bruno Vega', relation_type: 'participant', role: null },
          ],
        },
      ],
    };

    const result = manager.classify({
      ...emptyInput(),
      llmCandidates: [
        {
          targetType: 'event',
          targetReference: 'Chris Oliveira',
          issueType: 'participant_conflict',
          question: 'Chris ou Bruno?',
          reason: 'correction',
          priority: 'medium',
          blockingScope: 'knowledge_confirmation',
          suggestedAnswers: [],
          sourceExcerpt: 'x',
          source: 'llm',
        },
      ],
      flags: {
        negatedReferences: ['chris oliveira'],
        supersededReferences: ['chris oliveira'],
        presentSourceBlocks: [],
        contextResolvedTasks: [],
        contextAmbiguousTasks: [],
      },
      extractorOutput: output,
    });

    expect(result.blocking).toHaveLength(0);
    expect(result.discarded).toHaveLength(1);
  });

  it('discards var N calibration noise', () => {
    const result = manager.classify({
      ...emptyInput(),
      llmCandidates: [
        {
          targetType: 'entity',
          targetReference: 'Alex Costa',
          issueType: 'missing_context',
          question: 'O que significa (var 3)?',
          reason: 'variação sintética',
          priority: 'low',
          blockingScope: 'none',
          suggestedAnswers: [],
          sourceExcerpt: 'x',
          source: 'llm',
        },
      ],
      effectiveInput: 'prefere reuniões (var 3)',
    });

    expect(result.blocking).toHaveLength(0);
    expect(result.discarded).toHaveLength(1);
  });

  it('classifies missing_assignee as discarded or non_blocking when create is registrable', () => {
    const result = manager.classify({
      ...emptyInput(),
      llmCandidates: [
        {
          targetType: 'task',
          targetReference: 'Revisar spec',
          issueType: 'missing_assignee',
          question: 'Quem?',
          reason: 'sem assignee',
          priority: 'high',
          blockingScope: 'task_execution',
          suggestedAnswers: [],
          sourceExcerpt: 'x',
          source: 'llm',
        },
      ],
      compiled: {
        tasks: [
          {
            operation: 'create',
            taskReference: null,
            title: 'Revisar spec',
            taskKind: 'review',
            statusSignal: 'open',
            assigneeReference: null,
            targetReference: 'spec',
            projectReference: null,
            assigneeEntityId: null,
            projectEntityId: null,
            dueAt: null,
            dueAtTemporal: null,
            blockedReason: null,
            sourceExcerpt: 'x',
            sourceBlockReference: null,
            confidence: 0.9,
          },
        ],
        assertions: [],
        events: [],
      },
    });
    expect(result.blocking).toHaveLength(0);
    expect(result.nonBlocking.length + result.discarded.length).toBe(1);
    expect(manager.computeFinalDecision(result).status).toBe('accepted');
  });

  it('classifies missing_due_date as non_blocking for registrable create', () => {
    const result = manager.classify({
      ...emptyInput(),
      llmCandidates: [
        {
          targetType: 'task',
          targetReference: 'Revisar contrato',
          issueType: 'missing_due_date',
          question: 'Qual prazo?',
          reason: 'sem prazo',
          priority: 'medium',
          blockingScope: 'task_execution',
          suggestedAnswers: [],
          sourceExcerpt: 'x',
          source: 'llm',
        },
      ],
      compiled: {
        tasks: [
          {
            operation: 'create',
            taskReference: null,
            title: 'Revisar contrato',
            taskKind: 'review',
            statusSignal: 'open',
            assigneeReference: null,
            targetReference: 'contrato',
            projectReference: null,
            assigneeEntityId: null,
            projectEntityId: null,
            dueAt: null,
            dueAtTemporal: null,
            blockedReason: null,
            sourceExcerpt: 'x',
            sourceBlockReference: null,
            confidence: 0.9,
          },
        ],
        assertions: [],
        events: [],
      },
    });
    expect(result.blocking).toHaveLength(0);
    expect(result.nonBlocking).toHaveLength(1);
    expect(result.nonBlocking[0]?.issueType).toBe('missing_due_date');
    expect(manager.computeFinalDecision(result).status).toBe('accepted');
  });

  it('classifies missing_assignee_or_due_date as non_blocking for registrable create', () => {
    const result = manager.classify({
      ...emptyInput(),
      llmCandidates: [
        {
          targetType: 'task',
          targetReference: 'Revisar contrato',
          issueType: 'missing_assignee_or_due_date',
          question: 'Responsável e prazo?',
          reason: 'incompleto',
          priority: 'high',
          blockingScope: 'task_execution',
          suggestedAnswers: [],
          sourceExcerpt: 'x',
          source: 'llm',
        },
      ],
      extractorOutput: {
        ...baseOutput(),
        task_signals: [
          {
            operation: 'create',
            task_reference: null,
            title: 'Revisar contrato',
            task_kind: 'review',
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
      },
      compiled: {
        tasks: [
          {
            operation: 'create',
            taskReference: null,
            title: 'Revisar contrato',
            taskKind: 'review',
            statusSignal: 'open',
            assigneeReference: null,
            targetReference: null,
            projectReference: null,
            assigneeEntityId: null,
            projectEntityId: null,
            dueAt: null,
            dueAtTemporal: null,
            blockedReason: null,
            sourceExcerpt: 'x',
            sourceBlockReference: null,
            confidence: 0.9,
          },
        ],
        assertions: [],
        events: [],
      },
    });
    expect(result.blocking).toHaveLength(0);
    expect(result.nonBlocking).toHaveLength(1);
    expect(manager.computeFinalDecision(result).status).toBe('accepted');
  });

  it('classifies ambiguous_date as non_blocking for context-resolved update_due_date with literal due_at', () => {
    const result = manager.classify({
      ...emptyInput(),
      llmCandidates: [
        {
          targetType: 'task',
          targetReference: 'revisão',
          issueType: 'ambiguous_date',
          question: 'Qual sexta?',
          reason: 'data relativa',
          priority: 'medium',
          blockingScope: 'knowledge_confirmation',
          suggestedAnswers: [],
          sourceExcerpt: 'x',
          source: 'llm',
        },
      ],
      compiled: {
        tasks: [
          {
            operation: 'update_due_date',
            taskReference: 'Revisar contrato',
            title: 'revisão',
            taskKind: 'review',
            statusSignal: 'unknown',
            assigneeReference: null,
            targetReference: null,
            projectReference: null,
            assigneeEntityId: null,
            projectEntityId: null,
            dueAt: 'sexta-feira',
            dueAtTemporal: null,
            blockedReason: null,
            sourceExcerpt: 'x',
            sourceBlockReference: null,
            confidence: 0.9,
          },
        ],
        assertions: [],
        events: [],
      },
      taskSignalResolutions: [
        {
          taskSignalIndex: 0,
          operation: 'update_due_date',
          outcome: {
            status: 'resolved',
            taskId: 'task-1',
            canonicalReference: 'Revisar contrato',
            bestScore: 0.56,
            resolutionReason: 'score_above_margin',
          },
        },
      ],
      contextResolutionEvidence: [
        {
          taskSignalIndex: 0,
          taskId: 'task-1',
          resolutionSource: 'thread_affinity',
          bestScore: 0.56,
          candidateCountBeforeTruncation: 1,
          resolutionReason: 'score_above_margin',
        },
      ],
    });
    expect(result.blocking).toHaveLength(0);
    expect(result.nonBlocking).toHaveLength(1);
    expect(result.nonBlocking[0]?.issueType).toBe('ambiguous_date');
    expect(manager.computeFinalDecision(result).status).toBe('accepted');
  });

  it('keeps update_due_date without due_at as blocking', () => {
    const result = manager.classify({
      ...emptyInput(),
      compilerCandidates: [
        {
          targetType: 'task',
          targetReference: 'revisão',
          issueType: 'missing_task_reference',
          question: 'Qual tarefa?',
          reason: 'sem referência',
          priority: 'high',
          blockingScope: 'task_execution',
          suggestedAnswers: [],
          sourceExcerpt: 'x',
          source: 'compiler',
        },
      ],
      extractorOutput: {
        ...baseOutput(),
        task_signals: [
          {
            operation: 'update_due_date',
            task_reference: 'revisão',
            title: null,
            task_kind: null,
            status_signal: null,
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
      },
    });
    expect(result.blocking.length).toBeGreaterThan(0);
    expect(manager.computeFinalDecision(result).status).toBe('needs_clarification');
  });

  it('keeps blocking ambiguous identity', () => {
    const result = manager.classify({
      ...emptyInput(),
      llmCandidates: [
        {
          targetType: 'entity',
          targetReference: 'Chris',
          issueType: 'ambiguous_identity',
          question: 'Chris Oliveira ou Chris Mendes?',
          reason: 'identidade ambígua',
          priority: 'high',
          blockingScope: 'knowledge_confirmation',
          suggestedAnswers: ['Oliveira', 'Mendes'],
          sourceExcerpt: 'x',
          source: 'llm',
        },
      ],
    });

    expect(result.blocking).toHaveLength(1);
    expect(manager.computeFinalDecision(result).status).toBe('needs_clarification');
  });

  it('classifies unclear_scope as non_blocking for registrable create', () => {
    const result = manager.classify({
      ...emptyInput(),
      llmCandidates: [
        {
          targetType: 'task',
          targetReference: 'Revisar contrato',
          issueType: 'unclear_scope',
          question: 'Que aspectos revisar?',
          reason: 'escopo não especificado',
          priority: 'medium',
          blockingScope: 'task_execution',
          suggestedAnswers: [],
          sourceExcerpt: 'x',
          source: 'llm',
        },
      ],
      compiled: {
        tasks: [
          {
            operation: 'create',
            taskReference: null,
            title: 'Revisar contrato',
            taskKind: 'review',
            statusSignal: 'open',
            assigneeReference: null,
            targetReference: 'contrato',
            projectReference: null,
            assigneeEntityId: null,
            projectEntityId: null,
            dueAt: null,
            dueAtTemporal: null,
            blockedReason: null,
            sourceExcerpt: 'x',
            sourceBlockReference: null,
            confidence: 0.9,
          },
        ],
        assertions: [],
        events: [],
      },
    });
    expect(result.blocking).toHaveLength(0);
    expect(result.nonBlocking).toHaveLength(1);
    expect(result.nonBlocking[0]?.issueType).toBe('unclear_scope');
    expect(manager.computeFinalDecision(result).status).toBe('accepted');
  });

  it('S1: knowledge_confirmation periférica (não registry-eligible) → non_blocking', () => {
    const output = {
      entity_mentions: [
        {
          mention_text: 'Marcelo Oliveira',
          suggested_entity_type: 'person',
          source_excerpt: 'x',
          confidence: 0.9,
        },
        {
          mention_text: 'integração',
          suggested_entity_type: 'topic',
          source_excerpt: 'x',
          confidence: 0.6,
        },
      ],
      events: [],
      assertions: [],
      aliases: [],
      correction_signals: [],
      task_signals: [],
      clarification_candidates: [],
      review_hints: [],
    } as import('../src/openai/extractor-v1.4.types.js').ExtractorOutputV14;

    const result = manager.classify({
      ...emptyInput(),
      llmCandidates: [
        {
          targetType: 'entity',
          targetReference: 'reunião sobre a integração',
          issueType: 'ambiguous_entity_identity',
          question: 'Tópico ambíguo',
          reason: 'peripheral',
          priority: 'medium',
          blockingScope: 'knowledge_confirmation',
          suggestedAnswers: [],
          sourceExcerpt: 'x',
          source: 'llm',
        },
      ],
      extractorOutput: output,
    });

    expect(result.blocking).toHaveLength(0);
    expect(result.nonBlocking).toHaveLength(1);
    expect(result.nonBlocking[0]?.materiality).toBe('non_blocking');
  });

  it('keeps unclear_scope blocking when immediate external action is present', () => {
    const result = manager.classify({
      ...emptyInput(),
      llmCandidates: [
        {
          targetType: 'task',
          targetReference: 'Revisar contrato',
          issueType: 'unclear_scope',
          question: 'Que aspectos revisar?',
          reason: 'escopo não especificado',
          priority: 'medium',
          blockingScope: 'task_execution',
          suggestedAnswers: [],
          sourceExcerpt: 'x',
          source: 'llm',
        },
        {
          targetType: 'external_action',
          targetReference: 'contrato',
          issueType: 'missing_external_action_target',
          question: 'Para quem enviar?',
          reason: 'ação externa incompleta',
          priority: 'high',
          blockingScope: 'external_action',
          suggestedAnswers: [],
          sourceExcerpt: 'x',
          source: 'llm',
        },
      ],
      compiled: {
        tasks: [
          {
            operation: 'create',
            taskReference: null,
            title: 'Revisar contrato',
            taskKind: 'review',
            statusSignal: 'open',
            assigneeReference: null,
            targetReference: 'contrato',
            projectReference: null,
            assigneeEntityId: null,
            projectEntityId: null,
            dueAt: null,
            dueAtTemporal: null,
            blockedReason: null,
            sourceExcerpt: 'x',
            sourceBlockReference: null,
            confidence: 0.9,
          },
        ],
        assertions: [],
        events: [],
      },
    });
    expect(result.blocking.some((c) => c.issueType === 'unclear_scope')).toBe(true);
    expect(manager.computeFinalDecision(result).status).toBe('needs_clarification');
  });

  it('keeps unclear_scope blocking for update_due_date without task_reference', () => {
    const result = manager.classify({
      ...emptyInput(),
      llmCandidates: [
        {
          targetType: 'task',
          targetReference: 'revisão',
          issueType: 'unclear_scope',
          question: 'Qual revisão?',
          reason: 'escopo vago',
          priority: 'medium',
          blockingScope: 'task_execution',
          suggestedAnswers: [],
          sourceExcerpt: 'x',
          source: 'llm',
        },
      ],
      extractorOutput: {
        ...baseOutput(),
        task_signals: [
          {
            operation: 'update_due_date',
            task_reference: null,
            title: null,
            task_kind: null,
            status_signal: null,
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
      },
    });
    expect(result.blocking.some((c) => c.issueType === 'unclear_scope')).toBe(true);
    expect(manager.computeFinalDecision(result).status).toBe('needs_clarification');
  });

  it('keeps ambiguous_task_reference blocking alongside unclear_scope on update', () => {
    const result = manager.classify({
      ...emptyInput(),
      compilerCandidates: [
        {
          targetType: 'task',
          targetReference: 'revisão',
          issueType: 'ambiguous_task_reference',
          question: 'Qual tarefa?',
          reason: 'duas candidatas',
          priority: 'high',
          blockingScope: 'task_execution',
          suggestedAnswers: ['A', 'B'],
          sourceExcerpt: 'x',
          source: 'compiler',
        },
      ],
      llmCandidates: [
        {
          targetType: 'task',
          targetReference: 'revisão',
          issueType: 'unclear_scope',
          question: 'Escopo?',
          reason: 'vago',
          priority: 'medium',
          blockingScope: 'task_execution',
          suggestedAnswers: [],
          sourceExcerpt: 'x',
          source: 'llm',
        },
      ],
      taskSignalResolutions: [
        {
          taskSignalIndex: 0,
          operation: 'update_due_date',
          outcome: { status: 'ambiguous', candidateCountBeforeTruncation: 2 },
        },
      ],
    });
    expect(result.blocking.some((c) => c.issueType === 'ambiguous_task_reference')).toBe(true);
    expect(result.blocking.some((c) => c.issueType === 'unclear_scope')).toBe(true);
    expect(manager.computeFinalDecision(result).status).toBe('needs_clarification');
  });

  it('project status_update: ambiguous_date and unclear_scope are non_blocking when status is registrable', () => {
    const result = manager.classify({
      ...emptyInput(),
      llmCandidates: [
        {
          targetType: 'entity',
          targetReference: 'Projeto Atlas',
          issueType: 'other',
          question: 'Quem mitiga o risco?',
          reason: 'owner opcional',
          priority: 'high',
          blockingScope: 'task_execution',
          suggestedAnswers: [],
          sourceExcerpt: 'Projeto Atlas está em risco na sprint 4.',
          source: 'llm',
        },
        {
          targetType: 'entity',
          targetReference: 'sprint 4',
          issueType: 'ambiguous_date',
          question: 'Datas da sprint?',
          reason: 'sprint sem data absoluta',
          priority: 'medium',
          blockingScope: 'knowledge_confirmation',
          suggestedAnswers: [],
          sourceExcerpt: 'Projeto Atlas está em risco na sprint 4.',
          source: 'llm',
        },
        {
          targetType: 'assertion',
          targetReference: 'Projeto Atlas',
          issueType: 'unclear_scope',
          question: 'O que significa em risco?',
          reason: 'escopo do risco',
          priority: 'high',
          blockingScope: 'task_execution',
          suggestedAnswers: [],
          sourceExcerpt: 'Projeto Atlas está em risco na sprint 4.',
          source: 'llm',
        },
      ],
      compiled: {
        tasks: [],
        events: [],
        assertions: [
          {
            assertionKind: 'status_update',
            subjectReference: 'Projeto Atlas',
            predicate: 'status',
            objectReference: 'sprint 4',
            valueText: 'em risco',
            relatedEntityReferences: ['sprint 4'],
            sourceExcerpt: 'Projeto Atlas está em risco na sprint 4.',
            sourceBlockReference: '[SOURCE_BLOCK:raw]',
            confidence: 0.9,
            subjectEntityId: null,
          },
        ],
      },
    });
    expect(result.blocking).toHaveLength(0);
    expect(result.nonBlocking.map((c) => c.issueType).sort()).toEqual([
      'ambiguous_date',
      'other',
      'unclear_scope',
    ]);
    expect(manager.computeFinalDecision(result).status).toBe('accepted');
  });

  const registrableStatusAssertion = {
    assertionKind: 'status_update' as const,
    subjectReference: 'Projeto Atlas',
    predicate: 'status',
    objectReference: 'sprint 4',
    valueText: 'em risco',
    relatedEntityReferences: ['sprint 4'],
    sourceExcerpt: 'Projeto Atlas está em risco na sprint 4.',
    sourceBlockReference: '[SOURCE_BLOCK:raw]' as const,
    confidence: 0.9,
    subjectEntityId: null as string | null,
  };

  it('project_status_update registrável + unclear_scope stays non_blocking when only review_hint has ambiguous_entity_type', () => {
    const result = manager.classify({
      ...emptyInput(),
      extractorOutput: {
        ...baseOutput(),
        review_hints: [
          {
            issue_type: 'ambiguous_entity_type',
            target_reference: 'sprint 4',
            reason: 'sprint mention',
            source_excerpt: 'x',
            confidence: 0.6,
          },
        ],
      },
      llmCandidates: [
        {
          targetType: 'assertion',
          targetReference: 'Projeto Atlas',
          issueType: 'unclear_scope',
          question: 'Qual tipo de risco?',
          reason: 'enrichment',
          priority: 'medium',
          blockingScope: 'knowledge_confirmation',
          suggestedAnswers: [],
          sourceExcerpt: 'x',
          source: 'llm',
        },
      ],
      compiled: {
        tasks: [],
        events: [],
        assertions: [registrableStatusAssertion],
      },
    });
    expect(result.blocking).toHaveLength(0);
    expect(result.nonBlocking).toHaveLength(1);
    expect(manager.computeFinalDecision(result).status).toBe('accepted');
  });

  it('status_update_missing_value → blocking', () => {
    const result = manager.classify({
      ...emptyInput(),
      compilerCandidates: [
        {
          targetType: 'assertion',
          targetReference: 'Projeto Atlas',
          issueType: 'status_update_missing_value',
          question: 'Qual é o novo valor vigente de status?',
          reason: 'status_update_missing_value',
          priority: 'high',
          blockingScope: 'knowledge_confirmation',
          suggestedAnswers: [],
          sourceExcerpt: 'x',
          source: 'compiler',
        },
      ],
      llmCandidates: [
        {
          targetType: 'assertion',
          targetReference: 'Projeto Atlas',
          issueType: 'unclear_scope',
          question: 'Qual tipo de risco?',
          reason: 'enrichment',
          priority: 'medium',
          blockingScope: 'knowledge_confirmation',
          suggestedAnswers: [],
          sourceExcerpt: 'x',
          source: 'llm',
        },
      ],
      compiled: { tasks: [], events: [], assertions: [] },
    });
    expect(result.blocking.some((c) => c.issueType === 'status_update_missing_value')).toBe(true);
    expect(manager.computeFinalDecision(result).status).toBe('needs_clarification');
  });

  it('project_status_update registrável + other → non_blocking → finalDecision accepted', () => {
    const result = manager.classify({
      ...emptyInput(),
      llmCandidates: [
        {
          targetType: 'entity',
          targetReference: 'Projeto Atlas',
          issueType: 'other',
          question: 'Quem é o owner para mitigar o risco?',
          reason: 'falta responsável pela mitigação',
          priority: 'high',
          blockingScope: 'task_execution',
          suggestedAnswers: [],
          sourceExcerpt: 'Projeto Atlas está em risco na sprint 4.',
          source: 'llm',
        },
      ],
      compiled: {
        tasks: [],
        events: [],
        assertions: [registrableStatusAssertion],
      },
    });
    expect(result.blocking).toHaveLength(0);
    expect(result.nonBlocking).toHaveLength(1);
    expect(result.nonBlocking[0]?.issueType).toBe('other');
    expect(manager.computeFinalDecision(result).status).toBe('accepted');
  });

  it('project_status_update incompleto + other → blocking', () => {
    const result = manager.classify({
      ...emptyInput(),
      llmCandidates: [
        {
          targetType: 'entity',
          targetReference: 'Projeto Atlas',
          issueType: 'other',
          question: 'Qual o status?',
          reason: 'status ausente',
          priority: 'high',
          blockingScope: 'task_execution',
          suggestedAnswers: [],
          sourceExcerpt: 'x',
          source: 'llm',
        },
      ],
      compiled: {
        tasks: [],
        events: [],
        assertions: [
          {
            ...registrableStatusAssertion,
            valueText: '',
          },
        ],
      },
    });
    expect(result.blocking).toHaveLength(1);
    expect(result.blocking[0]?.issueType).toBe('other');
  });

  it('project_status_update + possible_contradiction + other → blocking', () => {
    const result = manager.classify({
      ...emptyInput(),
      llmCandidates: [
        {
          targetType: 'assertion',
          targetReference: 'Projeto Atlas',
          issueType: 'possible_contradiction',
          question: 'Contradiz registro anterior?',
          reason: 'conflito',
          priority: 'high',
          blockingScope: 'knowledge_confirmation',
          suggestedAnswers: [],
          sourceExcerpt: 'x',
          source: 'llm',
        },
        {
          targetType: 'entity',
          targetReference: 'Projeto Atlas',
          issueType: 'other',
          question: 'Owner?',
          reason: 'enrichment',
          priority: 'medium',
          blockingScope: 'task_execution',
          suggestedAnswers: [],
          sourceExcerpt: 'x',
          source: 'llm',
        },
      ],
      compiled: {
        tasks: [],
        events: [],
        assertions: [registrableStatusAssertion],
      },
    });
    expect(result.blocking.some((c) => c.issueType === 'possible_contradiction')).toBe(true);
    expect(result.blocking.some((c) => c.issueType === 'other')).toBe(true);
  });

  it('ação externa + other → blocking', () => {
    const result = manager.classify({
      ...emptyInput(),
      extractorOutput: {
        ...baseOutput(),
        events: [
          {
            event_kind: 'document_sent',
            title: 'doc',
            source_excerpt: 'x',
            occurred_at: null,
            episodic_confidence: 0.9,
            related_entities: [],
          },
        ],
      },
      llmCandidates: [
        {
          targetType: 'entity',
          targetReference: 'Projeto Atlas',
          issueType: 'other',
          question: 'Owner?',
          reason: 'x',
          priority: 'medium',
          blockingScope: 'task_execution',
          suggestedAnswers: [],
          sourceExcerpt: 'x',
          source: 'llm',
        },
      ],
      compiled: {
        tasks: [],
        events: [],
        assertions: [registrableStatusAssertion],
      },
    });
    expect(result.blocking.some((c) => c.issueType === 'other')).toBe(true);
  });

  it('task update + other → blocking', () => {
    const result = manager.classify({
      ...emptyInput(),
      llmCandidates: [
        {
          targetType: 'entity',
          targetReference: 'Projeto Atlas',
          issueType: 'other',
          question: 'Owner?',
          reason: 'x',
          priority: 'medium',
          blockingScope: 'task_execution',
          suggestedAnswers: [],
          sourceExcerpt: 'x',
          source: 'llm',
        },
      ],
      compiled: {
        tasks: [
          {
            operation: 'update_due_date',
            taskReference: 'QA',
            title: 'QA',
            taskKind: 'other',
            statusSignal: 'open',
            assigneeReference: null,
            targetReference: null,
            projectReference: null,
            assigneeEntityId: null,
            projectEntityId: null,
            dueAt: 'sexta',
            dueAtTemporal: null,
            blockedReason: null,
            sourceExcerpt: 'x',
            sourceBlockReference: null,
            confidence: 0.9,
          },
        ],
        events: [],
        assertions: [registrableStatusAssertion],
      },
    });
    expect(result.blocking.some((c) => c.issueType === 'other')).toBe(true);
  });

  it('computeFinalDecision ignores blockingScope none in blocking array', () => {
    const result = manager.classify({
      ...emptyInput(),
      llmCandidates: [
        {
          targetType: 'entity',
          targetReference: 'Projeto Atlas',
          issueType: 'unclear_scope',
          question: 'Detalhes?',
          reason: 'enrichment',
          priority: 'medium',
          blockingScope: 'none',
          suggestedAnswers: [],
          sourceExcerpt: 'x',
          source: 'llm',
        },
      ],
      compiled: {
        tasks: [],
        events: [],
        assertions: [
          {
            ...registrableStatusAssertion,
            valueText: '',
          },
        ],
      },
    });
    expect(manager.computeFinalDecision(result).status).toBe('accepted');
    expect(manager.computeFinalDecision(result).blockingCount).toBe(0);
  });

  it('keeps issue_type other blocking by default for registrable create', () => {
    const result = manager.classify({
      ...emptyInput(),
      llmCandidates: [
        {
          targetType: 'task',
          targetReference: 'Revisar contrato',
          issueType: 'other',
          question: 'Qual versão do contrato?',
          reason: 'nuance não coberta pelo enum canônico',
          priority: 'medium',
          blockingScope: 'task_execution',
          suggestedAnswers: [],
          sourceExcerpt: 'x',
          source: 'llm',
        },
      ],
      compiled: {
        tasks: [
          {
            operation: 'create',
            taskReference: null,
            title: 'Revisar contrato',
            taskKind: 'review',
            statusSignal: 'open',
            assigneeReference: null,
            targetReference: 'contrato',
            projectReference: null,
            assigneeEntityId: null,
            projectEntityId: null,
            dueAt: null,
            dueAtTemporal: null,
            blockedReason: null,
            sourceExcerpt: 'x',
            sourceBlockReference: null,
            confidence: 0.9,
          },
        ],
        assertions: [],
        events: [],
      },
    });
    expect(result.blocking).toHaveLength(1);
    expect(result.blocking[0]?.issueType).toBe('other');
    expect(manager.computeFinalDecision(result).status).toBe('needs_clarification');
  });
});

describe('ClarificationManagerV2 pipeline integration', () => {
  const registry = JSON.parse(
    readFileSync(join('data/calibration/extractor-v1.4/registry-fixture.json'), 'utf8'),
  ) as { entities: RegistryEntityFixture[] };

  it('incremental ambiguous keeps ambiguous_task_reference blocking with finalDecision needs_clarification', () => {
    const sid = 'v14-ctx-due-date-ambiguous';
    const caseFile = JSON.parse(
      readFileSync(join('data/calibration/extractor-v1.4/cases', `${sid}.json`), 'utf8'),
    );
    const output = FIXED_EXTRACTOR_FIXTURES[sid]!;
    const expected = FIXED_CALIBRATION_EXPECTATIONS[sid]!;

    const pipeline = runV14ContextPipeline({
      scenarioId: sid,
      extractorOutput: output,
      expected,
      caseFile,
      registryEntities: registry.entities,
    });

    expect(pipeline.compilerDecision.status).toBe('needs_clarification');
    expect(pipeline.finalDecision.status).toBe('needs_clarification');
    expect(pipeline.finalDecision.blockingCount).toBeGreaterThan(0);
    expect(
      pipeline.clarificationMateriality.blocking.some(
        (c) => c.issueType === 'ambiguous_task_reference',
      ),
    ).toBe(true);
    expect(pipeline.evaluation.passed).toBe(true);
  });

  it('incremental unique preserves literal due_at and finalDecision accepted', () => {
    const sid = 'v14-ctx-due-date-unique';
    const caseFile = JSON.parse(
      readFileSync(join('data/calibration/extractor-v1.4/cases', `${sid}.json`), 'utf8'),
    );
    const output = FIXED_EXTRACTOR_FIXTURES[sid]!;
    const expected = FIXED_CALIBRATION_EXPECTATIONS[sid]!;

    const pipeline = runV14ContextPipeline({
      scenarioId: sid,
      extractorOutput: output,
      expected,
      caseFile,
      registryEntities: registry.entities,
    });

    expect(pipeline.compiled.tasks[0]?.dueAt).toBe('sexta');
    expect(pipeline.finalDecision.status).toBe('accepted');
    expect(pipeline.evaluation.passed).toBe(true);
  });
});
