export interface HybridSearchRow {
  id: string;
  raw_content: string;
  source_channel: string | null;
  occurred_at: string | null;
  combined_score: number;
  vector_rank: number | null;
  text_rank: number | null;
}

export interface RankedRow {
  id: string;
  content: string;
  source_channel: string;
  occurred_at: string;
  score: number;
}

export interface OpenTaskRow {
  id: string;
  title: string;
  due_at_local_date: string | null;
  due_at_local_time: string | null;
  status: string;
  source_excerpt: string | null;
}

export interface VerifyCoverageResult {
  ok: boolean;
  reason?: string;
}

export function hybridRowToRanked(row: HybridSearchRow, score?: number): RankedRow {
  return {
    id: row.id,
    content: row.raw_content,
    source_channel: row.source_channel ?? 'memory',
    occurred_at: row.occurred_at ? String(row.occurred_at).slice(0, 16) : '',
    score: score ?? row.combined_score,
  };
}
