import type { OpenAiRagClient } from './rag/openai-rag.client.js';

const DEFAULT_EMBEDDING_MODEL = 'text-embedding-3-small';

export class EmbedderService {
  constructor(
    private readonly openai: OpenAiRagClient,
    private readonly model = DEFAULT_EMBEDDING_MODEL,
  ) {}

  async embed(text: string): Promise<number[]> {
    return this.openai.embed(text, this.model);
  }
}
