import type { SupabaseClient } from '@supabase/supabase-js';
import type { InboxItem, ProcessingStatus, SourceMode } from '../types/domain.js';

export interface CreateInboxItemInput {
  raw_content: string;
  source_channel: string;
  source_mode: SourceMode;
  received_at: string;
  timezone: string;
}

export class InboxItemsRepository {
  constructor(private readonly db: SupabaseClient) {}

  async create(input: CreateInboxItemInput): Promise<InboxItem> {
    const { data, error } = await this.db
      .from('inbox_items')
      .insert({
        raw_content: input.raw_content,
        source_channel: input.source_channel,
        source_mode: input.source_mode,
        received_at: input.received_at,
        timezone: input.timezone,
        processing_status: 'pending',
      })
      .select()
      .single();
    if (error) throw new Error(`inbox_items.create: ${error.message}`);
    return data as InboxItem;
  }

  async findById(id: string): Promise<InboxItem | null> {
    const { data, error } = await this.db.from('inbox_items').select().eq('id', id).maybeSingle();
    if (error) throw new Error(`inbox_items.findById: ${error.message}`);
    return data as InboxItem | null;
  }

  async updateStatus(
    id: string,
    status: ProcessingStatus,
    fields?: { extractor_version?: string; processing_error?: string | null },
  ): Promise<void> {
    const { error } = await this.db
      .from('inbox_items')
      .update({
        processing_status: status,
        extractor_version: fields?.extractor_version,
        processing_error: fields?.processing_error ?? null,
      })
      .eq('id', id);
    if (error) throw new Error(`inbox_items.updateStatus: ${error.message}`);
  }
}
