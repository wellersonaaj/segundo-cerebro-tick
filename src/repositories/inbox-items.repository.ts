import type { SupabaseClient } from '@supabase/supabase-js';
import { buildIlikeOrFilter } from '../db/postgrest-filter-utils.js';
import { getTelegramChatId } from '../telegram/telegram-metadata.js';
import type { InboxItem, ProcessingStatus, SourceMode } from '../types/domain.js';

export interface ListRecentInboxItemsInput {
  limit?: number;
  search?: string;
}

export interface InboxItemRow extends InboxItem {
  source_reference?: string | null;
  metadata?: Record<string, unknown> | null;
  updated_at?: string;
}

export interface CreateInboxItemInput {
  raw_content: string;
  source_channel: string;
  source_mode: SourceMode;
  received_at: string;
  timezone: string;
  source_reference?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface UpdateInboxStatusFields {
  extractor_version?: string;
  processing_error?: string | null;
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
        source_reference: input.source_reference ?? null,
        metadata: input.metadata ?? {},
        processing_status: 'pending',
        processed_at: null,
        processing_error: null,
      })
      .select()
      .single();
    if (error) throw new Error(`inbox_items.create: ${error.message}`);
    return data as InboxItem;
  }

  async findById(id: string): Promise<InboxItemRow | null> {
    const { data, error } = await this.db.from('inbox_items').select().eq('id', id).maybeSingle();
    if (error) throw new Error(`inbox_items.findById: ${error.message}`);
    return data as InboxItemRow | null;
  }

  async findBySourceReference(sourceReference: string): Promise<InboxItemRow | null> {
    const { data, error } = await this.db
      .from('inbox_items')
      .select()
      .eq('source_reference', sourceReference)
      .maybeSingle();
    if (error) throw new Error(`inbox_items.findBySourceReference: ${error.message}`);
    return data as InboxItemRow | null;
  }

  async listRecent(input: ListRecentInboxItemsInput = {}): Promise<InboxItemRow[]> {
    const limit = input.limit ?? 100;
    let q = this.db.from('inbox_items').select().order('received_at', { ascending: false });
    if (input.search?.trim()) {
      q = q.or(buildIlikeOrFilter(['raw_content'], input.search.trim()));
    }
    const { data, error } = await q.limit(limit);
    if (error) throw new Error(`inbox_items.listRecent: ${error.message}`);
    return (data ?? []) as InboxItemRow[];
  }

  async updateMetadata(id: string, metadata: Record<string, unknown>): Promise<void> {
    const { error } = await this.db.from('inbox_items').update({ metadata }).eq('id', id);
    if (error) throw new Error(`inbox_items.updateMetadata: ${error.message}`);
  }

  async listTelegramByChatId(chatId: number, limit = 50): Promise<InboxItemRow[]> {
    const { data, error } = await this.db
      .from('inbox_items')
      .select()
      .eq('source_channel', 'telegram')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw new Error(`inbox_items.listTelegramByChatId: ${error.message}`);

    return (data ?? []).filter((row) => {
      const meta = row.metadata as Record<string, unknown> | null | undefined;
      return getTelegramChatId(meta) === chatId;
    }) as InboxItemRow[];
  }

  async updateStatus(
    id: string,
    status: ProcessingStatus,
    fields?: UpdateInboxStatusFields,
  ): Promise<void> {
    const update: Record<string, unknown> = {
      processing_status: status,
    };

    if (fields?.extractor_version !== undefined) {
      update.extractor_version = fields.extractor_version;
    }

    if (status === 'processing') {
      update.processed_at = null;
      update.processing_error = null;
    } else if (status === 'completed') {
      update.processed_at = new Date().toISOString();
      update.processing_error = null;
      if (fields?.extractor_version !== undefined) {
        update.extractor_version = fields.extractor_version;
      }
    } else if (status === 'failed') {
      update.processed_at = null;
      update.processing_error = fields?.processing_error ?? null;
      if (fields?.extractor_version !== undefined) {
        update.extractor_version = fields.extractor_version;
      }
    } else if (fields?.processing_error !== undefined) {
      update.processing_error = fields.processing_error;
    }

    const { error } = await this.db.from('inbox_items').update(update).eq('id', id);
    if (error) throw new Error(`inbox_items.updateStatus: ${error.message}`);
  }
}
