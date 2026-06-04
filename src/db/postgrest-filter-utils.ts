/**
 * Utilities for building PostgREST raw filter strings (e.g. `.or(...)`).
 * Values must be quoted when they contain reserved characters such as commas.
 */

/** Escape and wrap a value for use inside PostgREST `.or(...)` filter expressions. */
export function quotePostgrestFilterValue(value: string): string {
  const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `"${escaped}"`;
}

/** Build `%query%` ilike pattern quoted for PostgREST raw filters. */
export function quotePostgrestIlikePattern(query: string): string {
  return quotePostgrestFilterValue(`%${query}%`);
}

/** Build a comma-separated `.or(...)` filter of ilike conditions across columns. */
export function buildIlikeOrFilter(columns: readonly string[], query: string): string {
  const pattern = quotePostgrestIlikePattern(query);
  return columns.map((column) => `${column}.ilike.${pattern}`).join(',');
}
