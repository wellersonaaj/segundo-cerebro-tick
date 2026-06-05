import type { SupabaseClient } from '@supabase/supabase-js';
import { materialityFromFields } from '../types/clarification-types.js';
import type { ClarificationRequest, ClarificationStatus, ExtractedClarification } from '../types/domain.js';
import { normalizeText } from '../utils/normalize.js';

export class ClarificationsRepository {
  constructor(private readonly db: SupabaseClient) {}

  async createMany(inboxItemId: string, items: ExtractedClarification[]): Promise<ClarificationRequest[]> {
    return this.createManyCandidates(inboxItemId, null, items);
  }

  async createManyCandidates(
    inboxItemId: string,
    extractionRunId: string | null,
    items: ExtractedClarification[],
    correctionId?: string,
  ): Promise<ClarificationRequest[]> {
    void correctionId;
    if (!items.length) return [];
    const rows = items.map((c) => ({
      inbox_item_id: inboxItemId,
      extraction_run_id: extractionRunId,
      target_type: c.target_type,
      target_reference: c.target_reference,
      normalized_target_reference: normalizeText(c.target_reference ?? ''),
      issue_type: c.issue_type,
      question: c.question,
      reason: c.reason,
      priority: c.priority,
      blocking_scope: c.blocking_scope,
      materiality: materialityFromFields({
        blocking_scope: c.blocking_scope,
        issue_type: c.issue_type,
        priority: c.priority,
      }),
      suggested_answers: c.suggested_answers,
      source_excerpt: c.source_excerpt,
      status: 'pending' as const,
      record_status: 'candidate' as const,
    }));
    const { data, error } = await this.db.from('clarification_requests').insert(rows).select();
    if (error) throw new Error(`clarifications.createManyCandidates: ${error.message}`);
    return (data ?? []) as ClarificationRequest[];
  }

  async listByInboxItem(inboxItemId: string): Promise<ClarificationRequest[]> {
    const { data, error } = await this.db
      .from('clarification_requests')
      .select()
      .eq('inbox_item_id', inboxItemId)
      .eq('record_status', 'active')
      .order('created_at', { ascending: true });
    if (error) throw new Error(`clarifications.listByInboxItem: ${error.message}`);
    return (data ?? []) as ClarificationRequest[];
  }

  async pendingCountsByInboxIds(inboxItemIds: string[]): Promise<Map<string, number>> {
    const counts = new Map<string, number>();
    if (!inboxItemIds.length) return counts;

    const { data, error } = await this.db
      .from('clarification_requests')
      .select('inbox_item_id')
      .in('inbox_item_id', inboxItemIds)
      .eq('record_status', 'active')
      .eq('status', 'pending');
    if (error) throw new Error(`clarifications.pendingCountsByInboxIds: ${error.message}`);

    for (const id of inboxItemIds) {
      counts.set(id, 0);
    }
    for (const row of data ?? []) {
      const inboxItemId = row.inbox_item_id as string;
      counts.set(inboxItemId, (counts.get(inboxItemId) ?? 0) + 1);
    }
    return counts;
  }

  async listPending(limit = 50): Promise<ClarificationRequest[]> {
    return this.list('pending', limit);
  }

  async listPendingByInboxItem(inboxItemId: string): Promise<ClarificationRequest[]> {
    const { data, error } = await this.db
      .from('clarification_requests')
      .select()
      .eq('inbox_item_id', inboxItemId)
      .eq('record_status', 'active')
      .eq('status', 'pending')
      .order('created_at', { ascending: true });
    if (error) throw new Error(`clarifications.listPendingByInboxItem: ${error.message}`);
    return (data ?? []) as ClarificationRequest[];
  }

  async listPendingForTelegramChat(
    chatId: number,
    inboxItemIds: string[],
  ): Promise<ClarificationRequest[]> {
    if (!inboxItemIds.length) return [];
    const { data, error } = await this.db
      .from('clarification_requests')
      .select()
      .in('inbox_item_id', inboxItemIds)
      .eq('record_status', 'active')
      .eq('status', 'pending')
      .order('created_at', { ascending: true });
    if (error) throw new Error(`clarifications.listPendingForTelegramChat: ${error.message}`);
    return (data ?? []) as ClarificationRequest[];
  }

  async list(status?: ClarificationStatus, limit = 50): Promise<ClarificationRequest[]> {
    let q = this.db
      .from('clarification_requests')
      .select()
      .eq('record_status', 'active')
      .order('created_at', { ascending: false });
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

  async listAnsweredByInboxItem(inboxItemId: string): Promise<ClarificationRequest[]> {
    const { data, error } = await this.db
      .from('clarification_requests')
      .select()
      .eq('inbox_item_id', inboxItemId)
      .eq('status', 'answered')
      .order('answered_at', { ascending: true });
    if (error) throw new Error(`clarifications.listAnsweredByInboxItem: ${error.message}`);
    return (data ?? []) as ClarificationRequest[];
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
