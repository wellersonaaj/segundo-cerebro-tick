import { describe, expect, it } from 'vitest';
import type { ExtractorOutputV14 } from '../src/openai/extractor-v1.4.types.js';
import {
  filterEnrichmentTriggers,
  isEnrichmentTriggerEligible,
  isRegistryPrivateReference,
} from '../src/services/enrichment-eligibility.js';
import { scanEnrichmentTriggers } from '../src/services/enrichment-trigger-scanner.js';
import { ExternalKnowledgeEnrichmentService } from '../src/services/external-knowledge-enrichment.service.js';
import { MemoryCompilerV2Service } from '../src/services/memory-compiler-v2.service.js';
import { aggregateUncertaintyGaps } from '../src/services/uncertainty-aggregator.js';
import { composeFollowUpMessage } from '../src/services/assistant-response-composer.js';
import {
  ReferenceResolverService,
  collectReferenceTextsFromExtractor,
} from '../src/services/reference-resolver.service.js';
import { buildEffectiveInputWithSourceBlocks } from '../src/utils/source-blocks.js';
import { MockWebSearchProvider } from '../src/services/web-search/web-search-provider.js';

const registry = [
  {
    id: 'lari-id',
    name: 'Larisse do Carmo Peixoto',
    normalized_name: 'larisse do carmo peixoto',
    entity_type: 'person',
    aliases: ['Lari'],
  },
];

const meetingOutput: ExtractorOutputV14 = {
  schema_version: '1.4',
  events: [
    {
      title: 'Encontrar Lari',
      event_kind: 'meeting',
      occurred_at: null,
      source_excerpt: 'Vou encontrar a Lari hoje a noite (quinta)',
      related_entities: [
        { role: null, relation_type: 'participant', entity_reference: 'Lari' },
      ],
      episodic_confidence: 0.85,
    },
  ],
  aliases: [],
  assertions: [],
  task_signals: [],
  review_hints: [],
  extraction_notes: [],
  correction_signals: [],
  clarification_candidates: [],
  entity_mentions: [
    {
      mention_text: 'Lari',
      suggested_entity_type: 'person',
      source_excerpt: 'Vou encontrar a Lari hoje a noite (quinta)',
      confidence: 0.98,
    },
  ],
};

function resolveOutput(output: ExtractorOutputV14) {
  const resolver = new ReferenceResolverService(registry);
  const refs = collectReferenceTextsFromExtractor(output);
  return resolver.resolveReferences(refs);
}

describe('enrichment eligibility', () => {
  it('treats resolved registry person as private — no web enrichment', () => {
    const resolverResult = resolveOutput(meetingOutput);
    expect(isRegistryPrivateReference('Lari', resolverResult, meetingOutput)).toBe(true);

    const rawTriggers = scanEnrichmentTriggers(meetingOutput, '2026-06-04T01:46:00.000Z');
    const filtered = filterEnrichmentTriggers(rawTriggers, meetingOutput, resolverResult);
    expect(filtered.some((t) => t.targetReference === 'Lari')).toBe(false);
  });

  it('skips missing_event_date when excerpt has relative temporal language', () => {
    const trigger = {
      targetReference: 'Websummit Rio',
      gapKind: 'missing_event_date' as const,
      sourceExcerpt: 'Semana que vem haverá o evento Websummit Rio.',
      anchorYear: 2026,
    };
    const resolverResult = resolveOutput(meetingOutput);
    expect(isEnrichmentTriggerEligible(trigger, meetingOutput, resolverResult)).toBe(false);
  });

  it('does not enrich resolved person alias via mock search', async () => {
    const resolverResult = resolveOutput(meetingOutput);
    const provider = new MockWebSearchProvider(
      new Map([
        [
          'lari',
          [
            {
              title: 'Jadwal Event Lari Indonesia',
              url: 'https://jadwallari.id/events',
              content: 'Event lari 03-04 Januari 2026 Wonderkindness Fun Run Jakarta',
            },
          ],
        ],
      ]),
    );

    const result = await new ExternalKnowledgeEnrichmentService().enrich(
      meetingOutput,
      '2026-06-04T01:46:00.000Z',
      {
        enabled: true,
        maxQueries: 2,
        autoApplyConfidence: 0.9,
        suggestConfidence: 0.6,
        searchProvider: provider,
        resolverResult,
      },
    );

    expect(result.status).not.toBe('resolved');
    expect(result.facts).toHaveLength(0);
  });

  it('normalizes event date locally and avoids absurd follow-up', async () => {
    const resolverResult = resolveOutput(meetingOutput);
    const temporalAnchor = {
      receivedAt: '2026-06-04T01:46:00.000Z',
      timezone: 'America/Sao_Paulo',
    };

    const compiled = new MemoryCompilerV2Service().compile({
      extractorOutput: meetingOutput,
      effectiveInput: buildEffectiveInputWithSourceBlocks({
        raw_content: 'Vou encontrar a Lari hoje a noite (quinta)',
      }),
      resolverResult,
      temporalAnchor,
      externalEnrichment: {
        enrichmentId: 'external-knowledge-enrichment',
        enrichmentVersion: '1.0.0',
        status: 'skipped',
        reasonCode: 'no_triggers',
        queries: [],
        facts: [],
      },
    });

    expect(compiled.events[0]?.occurredAt).toBeTruthy();
    expect(compiled.events[0]?.occurredAt).not.toContain('jadwallari');

    const gaps = aggregateUncertaintyGaps({
      clarifications: [],
      extractorOutput: meetingOutput,
      maxGaps: 2,
    });
    expect(gaps.some((g) => g.question.includes('Quando acontece Lari'))).toBe(false);

    const followUp = composeFollowUpMessage({
      raw_content: 'Vou encontrar a Lari hoje a noite (quinta)',
      processing_status: 'completed',
      tasks: [],
      clarifications: [],
      gaps,
      enrichment: null,
    });
    expect(followUp).not.toContain('Evento Lari');
    expect(followUp).not.toContain('Quando acontece Lari');
  });
});
