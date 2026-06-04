import type { SupabaseClient } from '@supabase/supabase-js';
import { buildIlikeOrFilter } from '../db/postgrest-filter-utils.js';
import type { EntityResolutionLog, EntityResolutionResult } from '../types/domain.js';

export class EntityResolutionRepository {
  constructor(private readonly db: SupabaseClient) {}

  async log(
    inboxItemId: string,
    result: EntityResolutionResult,
    extractionRunId?: string | null,
  ): Promise<EntityResolutionLog> {
    const { data, error } = await this.db
      .from('entity_resolution_logs')
      .insert({
        inbox_item_id: inboxItemId,
        extraction_run_id: extractionRunId ?? null,
        mention_text: result.extractedName,
        resolution_status: result.status,
        resolved_entity_id: result.resolvedEntityId,
        evidence: {
          method: result.method,
          confidence: result.confidence,
          ...result.evidence,
        },
      })
      .select()
      .single();
    if (error) throw new Error(`entity_resolution_logs.log: ${error.message}`);
    const row = data as Record<string, unknown>;
    return {
      id: row.id as string,
      inbox_item_id: row.inbox_item_id as string,
      extraction_run_id: (row.extraction_run_id as string | null) ?? null,
      extracted_entity_name: row.mention_text as string,
      resolution_status: row.resolution_status as EntityResolutionLog['resolution_status'],
      resolved_entity_id: (row.resolved_entity_id as string | null) ?? null,
      resolution_method: result.method,
      confidence: result.confidence,
      evidence: row.evidence as Record<string, unknown>,
      created_at: row.created_at as string,
    };
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
      .select('id, title, source_excerpt, occurred_at, created_at')
      .eq('record_status', 'active')
      .gte('created_at', since.toISOString())
      .or(buildIlikeOrFilter(['title', 'source_excerpt'], query))
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw new Error(`entity_resolution.searchRecentMentions: ${error.message}`);
    return (data ?? []).map((r) => {
      const row = r as {
        id: string;
        title: string;
        source_excerpt: string;
        occurred_at: string | null;
        created_at: string;
      };
      return {
        event_id: row.id,
        description: row.title,
        source_excerpt: row.source_excerpt,
        occurred_at: row.occurred_at,
        created_at: row.created_at,
      };
    });
  }
}
