import type { SupabaseClient } from '@supabase/supabase-js';
import type { EntityResolutionLog, EntityResolutionResult } from '../types/domain.js';

export class EntityResolutionRepository {
  constructor(private readonly db: SupabaseClient) {}

  async log(inboxItemId: string, result: EntityResolutionResult): Promise<EntityResolutionLog> {
    const { data, error } = await this.db
      .from('entity_resolution_logs')
      .insert({
        inbox_item_id: inboxItemId,
        extracted_entity_name: result.extractedName,
        resolution_status: result.status,
        resolved_entity_id: result.resolvedEntityId,
        resolution_method: result.method,
        confidence: result.confidence,
        evidence: result.evidence,
      })
      .select()
      .single();
    if (error) throw new Error(`entity_resolution_logs.log: ${error.message}`);
    return data as EntityResolutionLog;
  }

  async searchRecentMentions(query: string, days = 90, limit = 10): Promise<
    Array<{
      event_id: string;
      description: string;
      source_excerpt: string;
      occurred_at: string | null;
      created_at: string;
    }>
  > {
    const since = new Date();
    since.setDate(since.getDate() - days);
    const { data, error } = await this.db
      .from('events')
      .select('id, description, source_excerpt, occurred_at, created_at')
      .eq('status', 'active')
      .gte('created_at', since.toISOString())
      .or(`description.ilike.%${query}%,source_excerpt.ilike.%${query}%`)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw new Error(`entity_resolution.searchRecentMentions: ${error.message}`);
    return (data ?? []).map((r) => ({
      event_id: (r as { id: string }).id,
      description: (r as { description: string }).description,
      source_excerpt: (r as { source_excerpt: string }).source_excerpt,
      occurred_at: (r as { occurred_at: string | null }).occurred_at,
      created_at: (r as { created_at: string }).created_at,
    }));
  }
}
