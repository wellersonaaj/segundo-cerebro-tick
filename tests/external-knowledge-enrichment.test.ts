import { describe, expect, it } from 'vitest';
import type { ExtractorOutputV14 } from '../src/openai/extractor-v1.4.types.js';
import { buildSearchQueries, scanEnrichmentTriggers } from '../src/services/enrichment-trigger-scanner.js';
import { ExternalKnowledgeEnrichmentService } from '../src/services/external-knowledge-enrichment.service.js';
import { MockWebSearchProvider, websummitRioMockSnippets } from '../src/services/web-search/web-search-provider.js';

const websummitOutput: ExtractorOutputV14 = {
  schema_version: '1.4',
  events: [
    {
      title: 'Websummit Rio (evento)',
      event_kind: 'other',
      occurred_at: null,
      source_excerpt: 'Semana que vem haverá o evento Websummit Rio, no Rio de Janeiro.',
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
      target_type: 'event',
      target_reference: 'Websummit Rio',
      issue_type: 'ambiguous_date',
      question: 'Qual a data exata?',
      reason: 'semana que vem',
      priority: 'medium',
      blocking_scope: 'none',
      suggested_answers: [],
      source_excerpt: 'Semana que vem',
      source_block_reference: '[SOURCE_BLOCK:raw]',
      confidence: 0.7,
    },
  ],
  entity_mentions: [
    {
      mention_text: 'Websummit Rio',
      suggested_entity_type: 'topic',
      source_excerpt: 'Websummit Rio',
      confidence: 0.95,
    },
  ],
};

describe('enrichment-trigger-scanner', () => {
  it('detects Websummit triggers', () => {
    const triggers = scanEnrichmentTriggers(websummitOutput, '2026-06-04T01:17:02.000Z');
    expect(triggers.length).toBeGreaterThan(0);
    expect(triggers.some((t) => t.targetReference.includes('Websummit'))).toBe(true);
  });

  it('builds search queries with year', () => {
    const queries = buildSearchQueries({
      targetReference: 'Websummit Rio',
      gapKind: 'missing_event_date',
      sourceExcerpt: 'x',
      anchorYear: 2026,
    });
    expect(queries[0]).toContain('2026');
  });
});

describe('ExternalKnowledgeEnrichmentService', () => {
  it('enriches Websummit from mock provider', async () => {
    const service = new ExternalKnowledgeEnrichmentService();
    const provider = new MockWebSearchProvider(
      new Map([['websummit rio', websummitRioMockSnippets()]]),
    );
    const result = await service.enrich(websummitOutput, '2026-06-04T01:17:02.000Z', {
      enabled: true,
      maxQueries: 2,
      autoApplyConfidence: 0.9,
      suggestConfidence: 0.6,
      searchProvider: provider,
    });
    expect(result.status).toBe('resolved');
    expect(result.facts.length).toBeGreaterThan(0);
    expect(result.facts[0]?.occurredAtIso).toContain('2026-06');
  });
});
