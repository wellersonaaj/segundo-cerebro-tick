import { z } from 'zod';
import { createWebSearchProvider } from '../../services/web-search/tavily-provider.js';
import { MockWebSearchProvider, websummitRioMockSnippets } from '../../services/web-search/web-search-provider.js';

export const webLookupInputSchema = z.object({
  query: z.string().min(1),
  limit: z.number().int().positive().max(10).optional(),
  use_mock: z.boolean().optional(),
});

export async function webLookup(input: z.infer<typeof webLookupInputSchema>) {
  const limit = input.limit ?? 5;
  let provider = input.use_mock
    ? new MockWebSearchProvider(new Map([['web summit rio', websummitRioMockSnippets()]]))
    : createWebSearchProvider(process.env.WEB_SEARCH_PROVIDER ?? 'tavily', process.env.WEB_SEARCH_API_KEY);

  if (!provider) {
    provider = new MockWebSearchProvider(new Map([['web summit rio', websummitRioMockSnippets()]]));
  }

  const results = await provider.search(input.query, limit);
  return { query: input.query, results };
}
