import type { SupabaseClient } from '@supabase/supabase-js';
import { buildIlikeOrFilter } from '../db/postgrest-filter-utils.js';
import type { Assertion, ExtractedAssertion } from '../types/domain.js';

export class AssertionsRepository {
  constructor(private readonly db: SupabaseClient) {}

  async create(
    inboxItemId: string,
    extracted: ExtractedAssertion,
    correctionId?: string,
  ): Promise<Assertion> {
    return this.createCandidate(inboxItemId, null, extracted, correctionId);
  }

  async createCandidate(
    inboxItemId: string,
    extractionRunId: string | null,
    extracted: ExtractedAssertion,
    correctionId?: string,
  ): Promise<Assertion> {
    const { data, error } = await this.db
      .from('assertions')
      .insert({
        inbox_item_id: inboxItemId,
        extraction_run_id: extractionRunId,
        assertion_type: extracted.assertion_type,
        content: extracted.content,
        status: extracted.status,
        source_excerpt: extracted.source_excerpt,
        confidence: extracted.confidence,
        correction_id: correctionId ?? null,
        record_status: 'candidate',
      })
      .select()
      .single();
    if (error) throw new Error(`assertions.createCandidate: ${error.message}`);
    return data as Assertion;
  }

  async searchText(query: string, limit = 10): Promise<Assertion[]> {
    const { data, error } = await this.db
      .from('assertions')
      .select()
      .eq('record_status', 'active')
      .or(
        buildIlikeOrFilter(
          ['subject_reference', 'predicate', 'value_text', 'source_excerpt'],
          query,
        ),
      )
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw new Error(`assertions.searchText: ${error.message}`);
    return (data ?? []) as Assertion[];
  }

  async supersedeByInboxItem(inboxItemId: string, correctionId: string): Promise<void> {
    const { error } = await this.db
      .from('assertions')
      .update({ record_status: 'superseded', correction_id: correctionId })
      .eq('inbox_item_id', inboxItemId)
      .eq('record_status', 'active');
    if (error) throw new Error(`assertions.supersede: ${error.message}`);
  }
}
