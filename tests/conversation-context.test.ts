import { describe, expect, it } from 'vitest';
import type { ExtractorOutputV14 } from '../src/openai/extractor-v1.4.types.js';
import {
  applyImplicitAssigneeToOutput,
  hasImplicitFirstPersonAssignee,
  shouldSkipAssigneeUncertaintyGap,
} from '../src/services/implicit-assignee.service.js';
import {
  applyInTextPronounCoreference,
  applyThreadPronounCoreference,
  collectResolvedThreadPronouns,
  isThirdPersonObjectPronoun,
} from '../src/services/pronoun-coreference.service.js';
import {
  formatThreadContextForExtractor,
  prependThreadContextToEffectiveInput,
  resolveThreadSalientPerson,
  type ThreadConversationContext,
} from '../src/services/thread-conversation-context.service.js';
import { ReferenceResolverService } from '../src/services/reference-resolver.service.js';
import { aggregateUncertaintyGaps } from '../src/services/uncertainty-aggregator.js';

const registry = [
  {
    id: 'lari-id',
    name: 'Larisse do Carmo Peixoto',
    normalized_name: 'larisse do carmo peixoto',
    entity_type: 'person',
    aliases: ['Lari', 'lari'],
  },
];

const threadContext: ThreadConversationContext = {
  threadId: 'telegram:chat:1',
  recentMessages: [
    {
      inboxItemId: 'prev-1',
      rawContent: 'Marquei de encontrar com a lari hoje',
      createdAt: '2026-06-04T02:07:00.000Z',
    },
  ],
  salientEntities: [
    {
      reference: 'lari',
      canonicalName: 'Larisse do Carmo Peixoto',
      entityType: 'person',
      inboxItemId: 'prev-1',
    },
  ],
};

describe('implicit assignee', () => {
  it('detects first-person commitment verbs', () => {
    expect(hasImplicitFirstPersonAssignee('Marquei de encontrar com a lari hoje')).toBe(true);
    expect(hasImplicitFirstPersonAssignee('Eu mesmo, mas preciso chamar ela')).toBe(true);
  });

  it('infers assignee eu on task signals', () => {
    const output: ExtractorOutputV14 = {
      schema_version: '1.4',
      events: [],
      aliases: [],
      assertions: [],
      task_signals: [
        {
          title: 'Encontrar com a lari',
          due_at: 'hoje',
          operation: 'create',
          task_kind: 'other',
          confidence: 0.9,
          status_signal: 'open',
          blocked_reason: null,
          source_excerpt: 'Marquei de encontrar com a lari hoje',
          task_reference: null,
          target_reference: 'lari',
          project_reference: null,
          assignee_reference: null,
          source_block_reference: '[SOURCE_BLOCK:raw]',
        },
      ],
      review_hints: [],
      extraction_notes: [],
      correction_signals: [],
      clarification_candidates: [],
      entity_mentions: [],
    };

    const patched = applyImplicitAssigneeToOutput(output, 'conversational', output.task_signals[0]!.source_excerpt);
    expect(patched.task_signals[0]?.assignee_reference).toBe('eu');
    expect(shouldSkipAssigneeUncertaintyGap(patched.task_signals[0]!, 'conversational')).toBe(true);
  });
});

describe('thread pronoun coreference', () => {
  it('formats thread context for extractor', () => {
    const block = formatThreadContextForExtractor(threadContext);
    expect(block).toContain('Mensagem anterior');
    expect(block).toContain('lari');
    expect(prependThreadContextToEffectiveInput('[SOURCE_BLOCK:raw]\nOi', threadContext)).toContain(
      '[CONTEXTO_DA_CONVERSA]',
    );
  });

  it('in-text ele antecedent wins over stale thread salient when Breno precedes ele', () => {
    const excerpt =
      'Mandei mensagem para o Breno sugerindo que eu e o Brant almocemos com ele sábado ou domingo.';
    const output: ExtractorOutputV14 = {
      schema_version: '1.4',
      events: [],
      aliases: [],
      assertions: [],
      task_signals: [],
      review_hints: [],
      extraction_notes: [],
      correction_signals: [],
      clarification_candidates: [],
      entity_mentions: [
        { mention_text: 'Breno', suggested_entity_type: 'person', source_excerpt: excerpt, confidence: 0.98 },
        { mention_text: 'ele', suggested_entity_type: 'person', source_excerpt: excerpt, confidence: 0.8 },
      ],
    };

    const brenoRegistry = [
      ...registry,
      {
        id: 'breno-id',
        name: 'Breno Moreira',
        normalized_name: 'breno moreira',
        entity_type: 'person',
        aliases: ['Breno'],
      },
    ];

    const resolver = new ReferenceResolverService(brenoRegistry);
    let result = resolver.resolveReferences(['Breno', 'ele']);
    result = applyInTextPronounCoreference(result, output);
    result = applyThreadPronounCoreference(result, 'conversational', threadContext);

    expect(result.byReferenceText.get('ele')?.entity_id).toBe('breno-id');
    expect(result.byReferenceText.get('ele')?.canonical_name).toContain('Breno');
  });

  it('resolves ela to salient thread person', () => {
    const output: ExtractorOutputV14 = {
      schema_version: '1.4',
      events: [],
      aliases: [],
      assertions: [],
      task_signals: [
        {
          title: 'Ligar para ela para confirmar horário',
          due_at: null,
          operation: 'create',
          task_kind: 'follow_up',
          confidence: 0.9,
          status_signal: 'open',
          blocked_reason: null,
          source_excerpt: 'preciso chamar ela mais tarde',
          task_reference: null,
          target_reference: 'ela',
          project_reference: null,
          assignee_reference: 'eu',
          source_block_reference: '[SOURCE_BLOCK:raw]',
        },
      ],
      review_hints: [],
      extraction_notes: [],
      correction_signals: [],
      clarification_candidates: [
        {
          target_type: 'entity',
          target_reference: 'ela',
          issue_type: 'ambiguous_identity',
          question: "Quem é 'ela'?",
          reason: 'pronome',
          priority: 'medium',
          blocking_scope: 'knowledge_confirmation',
          suggested_answers: [],
          source_excerpt: 'chamar ela',
          source_block_reference: '[SOURCE_BLOCK:raw]',
          confidence: 0.7,
        },
      ],
      entity_mentions: [
        {
          mention_text: 'ela',
          suggested_entity_type: 'person',
          source_excerpt: 'chamar ela',
          confidence: 0.6,
        },
      ],
    };

    const resolver = new ReferenceResolverService(registry);
    let result = resolver.resolveReferences(['ela', 'lari']);
    result = applyThreadPronounCoreference(result, 'conversational', threadContext);

    expect(isThirdPersonObjectPronoun('ela')).toBe(true);
    expect(result.byReferenceText.get('ela')?.canonical_name).toContain('Larisse');
    expect(collectResolvedThreadPronouns(result).has('ela')).toBe(true);
    expect(resolveThreadSalientPerson(threadContext)?.reference).toBe('lari');

    const gaps = aggregateUncertaintyGaps({
      clarifications: [],
      extractorOutput: output,
      sourceMode: 'conversational',
      resolverResult: result,
      maxGaps: 3,
    });
    expect(gaps.some((g) => g.question.includes("Quem é 'ela'"))).toBe(false);
    expect(gaps.some((g) => g.question.includes('quem fica responsável'))).toBe(false);
  });
});
