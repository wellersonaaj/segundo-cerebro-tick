import type { SupabaseClient } from '@supabase/supabase-js';
import { buildIlikeOrFilter } from '../db/postgrest-filter-utils.js';
import type { ArtifactRecordStatus, Event, ExtractedEvent } from '../types/domain.js';

export const DEFAULT_EVENT_ENTITY_RELATION_TYPE = 'mentioned';

export interface LinkEntityOptions {
  /** Default: 'mentioned' */
  relationType?: string;
  role?: string | null;
}

function mapEventRow(row: Record<string, unknown>): Event {
  const recordStatus = row.record_status as ArtifactRecordStatus;
  return {
    id: row.id as string,
    inbox_item_id: row.inbox_item_id as string,
    extraction_run_id: (row.extraction_run_id as string | null) ?? null,
    event_type: (row.event_kind ?? row.event_type) as string,
    description: (row.title ?? row.description) as string,
    occurred_at: (row.occurred_at as string | null) ?? null,
    source_excerpt: row.source_excerpt as string,
    confidence: (row.confidence as number | null) ?? null,
    status: recordStatus === 'active' ? 'active' : ((row.status as string) ?? recordStatus),
    record_status: recordStatus,
    superseded_by: (row.superseded_by as string | null) ?? null,
    correction_id: (row.correction_id as string | null) ?? null,
    created_at: row.created_at as string,
  };
}

export class EventsRepository {
  constructor(private readonly db: SupabaseClient) {}

  async create(
    inboxItemId: string,
    extracted: ExtractedEvent,
    correctionId?: string,
  ): Promise<Event> {
    return this.createCandidate(inboxItemId, null, extracted, correctionId);
  }

  async createCandidate(
    inboxItemId: string,
    extractionRunId: string | null,
    extracted: ExtractedEvent,
    correctionId?: string,
  ): Promise<Event> {
    const { data, error } = await this.db
      .from('events')
      .insert({
        inbox_item_id: inboxItemId,
        extraction_run_id: extractionRunId,
        event_type: extracted.event_type,
        title: extracted.description,
        description: extracted.description,
        occurred_at: extracted.occurred_at,
        source_excerpt: extracted.source_excerpt,
        confidence: extracted.confidence,
        correction_id: correctionId ?? null,
        record_status: 'candidate',
        status: 'active',
      })
      .select()
      .single();
    if (error) throw new Error(`events.createCandidate: ${error.message}`);
    return data as Event;
  }

  async linkEntity(
    eventId: string,
    entityId: string,
    options?: LinkEntityOptions,
  ): Promise<void> {
    const { error } = await this.db.from('event_entities').insert({
      event_id: eventId,
      entity_id: entityId,
      role: options?.role ?? null,
      relation_type: options?.relationType ?? DEFAULT_EVENT_ENTITY_RELATION_TYPE,
    });
    if (error && !error.message.includes('duplicate')) {
      throw new Error(`events.linkEntity: ${error.message}`);
    }
  }

  async listActiveByInboxItem(inboxItemId: string): Promise<Event[]> {
    const { data, error } = await this.db
      .from('events')
      .select()
      .eq('inbox_item_id', inboxItemId)
      .eq('record_status', 'active')
      .order('created_at', { ascending: false });
    if (error) throw new Error(`events.listActiveByInboxItem: ${error.message}`);
    return (data ?? []).map((row) => mapEventRow(row as Record<string, unknown>));
  }

  async listByEntity(entityId: string, limit = 20): Promise<Event[]> {
    const { data: links, error: linkErr } = await this.db
      .from('event_entities')
      .select('event_id')
      .eq('entity_id', entityId)
      .limit(limit);
    if (linkErr) throw new Error(`events.listByEntity: ${linkErr.message}`);
    const ids = (links ?? []).map((l) => (l as { event_id: string }).event_id);
    if (!ids.length) return [];
    const { data, error } = await this.db
      .from('events')
      .select()
      .in('id', ids)
      .eq('record_status', 'active')
      .order('created_at', { ascending: false });
    if (error) throw new Error(`events.listByEntity: ${error.message}`);
    return (data ?? []).map((row) => mapEventRow(row as Record<string, unknown>));
  }

  async searchText(query: string, limit = 10): Promise<Event[]> {
    const { data, error } = await this.db
      .from('events')
      .select()
      .eq('record_status', 'active')
      .or(buildIlikeOrFilter(['title', 'source_excerpt'], query))
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw new Error(`events.searchText: ${error.message}`);
    return (data ?? []).map((row) => mapEventRow(row as Record<string, unknown>));
  }

  async supersedeByInboxItem(inboxItemId: string, correctionId: string): Promise<string[]> {
    const { data: active, error: fetchErr } = await this.db
      .from('events')
      .select('id')
      .eq('inbox_item_id', inboxItemId)
      .eq('record_status', 'active');
    if (fetchErr) throw new Error(`events.supersede: ${fetchErr.message}`);
    const ids = (active ?? []).map((r) => (r as { id: string }).id);
    if (!ids.length) return [];
    const { error } = await this.db
      .from('events')
      .update({ record_status: 'superseded', correction_id: correctionId })
      .in('id', ids);
    if (error) throw new Error(`events.supersede: ${error.message}`);
    return ids;
  }
}
