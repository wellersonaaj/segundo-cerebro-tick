export interface ChatMessage {
  role: 'user' | 'system' | 'assistant';
  content: string;
}

export interface OpenAiRagClient {
  embed(text: string, model?: string): Promise<number[]>;
  chatCompletion(input: {
    model: string;
    messages: ChatMessage[];
    max_completion_tokens: number;
    reasoning_effort?: 'low' | 'medium' | 'high';
  }): Promise<{ content: string; finish_reason?: string }>;
}

export class FetchOpenAiRagClient implements OpenAiRagClient {
  constructor(
    private readonly apiKey: string,
    private readonly fetchFn: typeof fetch = fetch,
    private readonly maxRetries = 2,
  ) {}

  async embed(text: string, model = 'text-embedding-3-small'): Promise<number[]> {
    const data = await this.request<{ data: Array<{ embedding: number[] }> }>('embeddings', {
      model,
      input: text,
    });
    return data.data[0]?.embedding ?? [];
  }

  async chatCompletion(input: {
    model: string;
    messages: ChatMessage[];
    max_completion_tokens: number;
    reasoning_effort?: 'low' | 'medium' | 'high';
  }): Promise<{ content: string; finish_reason?: string }> {
    const data = await this.request<{
      choices: Array<{ finish_reason?: string; message: { content: string } }>;
    }>('chat/completions', input);
    const choice = data.choices[0];
    return {
      content: choice?.message?.content ?? '',
      finish_reason: choice?.finish_reason,
    };
  }

  private async request<T>(path: string, body: Record<string, unknown>): Promise<T> {
    let lastErr: Error | null = null;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const r = await this.fetchFn(`https://api.openai.com/v1/${path}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify(body),
        });
        if (!r.ok) {
          const txt = await r.text();
          if (r.status === 429 || r.status >= 500) {
            lastErr = new Error(`openai ${path}: ${r.status} ${txt.slice(0, 200)}`);
            await new Promise((res) => setTimeout(res, 500 * (attempt + 1)));
            continue;
          }
          throw new Error(`openai ${path}: ${r.status} ${txt.slice(0, 200)}`);
        }
        return (await r.json()) as T;
      } catch (e) {
        lastErr = e instanceof Error ? e : new Error(String(e));
        if (attempt === this.maxRetries) break;
        await new Promise((res) => setTimeout(res, 500 * (attempt + 1)));
      }
    }
    throw lastErr ?? new Error('openai unknown error');
  }
}
