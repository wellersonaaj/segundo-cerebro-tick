import type { SupabaseClient } from '@supabase/supabase-js';

export interface AuditAssertionRow {
  id: string;
  assertion_kind: string;
  content: string;
  verification_status: string;
  confidence: number | null;
  record_status: string;
  source_excerpt: string;
}

function formatAssertionContent(row: Record<string, unknown>): string {
  const subject = String(row.subject_reference ?? '').trim();
  const predicate = String(row.predicate ?? '').trim();
  const value = String(row.value_text ?? '').trim();
  const parts = [subject, predicate, value].filter(Boolean);
  return parts.join(' · ') || subject || predicate || value || String(row.source_excerpt ?? '');
}

export class AssertionsAuditRepository {
  constructor(private readonly db: SupabaseClient) {}

  async listActiveByInboxItem(inboxItemId: string): Promise<AuditAssertionRow[]> {
    const { data, error } = await this.db
      .from('assertions')
      .select(
        'id, assertion_kind, subject_reference, predicate, value_text, verification_status, confidence, record_status, source_excerpt',
      )
      .eq('inbox_item_id', inboxItemId)
      .eq('record_status', 'active')
      .order('created_at', { ascending: true });
    if (error) throw new Error(`assertions_audit.listActiveByInboxItem: ${error.message}`);

    return (data ?? []).map((row) => {
      const record = row as Record<string, unknown>;
      return {
        id: record.id as string,
        assertion_kind: record.assertion_kind as string,
        content: formatAssertionContent(record),
        verification_status: record.verification_status as string,
        confidence: (record.confidence as number | null) ?? null,
        record_status: record.record_status as string,
        source_excerpt: record.source_excerpt as string,
      };
    });
  }
}
