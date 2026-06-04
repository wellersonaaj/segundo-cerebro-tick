import { describe, expect, it } from 'vitest';
import { buildEffectiveInputWithSourceBlocks } from '../src/utils/source-blocks.js';
import { buildTelegramInboxMetadata } from '../src/services/telegram-inbox.service.js';
import { buildIngestionContextFromInboxItem } from '../src/services/ingestion-context-from-inbox.service.js';
import { ReferenceResolverService } from '../src/services/reference-resolver.service.js';
import {
  buildTrustedEntityReferencesFromMetadata,
  collectReferenceTextsFromExtractor,
} from '../src/services/reference-resolver.service.js';
import { applyFirstPersonPronounToResolverResult } from '../src/services/first-person-pronoun-resolver.js';
import { MemoryCompilerV2Service } from '../src/services/memory-compiler-v2.service.js';
import type { ExtractorOutputV14 } from '../src/openai/extractor-v1.4.types.js';
import { ExternalKnowledgeEnrichmentService } from '../src/services/external-knowledge-enrichment.service.js';
import { MockWebSearchProvider, websummitRioMockSnippets } from '../src/services/web-search/web-search-provider.js';

const registry = [
  {
    id: 'wellerson-id',
    name: 'Wellerson Assumpção',
    normalized_name: 'wellerson assumpcao',
    entity_type: 'person',
    aliases: ['Tick', 'Wellerson'],
  },
  {
    id: 'brant-id',
    name: 'Bruno Brant Gotschalg',
    normalized_name: 'bruno brant gotschalg',
    entity_type: 'person',
    aliases: ['Brant'],
  },
];

const extractorOutput: ExtractorOutputV14 = {
  schema_version: '1.4',
  events: [
    {
      title: 'Representar a Velt no Websummit Rio',
      event_kind: 'commitment',
      occurred_at: null,
      source_excerpt: 'Eu, o Brant e a Heloísa vamos estar lá representando a Velt',
      related_entities: [
        { role: null, relation_type: 'participant', entity_reference: 'eu' },
        { role: null, relation_type: 'participant', entity_reference: 'Brant' },
      ],
      episodic_confidence: 0.9,
    },
    {
      title: 'Websummit Rio (evento)',
      event_kind: 'other',
      occurred_at: null,
      source_excerpt: 'Semana que vem haverá o evento Websummit Rio.',
      related_entities: [
        { role: null, relation_type: 'subject', entity_reference: 'Websummit Rio' },
      ],
      episodic_confidence: 0.95,
    },
  ],
  aliases: [],
  assertions: [],
  task_signals: [],
  review_hints: [],
  extraction_notes: [],
  correction_signals: [],
  clarification_candidates: [
    {
      target_type: 'entity',
      target_reference: 'eu',
      issue_type: 'ambiguous_identity',
      question: 'Quem é eu?',
      reason: 'identidade',
      priority: 'medium',
      blocking_scope: 'knowledge_confirmation',
      suggested_answers: [],
      source_excerpt: 'Eu, o Brant',
      source_block_reference: '[SOURCE_BLOCK:raw]',
      confidence: 0.6,
    },
  ],
  entity_mentions: [
    { mention_text: 'eu', suggested_entity_type: 'person', source_excerpt: 'Eu', confidence: 0.8 },
    { mention_text: 'Brant', suggested_entity_type: 'person', source_excerpt: 'Brant', confidence: 0.95 },
    {
      mention_text: 'Websummit Rio',
      suggested_entity_type: 'topic',
      source_excerpt: 'Websummit Rio',
      confidence: 0.95,
    },
  ],
};

describe('identity and enrichment e2e (unit chain)', () => {
  it('resolves eu via sender, compiles without blocking identity, enriches event date', async () => {
    const metadata = buildTelegramInboxMetadata(
      {
        userId: 5991664193,
        chatId: 5991664193,
        messageId: 20,
        text: 'test',
        receivedAt: '2026-06-04T01:17:02.000Z',
      },
      'Wellerson Assumpção',
    );

    const inbox = {
      id: 'inbox-1',
      raw_content: 'Semana que vem Websummit. Eu e Brant vamos.',
      source_channel: 'telegram',
      source_mode: 'conversational' as const,
      received_at: '2026-06-04T01:17:02.000Z',
      timezone: 'America/Sao_Paulo',
      processing_status: 'pending' as const,
      extractor_version: null,
      processing_error: null,
      processed_at: null,
      active_extraction_run_id: null,
      latest_extraction_run_id: null,
      created_at: '2026-06-04T01:17:02.000Z',
      metadata,
    };

    const fullContext = buildIngestionContextFromInboxItem(inbox);
    expect(fullContext.sourceMetadata.entityLike.sender_reference).toBe('Wellerson Assumpção');

    const resolver = new ReferenceResolverService(registry);
    const refs = collectReferenceTextsFromExtractor(extractorOutput);
    const trusted = buildTrustedEntityReferencesFromMetadata(
      fullContext.sourceMetadata.entityLike,
      resolver,
    );
    let resolverResult = resolver.resolveReferences(refs, trusted);
    const senderResolved =
      resolverResult.byReferenceText.get('Wellerson Assumpção') ??
      resolverResult.byReferenceText.get('wellerson assumpcao');
    resolverResult = applyFirstPersonPronounToResolverResult(
      resolverResult,
      'conversational',
      senderResolved ?? null,
    );

    expect(resolverResult.byReferenceText.get('eu')?.entity_id).toBe('wellerson-id');

    const enrichment = await new ExternalKnowledgeEnrichmentService().enrich(
      extractorOutput,
      inbox.received_at,
      {
        enabled: true,
        maxQueries: 2,
        autoApplyConfidence: 0.9,
        suggestConfidence: 0.6,
        searchProvider: new MockWebSearchProvider(
          new Map([['websummit rio', websummitRioMockSnippets()]]),
        ),
      },
    );

    const compiled = new MemoryCompilerV2Service().compile({
      extractorOutput,
      effectiveInput: buildEffectiveInputWithSourceBlocks({ raw_content: inbox.raw_content }),
      resolverResult,
      fullIngestionContext: fullContext,
      externalEnrichment: enrichment,
      enrichmentAutoApplyConfidence: 0.9,
      enrichmentSuggestConfidence: 0.6,
    });

    const euClarification = compiled.clarificationCandidates.find(
      (c) => c.targetReference === 'eu',
    );
    expect(euClarification).toBeUndefined();

    const wsEvent = compiled.events.find((e) => e.title.includes('Websummit'));
    expect(wsEvent?.occurredAt).toContain('2026-06');
    expect(compiled.enrichmentEvidence?.facts.length).toBeGreaterThan(0);
  });

  it('includes clarification blocks in effective input', () => {
    const input = buildEffectiveInputWithSourceBlocks({
      raw_content: 'Original',
      clarifications: [
        {
          id: '00000000-0000-4000-8000-000000000099',
          question: 'Qual data?',
          answer: '8-10 junho 2026',
          target_reference: 'Websummit Rio',
          issue_type: 'ambiguous_date',
        },
      ],
    });
    expect(input).toContain('[SOURCE_BLOCK:clarification:00000000-0000-4000-8000-000000000099]');
    expect(input).toContain('8-10 junho 2026');
  });
});
