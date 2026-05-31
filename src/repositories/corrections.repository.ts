import type { SupabaseClient } from '@supabase/supabase-js';
import type { Correction } from '../types/domain.js';

export class CorrectionsRepository {
  constructor(private readonly db: SupabaseClient) {}

  async create(inboxItemId: string, correctionText: string): Promise<Correction> {
    const { data, error } = await this.db
      .from('corrections')
      .insert({ inbox_item_id: inboxItemId, correction_text: correctionText })
      .select()
      .single();
    if (error) throw new Error(`corrections.create: ${error.message}`);
    return data as Correction;
  }

  async listByInboxItem(inboxItemId: string): Promise<Correction[]> {
    const { data, error } = await this.db
      .from('corrections')
      .select()
      .eq('inbox_item_id', inboxItemId)
      .order('created_at', { ascending: true });
    if (error) throw new Error(`corrections.listByInboxItem: ${error.message}`);
    return (data ?? []) as Correction[];
  }
}
