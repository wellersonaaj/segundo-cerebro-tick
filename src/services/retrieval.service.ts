import type { SupabaseClient } from '@supabase/supabase-js';
import type { EmbedderService } from './embedder.service.js';
import type { HybridSearchRow, RankedRow } from './rag/rag.types.js';
import { hybridRowToRanked } from './rag/rag.types.js';

export type HybridSearchTable = 'inbox_items' | 'assertions';

export interface RetrieveOptions {
  topKInbox?: number;
  topKAssertions?: number;
  userId?: string;
}

export interface RetrieveResult {
  inbox: RankedRow[];
  assertions: RankedRow[];
  latencyMs: number;
}

export class RetrievalService {
  constructor(
    private readonly db: SupabaseClient,
    private readonly embedder: EmbedderService,
  ) {}

  async retrieve(query: string, opts: RetrieveOptions = {}): Promise<RetrieveResult> {
    const started = Date.now();
    const topKInbox = opts.topKInbox ?? 10;
    const topKAssertions = opts.topKAssertions ?? 5;

    const [inboxRows, assertionRows] = await Promise.all([
      this.hybridSearch('inbox_items', query, topKInbox),
      this.hybridSearch('assertions', query, topKAssertions),
    ]);

    return {
      inbox: inboxRows.map((row) => hybridRowToRanked(row)),
      assertions: assertionRows.map((row) => hybridRowToRanked(row)),
      latencyMs: Date.now() - started,
    };
  }

  private async hybridSearch(
    table: HybridSearchTable,
    query: string,
    limit: number,
  ): Promise<HybridSearchRow[]> {
    const embedding = await this.embedder.embed(query);
    const rpcName = table === 'inbox_items' ? 'hybrid_search_inbox_items' : 'hybrid_search_assertions';
    const { data, error } = await this.db.rpc(rpcName, {
      p_query_embedding: `[${embedding.join(',')}]`,
      p_query_text: query,
      p_limit: limit,
    });
    if (error) {
      throw new Error(`rpc ${rpcName}: ${error.message}`);
    }
    return (data ?? []) as HybridSearchRow[];
  }
}
