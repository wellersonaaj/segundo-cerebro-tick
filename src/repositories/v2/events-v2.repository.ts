import type { SupabaseClient } from '@supabase/supabase-js';
import type { CompiledEventV2 } from '../../types/memory-compiler-v2.js';

/** Only ISO-parseable instants belong in timestamptz; relative literals stay in excerpt/title. */
function parseOccurredAtForDb(value: string | null | undefined): string | null {
  if (value == null || !String(value).trim()) return null;
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return null;
  return new Date(parsed).toISOString();
}

export class EventsV2Repository {
  constructor(private readonly db: SupabaseClient) {}

  async createCandidate(
    inboxItemId: string,
    extractionRunId: string,
    event: CompiledEventV2,
    correctionId?: string,
  ): Promise<{ id: string }> {
    const { data, error } = await this.db
      .from('events')
      .insert({
        inbox_item_id: inboxItemId,
        extraction_run_id: extractionRunId,
        event_kind: event.eventKind,
        title: event.title,
        occurred_at: parseOccurredAtForDb(event.occurredAt),
        episodic_confidence: event.episodicConfidence,
        source_excerpt: event.sourceExcerpt,
        source_block_reference: event.sourceBlockReference,
        confidence: event.confidence,
        correction_id: correctionId ?? null,
        record_status: 'candidate',
      })
      .select('id')
      .single();
    if (error) throw new Error(`events_v2.createCandidate: ${error.message}`);
    return data as { id: string };
  }

  async linkEntity(
    eventId: string,
    opts: {
      entityId?: string | null;
      entityReference?: string | null;
      relationType: string;
      role?: string | null;
      resolutionStatus: string;
    },
  ): Promise<void> {
    const { error } = await this.db.from('event_entities').insert({
      event_id: eventId,
      entity_id: opts.entityId ?? null,
      entity_reference: opts.entityReference ?? null,
      relation_type: opts.relationType,
      role: opts.role ?? null,
      resolution_status: opts.resolutionStatus,
    });
    if (error && !error.message.includes('duplicate') && error.code !== '23505') {
      throw new Error(`events_v2.linkEntity: ${error.message}`);
    }
  }
}
