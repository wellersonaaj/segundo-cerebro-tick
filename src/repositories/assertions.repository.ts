import type { SupabaseClient } from '@supabase/supabase-js';
import type { Assertion, ExtractedAssertion } from '../types/domain.js';

export class AssertionsRepository {
  constructor(private readonly db: SupabaseClient) {}

  async create(
    inboxItemId: string,
    extracted: ExtractedAssertion,
    correctionId?: string,
  ): Promise<Assertion> {
    const { data, error } = await this.db
      .from('assertions')
      .insert({
        inbox_item_id: inboxItemId,
        assertion_type: extracted.assertion_type,
        content: extracted.content,
        status: extracted.status,
        source_excerpt: extracted.source_excerpt,
        confidence: extracted.confidence,
        correction_id: correctionId ?? null,
      })
      .select()
      .single();
    if (error) throw new Error(`assertions.create: ${error.message}`);
    return data as Assertion;
  }

  async searchText(query: string, limit = 10): Promise<Assertion[]> {
    const { data, error } = await this.db
      .from('assertions')
      .select()
      .eq('record_status', 'active')
      .or(`content.ilike.%${query}%,source_excerpt.ilike.%${query}%`)
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
