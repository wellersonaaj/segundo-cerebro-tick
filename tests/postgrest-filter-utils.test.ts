import { describe, expect, it } from 'vitest';
import {
  buildIlikeOrFilter,
  quotePostgrestFilterValue,
  quotePostgrestIlikePattern,
} from '../src/db/postgrest-filter-utils.js';

describe('postgrest filter utils', () => {
  it('quotes simple terms without changing semantics', () => {
    const pattern = quotePostgrestIlikePattern('Genius');
    expect(pattern).toBe('"%Genius%"');
    expect(buildIlikeOrFilter(['description', 'source_excerpt'], 'Genius')).toBe(
      'description.ilike."%Genius%",source_excerpt.ilike."%Genius%"',
    );
  });

  it('keeps commas inside quoted ilike values', () => {
    const query = 'Contagem, Minas Gerais';
    const filter = buildIlikeOrFilter(['description', 'source_excerpt'], query);

    expect(filter).toBe(
      'description.ilike."%Contagem, Minas Gerais%",source_excerpt.ilike."%Contagem, Minas Gerais%"',
    );
    expect(filter.match(/\.ilike\./g)).toHaveLength(2);
    expect(filter.startsWith('description.ilike."%Contagem, Minas Gerais%"')).toBe(true);
  });

  it('quotes values containing parentheses', () => {
    const query = 'Projeto (fase 2)';
    const filter = buildIlikeOrFilter(['description'], query);

    expect(filter).toBe('description.ilike."%Projeto (fase 2)%"');
  });

  it('escapes double quotes and backslashes inside quoted values', () => {
    expect(quotePostgrestFilterValue('say "hello"')).toBe('"say \\"hello\\""');
    expect(quotePostgrestFilterValue(String.raw`path\to\file`)).toBe(String.raw`"path\\to\\file"`);
    expect(buildIlikeOrFilter(['content'], 'term "quoted"')).toBe(
      'content.ilike."%term \\"quoted\\"%"',
    );
  });

  it('builds multi-column filters with a single quoted pattern per column', () => {
    const filter = buildIlikeOrFilter(['title', 'description', 'source_excerpt'], 'Bruno');

    expect(filter).toBe(
      'title.ilike."%Bruno%",description.ilike."%Bruno%",source_excerpt.ilike."%Bruno%"',
    );
  });
});
