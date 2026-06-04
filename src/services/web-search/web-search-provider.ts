import type { WebSearchSnippet } from '../../types/external-knowledge-enrichment.js';

export interface WebSearchProvider {
  search(query: string, limit?: number): Promise<WebSearchSnippet[]>;
}

/** In-memory mock for tests and offline calibration. */
export class MockWebSearchProvider implements WebSearchProvider {
  constructor(private readonly responses: Map<string, WebSearchSnippet[]>) {}

  async search(query: string, limit = 5): Promise<WebSearchSnippet[]> {
    const key = query.toLowerCase().replace(/\s+/g, ' ');
    for (const [pattern, snippets] of this.responses) {
      const normPattern = pattern.toLowerCase().replace(/\s+/g, ' ');
      if (key.includes(normPattern) || key.replace(/\s/g, '').includes(normPattern.replace(/\s/g, ''))) {
        return snippets.slice(0, limit);
      }
    }
    return [];
  }
}

export function websummitRioMockSnippets(): WebSearchSnippet[] {
  return [
    {
      title: 'Web Summit Rio 2026',
      url: 'https://rio.websummit.com',
      content:
        'Web Summit Rio returns 8-10 June 2026 at Rio de Janeiro. Join leaders from tech and business.',
    },
  ];
}
