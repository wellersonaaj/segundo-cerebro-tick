export function createEmptySupabaseMock(): {
  from: () => Record<string, unknown>;
  rpc: () => Promise<{ data: unknown[]; error: null }>;
} {
  const result = { data: [] as unknown[], error: null };
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  for (const method of ['select', 'eq', 'order', 'limit', 'insert', 'update', 'or', 'neq', 'in']) {
    builder[method] = chain;
  }
  builder.single = async () => ({ data: null, error: null });
  builder.maybeSingle = async () => ({ data: null, error: null });
  builder.then = (resolve: (value: typeof result) => void) => {
    resolve(result);
    return Promise.resolve(result);
  };
  return {
    from: () => builder,
    rpc: async () => ({ data: [], error: null }),
  };
}
