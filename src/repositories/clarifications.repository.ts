import type { SupabaseClient } from '@supabase/supabase-js';
import type { ClarificationRequest, ClarificationStatus, ExtractedClarification } from '../types/domain.js';

export class ClarificationsRepository {
  constructor(private readonly db: SupabaseClient) {}

  async createMany(inboxItemId: string, items: ExtractedClarification[]): Promise<ClarificationRequest[]> {
    if (!items.length) return [];
    const rows = items.map((c) => ({
      inbox_item_id: inboxItemId,
      target_type: c.target_type,
      target_reference: c.target_reference,
      issue_type: c.issue_type,
      question: c.question,
      reason: c.reason,
      priority: c.priority,
      blocking_scope: c.blocking_scope,
      suggested_answers: c.suggested_answers,
      source_excerpt: c.source_excerpt,
      status: 'pending' as const,
    }));
    const { data, error } = await this.db.from('clarification_requests').insert(rows).select();
    if (error) throw new Error(`clarifications.createMany: ${error.message}`);
    return (data ?? []) as ClarificationRequest[];
  }

  async list(status?: ClarificationStatus, limit = 50): Promise<ClarificationRequest[]> {
    let q = this.db.from('clarification_requests').select().order('created_at', { ascending: false });
    if (status) q = q.eq('status', status);
    const { data, error } = await q.limit(limit);
    if (error) throw new Error(`clarifications.list: ${error.message}`);
    return (data ?? []) as ClarificationRequest[];
  }

  async findById(id: string): Promise<ClarificationRequest | null> {
    const { data, error } = await this.db
      .from('clarification_requests')
      .select()
      .eq('id', id)
      .maybeSingle();
    if (error) throw new Error(`clarifications.findById: ${error.message}`);
    return data as ClarificationRequest | null;
  }

  async resolve(id: string, answer: string): Promise<ClarificationRequest> {
    const { data, error } = await this.db
      .from('clarification_requests')
      .update({
        status: 'answered',
        answer,
        answered_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single();
    if (error) throw new Error(`clarifications.resolve: ${error.message}`);
    return data as ClarificationRequest;
  }

  async dismiss(id: string): Promise<ClarificationRequest> {
    const { data, error } = await this.db
      .from('clarification_requests')
      .update({ status: 'dismissed', updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();
    if (error) throw new Error(`clarifications.dismiss: ${error.message}`);
    return data as ClarificationRequest;
  }

  async markResolvedAutomatically(ids: string[]): Promise<void> {
    if (!ids.length) return;
    const { error } = await this.db
      .from('clarification_requests')
      .update({
        status: 'resolved_automatically',
        updated_at: new Date().toISOString(),
      })
      .in('id', ids);
    if (error) throw new Error(`clarifications.markResolvedAutomatically: ${error.message}`);
  }
}
