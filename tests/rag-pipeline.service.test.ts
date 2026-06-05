import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { ComposerService } from '../src/services/composer.service.js';
import { OpenTasksService } from '../src/services/open-tasks.service.js';
import { RAGPipelineService } from '../src/services/rag-pipeline.service.js';
import { RerankService } from '../src/services/rerank.service.js';
import { RetrievalService } from '../src/services/retrieval.service.js';
import { VerifierService } from '../src/services/verifier.service.js';
import type { OpenTaskRow, RankedRow } from '../src/services/rag/rag.types.js';

const fixturePath = join(dirname(fileURLToPath(import.meta.url)), 'fixtures/rag-pipeline.fixture.json');

type FixtureCase = {
  name: string;
  query: string;
  retrieval?: { inbox: RankedRow[]; assertions: RankedRow[] };
  tasks?: OpenTaskRow[];
  compose_response?: string;
  expected_answer_prefix?: string;
  expected_has_citation?: boolean;
  expected_contains_fallback?: boolean;
  sources?: RankedRow[];
  expected_confidence?: number;
};

const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as FixtureCase[];

function buildPipeline(overrides: {
  retrieve?: RetrievalService['retrieve'];
  rerank?: RerankService['rerank'];
  compose?: ComposerService['compose'];
}) {
  const retrieval = { retrieve: overrides.retrieve ?? vi.fn() } as unknown as RetrievalService;
  const rerank = { rerank: overrides.rerank ?? vi.fn(async (_q, items: RankedRow[]) => items) } as unknown as RerankService;
  const composer = { compose: overrides.compose ?? vi.fn() } as unknown as ComposerService;
  const verifier = new VerifierService();
  const openTasks = { listOpen: vi.fn(async () => []) } as unknown as OpenTasksService;
  return new RAGPipelineService(retrieval, rerank, composer, verifier, openTasks);
}

describe('RAGPipelineService', () => {
  it('no context returns default not-found answer', async () => {
    const c = fixture.find((x) => x.name === 'no_context')!;
    const pipeline = buildPipeline({
      retrieve: vi.fn(async () => ({
        inbox: c.retrieval!.inbox,
        assertions: c.retrieval!.assertions,
        latencyMs: 1,
      })),
      compose: vi.fn(async () => 'Nao encontrei nada relevante na memoria sobre isso ainda.'),
    });
    const result = await pipeline.answer(c.query);
    expect(result.answer).toMatch(new RegExp(c.expected_answer_prefix!, 'i'));
    expect(result.sources).toHaveLength(0);
    expect(result.confidence).toBe(0);
  });

  it('dense context composes answer with citations', async () => {
    const c = fixture.find((x) => x.name === 'dense_context_with_citation')!;
    const pipeline = buildPipeline({
      retrieve: vi.fn(async () => ({
        inbox: c.retrieval!.inbox,
        assertions: c.retrieval!.assertions,
        latencyMs: 2,
      })),
      compose: vi.fn(async () => c.compose_response!),
    });
    const result = await pipeline.answer(c.query);
    expect(result.answer).toContain('[1]');
    expect(result.sources).toHaveLength(1);
    expect(result.confidence).toBeGreaterThan(0);
  });

  it('verify failure appends weak fallback suffix', async () => {
    const c = fixture.find((x) => x.name === 'verify_fails_adds_fallback')!;
    const pipeline = buildPipeline({
      retrieve: vi.fn(async () => ({
        inbox: c.retrieval!.inbox,
        assertions: c.retrieval!.assertions,
        latencyMs: 1,
      })),
      compose: vi.fn(async () => c.compose_response!),
    });
    const result = await pipeline.answer(c.query, { openTasks: c.tasks });
    expect(result.answer).toContain('Resposta baseada em poucos itens');
  });

  it('confidence is average of reranked source scores', async () => {
    const c = fixture.find((x) => x.name === 'confidence_average')!;
    const pipeline = buildPipeline({
      retrieve: vi.fn(async () => ({
        inbox: c.sources!,
        assertions: [],
        latencyMs: 1,
      })),
      compose: vi.fn(async () => 'Resposta com [1] e [2].'),
    });
    const result = await pipeline.answer(c.query);
    expect(result.confidence).toBe(c.expected_confidence);
  });
});
