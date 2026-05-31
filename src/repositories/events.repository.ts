import type { SupabaseClient } from '@supabase/supabase-js';
import type { Event, ExtractedEvent } from '../types/domain.js';

export class EventsRepository {
  constructor(private readonly db: SupabaseClient) {}

  async create(
    inboxItemId: string,
    extracted: ExtractedEvent,
    correctionId?: string,
  ): Promise<Event> {
    const { data, error } = await this.db
      .from('events')
      .insert({
        inbox_item_id: inboxItemId,
        event_type: extracted.event_type,
        title: extracted.description,
        description: extracted.description,
        occurred_at: extracted.occurred_at,
        source_excerpt: extracted.source_excerpt,
        confidence: extracted.confidence,
        correction_id: correctionId ?? null,
      })
      .select()
      .single();
    if (error) throw new Error(`events.create: ${error.message}`);
    return data as Event;
  }

  async linkEntity(eventId: string, entityId: string, role?: string): Promise<void> {
    const { error } = await this.db
      .from('event_entities')
      .insert({ event_id: eventId, entity_id: entityId, role: role ?? null });
    if (error && !error.message.includes('duplicate')) {
      throw new Error(`events.linkEntity: ${error.message}`);
    }
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
      .eq('status', 'active')
      .order('created_at', { ascending: false });
    if (error) throw new Error(`events.listByEntity: ${error.message}`);
    return (data ?? []) as Event[];
  }

  async searchText(query: string, limit = 10): Promise<Event[]> {
    const { data, error } = await this.db
      .from('events')
      .select()
      .eq('status', 'active')
      .or(`description.ilike.%${query}%,source_excerpt.ilike.%${query}%`)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw new Error(`events.searchText: ${error.message}`);
    return (data ?? []) as Event[];
  }

  async supersedeByInboxItem(inboxItemId: string, correctionId: string): Promise<string[]> {
    const { data: active, error: fetchErr } = await this.db
      .from('events')
      .select('id')
      .eq('inbox_item_id', inboxItemId)
      .eq('status', 'active');
    if (fetchErr) throw new Error(`events.supersede: ${fetchErr.message}`);
    const ids = (active ?? []).map((r) => (r as { id: string }).id);
    if (!ids.length) return [];
    const { error } = await this.db
      .from('events')
      .update({ status: 'superseded', correction_id: correctionId })
      .in('id', ids);
    if (error) throw new Error(`events.supersede: ${error.message}`);
    return ids;
  }
}
