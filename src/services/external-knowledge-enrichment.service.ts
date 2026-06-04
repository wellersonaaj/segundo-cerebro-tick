import type { ExtractorOutputV14 } from '../openai/extractor-v1.4.types.js';
import {
  EXTERNAL_KNOWLEDGE_ENRICHMENT_ID,
  EXTERNAL_KNOWLEDGE_ENRICHMENT_VERSION,
  type EnrichedFact,
  type EnrichmentTrigger,
  type ExternalKnowledgeEnrichmentResult,
  type WebSearchSnippet,
} from '../types/external-knowledge-enrichment.js';
import { normalizeText } from '../utils/normalize.js';
import { buildSearchQueries, scanEnrichmentTriggers } from './enrichment-trigger-scanner.js';
import type { WebSearchProvider } from './web-search/web-search-provider.js';

const DATE_RANGE_RE =
  /(\d{1,2})[\s\-–—]+(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|january|february|march|april|may|june|july|august|september|october|november|december|janeiro|fevereiro|março|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)[a-z]*\s+(\d{4})/i;

const MONTH_MAP: Record<string, number> = {
  jan: 1,
  january: 1,
  janeiro: 1,
  feb: 2,
  february: 2,
  fevereiro: 2,
  mar: 3,
  march: 3,
  marco: 3,
  março: 3,
  apr: 4,
  april: 4,
  abril: 4,
  may: 5,
  maio: 5,
  jun: 6,
  june: 6,
  junho: 6,
  jul: 7,
  july: 7,
  julho: 7,
  aug: 8,
  august: 8,
  agosto: 8,
  sep: 9,
  sept: 9,
  september: 9,
  setembro: 9,
  oct: 10,
  october: 10,
  outubro: 10,
  nov: 11,
  november: 11,
  novembro: 11,
  dec: 12,
  december: 12,
  dezembro: 12,
};

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function extractDateRangeFromText(text: string, year: number): string | null {
  const m = DATE_RANGE_RE.exec(text);
  if (!m) return null;
  const monthKey = m[3]!.toLowerCase();
  const month = MONTH_MAP[monthKey];
  const y = Number(m[4]) || year;
  if (!month) return null;
  const d1 = Number(m[1]);
  const d2 = Number(m[2]);
  return `${y}-${pad2(month)}-${pad2(d1)}/${y}-${pad2(month)}-${pad2(d2)}`;
}

function nameMatchScore(reference: string, snippet: WebSearchSnippet): number {
  const refNorm = normalizeText(reference).replace(/\s/g, '');
  const blobNorm = normalizeText(`${snippet.title} ${snippet.content}`).replace(/\s/g, '');
  if (refNorm.length >= 4 && blobNorm.includes(refNorm)) return 1;
  const refTokens = normalizeText(reference).split(/\s+/).filter(Boolean);
  const blob = normalizeText(`${snippet.title} ${snippet.content}`);
  let hits = 0;
  for (const t of refTokens) {
    if (t.length >= 3 && blob.includes(t)) hits++;
  }
  return refTokens.length ? hits / refTokens.length : 0;
}

function synthesizeFacts(
  trigger: EnrichmentTrigger,
  snippets: WebSearchSnippet[],
  autoApplyConfidence: number,
  suggestConfidence: number,
): EnrichedFact[] {
  const facts: EnrichedFact[] = [];
  for (const sn of snippets) {
    const match = nameMatchScore(trigger.targetReference, sn);
    if (match < 0.4) continue;
    const dateRange = extractDateRangeFromText(sn.content, trigger.anchorYear);
    let confidence = 0.5 + match * 0.3;
    if (sn.url.includes('websummit') || sn.url.includes('rio.websummit')) {
      confidence += 0.15;
    }
    if (dateRange) confidence += 0.1;
    confidence = Math.min(confidence, 0.98);

    if (dateRange && confidence >= suggestConfidence) {
      facts.push({
        claim: `Evento ${trigger.targetReference} em ${dateRange.replace('/', ' a ')}`,
        sourceUrl: sn.url,
        sourceLabel: sn.title,
        confidence,
        matchedReference: trigger.targetReference,
        field: 'occurred_at',
        occurredAtIso: dateRange,
      });
    } else if (confidence >= suggestConfidence) {
      facts.push({
        claim: sn.content.slice(0, 200),
        sourceUrl: sn.url,
        sourceLabel: sn.title,
        confidence,
        matchedReference: trigger.targetReference,
        field: 'description',
      });
    }
  }

  facts.sort((a, b) => b.confidence - a.confidence);
  void autoApplyConfidence;
  return facts;
}

export interface ExternalKnowledgeEnrichmentOptions {
  enabled: boolean;
  maxQueries: number;
  autoApplyConfidence: number;
  suggestConfidence: number;
  searchProvider: WebSearchProvider | null;
}

export class ExternalKnowledgeEnrichmentService {
  async enrich(
    output: ExtractorOutputV14,
    receivedAt: string | undefined,
    options: ExternalKnowledgeEnrichmentOptions,
  ): Promise<ExternalKnowledgeEnrichmentResult> {
    const base: ExternalKnowledgeEnrichmentResult = {
      enrichmentId: EXTERNAL_KNOWLEDGE_ENRICHMENT_ID,
      enrichmentVersion: EXTERNAL_KNOWLEDGE_ENRICHMENT_VERSION,
      status: 'not_applicable',
      reasonCode: 'disabled',
      queries: [],
      facts: [],
    };

    if (!options.enabled || !options.searchProvider) {
      return { ...base, reasonCode: options.enabled ? 'no_provider' : 'disabled' };
    }

    const triggers = scanEnrichmentTriggers(output, receivedAt);
    if (!triggers.length) {
      return { ...base, status: 'skipped', reasonCode: 'no_triggers' };
    }

    const queries: ExternalKnowledgeEnrichmentResult['queries'] = [];
    const facts: EnrichedFact[] = [];
    let queryCount = 0;

    for (const trigger of triggers) {
      if (queryCount >= options.maxQueries) break;
      for (const q of buildSearchQueries(trigger)) {
        if (queryCount >= options.maxQueries) break;
        queries.push({
          query: q,
          rationale: trigger.gapKind,
          targetReferences: [trigger.targetReference],
        });
        try {
          const snippets = await options.searchProvider.search(q, 3);
          facts.push(
            ...synthesizeFacts(
              trigger,
              snippets,
              options.autoApplyConfidence,
              options.suggestConfidence,
            ),
          );
        } catch {
          return {
            ...base,
            status: 'failed',
            reasonCode: 'search_error',
            queries,
            facts,
          };
        }
        queryCount++;
      }
    }

    if (!facts.length) {
      return { ...base, status: 'skipped', reasonCode: 'no_facts', queries, facts };
    }

    return {
      ...base,
      status: 'resolved',
      reasonCode: 'facts_found',
      queries,
      facts,
    };
  }
}

export function getBestFactForReference(
  facts: EnrichedFact[],
  targetReference: string,
): EnrichedFact | null {
  const norm = normalizeText(targetReference);
  const matching = facts.filter((f) => normalizeText(f.matchedReference) === norm);
  matching.sort((a, b) => b.confidence - a.confidence);
  return matching[0] ?? null;
}
