export const EXTERNAL_KNOWLEDGE_ENRICHMENT_ID = 'external-knowledge-enrichment';
export const EXTERNAL_KNOWLEDGE_ENRICHMENT_VERSION = '1.0.0';

export type EnrichmentGapKind =
  | 'missing_event_date'
  | 'non_registry_named_reference'
  | 'clarification_external'
  | 'ambiguous_entity_central';

export interface EnrichmentTrigger {
  targetReference: string;
  gapKind: EnrichmentGapKind;
  sourceExcerpt: string;
  anchorYear: number;
}

export interface ExternalKnowledgeQuery {
  query: string;
  rationale: string;
  targetReferences: string[];
}

export interface EnrichedFact {
  claim: string;
  sourceUrl?: string;
  sourceLabel: string;
  confidence: number;
  matchedReference: string;
  field?: 'occurred_at' | 'title' | 'description' | 'entity_disambiguation';
  occurredAtIso?: string | null;
}

export interface ExternalKnowledgeEnrichmentResult {
  enrichmentId: typeof EXTERNAL_KNOWLEDGE_ENRICHMENT_ID;
  enrichmentVersion: typeof EXTERNAL_KNOWLEDGE_ENRICHMENT_VERSION;
  status: 'resolved' | 'skipped' | 'failed' | 'not_applicable';
  reasonCode: string;
  queries: ExternalKnowledgeQuery[];
  facts: EnrichedFact[];
}

export interface WebSearchSnippet {
  title: string;
  url: string;
  content: string;
}
