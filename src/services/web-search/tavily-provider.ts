import type { WebSearchProvider } from './web-search-provider.js';
import type { WebSearchSnippet } from '../../types/external-knowledge-enrichment.js';

export class TavilyWebSearchProvider implements WebSearchProvider {
  constructor(private readonly apiKey: string) {}

  async search(query: string, limit = 5): Promise<WebSearchSnippet[]> {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: this.apiKey,
        query,
        max_results: limit,
        search_depth: 'basic',
      }),
    });
    if (!res.ok) {
      throw new Error(`Tavily search failed: ${res.status}`);
    }
    const data = (await res.json()) as {
      results?: Array<{ title?: string; url?: string; content?: string }>;
    };
    return (data.results ?? []).map((r) => ({
      title: r.title ?? '',
      url: r.url ?? '',
      content: r.content ?? '',
    }));
  }
}

export function createWebSearchProvider(
  provider: string,
  apiKey: string | undefined,
): WebSearchProvider | null {
  if (!apiKey?.trim()) return null;
  if (provider === 'tavily') {
    return new TavilyWebSearchProvider(apiKey.trim());
  }
  return null;
}
