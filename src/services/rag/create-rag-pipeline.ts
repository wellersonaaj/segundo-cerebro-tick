import type { SupabaseClient } from '@supabase/supabase-js';
import { loadEnv } from '../../config/env.js';
import { getSupabase } from '../../db/supabase.js';
import { ComposerService } from '../composer.service.js';
import { EmbedderService } from '../embedder.service.js';
import { OpenTasksService } from '../open-tasks.service.js';
import { RAGPipelineService } from '../rag-pipeline.service.js';
import { RerankService } from '../rerank.service.js';
import { RetrievalService } from '../retrieval.service.js';
import { VerifierService } from '../verifier.service.js';
import { FetchOpenAiRagClient } from './openai-rag.client.js';

export function createRetrievalService(deps: {
  db?: SupabaseClient;
  openaiApiKey?: string;
} = {}): RetrievalService {
  const env = loadEnv();
  const apiKey = deps.openaiApiKey ?? env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY required for retrieval service');
  }
  const db = deps.db ?? getSupabase();
  const openai = new FetchOpenAiRagClient(apiKey);
  const embedder = new EmbedderService(openai);
  return new RetrievalService(db, embedder);
}

export function createRagPipeline(deps: {
  db?: SupabaseClient;
  openaiApiKey?: string;
} = {}): RAGPipelineService {
  const env = loadEnv();
  const apiKey = deps.openaiApiKey ?? env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY required for RAG pipeline');
  }
  const db = deps.db ?? getSupabase();
  const openai = new FetchOpenAiRagClient(apiKey);
  const embedder = new EmbedderService(openai);
  const retrieval = new RetrievalService(db, embedder);
  const rerank = new RerankService(openai);
  const composer = new ComposerService(openai);
  const verifier = new VerifierService();
  const openTasks = new OpenTasksService(db);
  return new RAGPipelineService(retrieval, rerank, composer, verifier, openTasks);
}
