/**
 * Background enrichment queue stub.
 *
 * In the synchronous pipeline, external knowledge enrichment is no longer
 * called inside compileFromInbox (it was blocking ingestion when Tavily was
 * slow or offline).
 *
 * This service is a placeholder for the future background job that will:
 * 1. Pick up completed extraction runs
 * 2. Run ExternalKnowledgeEnrichmentService.enrich
 * 3. Update extraction_runs.compiled_output with enrichment suggestions
 *
 * The enrichment service itself (ExternalKnowledgeEnrichmentService) is
 * unchanged and ready to be wired.
 */

export const ENRICHMENT_QUEUE_SERVICE_VERSION = 'enrichment-queue-v1';

export function enrichmentQueuePlaceholder(): string {
  return 'Background enrichment queue not yet wired. See docs/backlog.';
}
