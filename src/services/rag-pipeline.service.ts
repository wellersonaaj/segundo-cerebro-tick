import { loadEnv } from '../config/env.js';
import type { ComposerService } from './composer.service.js';
import type { OpenTasksService } from './open-tasks.service.js';
import type { RerankService } from './rerank.service.js';
import type { RetrievalService } from './retrieval.service.js';
import type { OpenTaskRow, RankedRow } from './rag/rag.types.js';
import type { VerifierService } from './verifier.service.js';

const DEFAULT_TASKS_IN_CONTEXT = 10;

export interface RagAnswerOptions {
  topKInbox?: number;
  topKAssertions?: number;
  rerankKeepInbox?: number;
  rerankKeepAssertions?: number;
  openTasks?: OpenTaskRow[];
  tasksInContext?: number;
}

export interface RagAnswerResult {
  answer: string;
  sources: RankedRow[];
  confidence: number;
}

export class RAGPipelineService {
  constructor(
    private readonly retrieval: RetrievalService,
    private readonly rerank: RerankService,
    private readonly composer: ComposerService,
    private readonly verifier: VerifierService,
    private readonly openTasks: OpenTasksService,
  ) {}

  async answer(query: string, opts: RagAnswerOptions = {}): Promise<RagAnswerResult> {
    const env = loadEnv();
    const topKInbox = opts.topKInbox ?? env.RAG_RETRIEVAL_TOP_K;
    const topKAssertions = opts.topKAssertions ?? 5;
    const rerankKeepInbox = opts.rerankKeepInbox ?? env.RAG_RERANK_KEEP_INBOX;
    const rerankKeepAssertions = opts.rerankKeepAssertions ?? env.RAG_RERANK_KEEP_ASSERTIONS;
    const tasksInContext = opts.tasksInContext ?? DEFAULT_TASKS_IN_CONTEXT;

    const retrieved = await this.retrieval.retrieve(query, { topKInbox, topKAssertions });
    const [inboxRanked, assertionsRanked] = await Promise.all([
      this.rerank.rerank(query, retrieved.inbox, rerankKeepInbox),
      this.rerank.rerank(query, retrieved.assertions, rerankKeepAssertions),
    ]);
    const sources = [...inboxRanked, ...assertionsRanked];

    const allTasks =
      opts.openTasks ??
      (await this.openTasks.listOpen(20).catch(() => [] as OpenTaskRow[]));
    const tasks = allTasks.slice(0, tasksInContext);

    let draft = await this.composer.compose(query, sources, tasks);
    const check = this.verifier.verifyCoverage(query, draft, sources, tasks);
    draft = this.verifier.applyWeakFallback(draft, check);

    const confidence =
      sources.length > 0
        ? sources.reduce((sum, row) => sum + row.score, 0) / sources.length
        : 0;

    return { answer: draft, sources, confidence };
  }
}
