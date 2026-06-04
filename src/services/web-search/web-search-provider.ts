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

export function esxMockSnippets(): WebSearchSnippet[] {
  return [
    {
      title: 'E3 - Wikipedia',
      url: 'https://en.wikipedia.org/wiki/E3',
      content:
        'E3 was a trade event for the video game industry organized by the Entertainment Software Association.',
    },
    {
      title: 'Electronic Entertainment Expo',
      url: 'https://www.e3expo.com',
      content: 'E3 is the Electronic Entertainment Expo, a major gaming industry conference.',
    },
  ];
}
