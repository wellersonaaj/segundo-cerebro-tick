import { describe, expect, it } from 'vitest';
import {
  mapVisualStatus,
  matchesVisualFilter,
  truncatePreview,
} from '../src/audit/visual-status.js';
import { extractPeripheralTerms } from '../src/audit/peripheral-terms.js';

describe('mapVisualStatus', () => {
  it('maps failed processing to falhou', () => {
    expect(
      mapVisualStatus({
        processing_status: 'failed',
        pending_clarifications_count: 0,
        has_warnings: false,
        has_correction: false,
      }),
    ).toBe('falhou');
  });

  it('maps pending clarifications to revisar', () => {
    expect(
      mapVisualStatus({
        processing_status: 'completed',
        pending_clarifications_count: 1,
        has_warnings: false,
        has_correction: false,
      }),
    ).toBe('revisar');
  });

  it('maps correction without pending issues to corrigido', () => {
    expect(
      mapVisualStatus({
        processing_status: 'completed',
        pending_clarifications_count: 0,
        has_warnings: false,
        has_correction: true,
      }),
    ).toBe('corrigido');
  });

  it('maps clean completed inbox to processado', () => {
    expect(
      mapVisualStatus({
        processing_status: 'completed',
        pending_clarifications_count: 0,
        has_warnings: false,
        has_correction: false,
      }),
    ).toBe('processado');
  });
});

describe('matchesVisualFilter', () => {
  it('filters revisar and falhas', () => {
    expect(matchesVisualFilter('revisar', 'revisar')).toBe(true);
    expect(matchesVisualFilter('processado', 'revisar')).toBe(false);
    expect(matchesVisualFilter('falhou', 'falhas')).toBe(true);
    expect(matchesVisualFilter('corrigido', 'todos')).toBe(true);
  });
});

describe('truncatePreview', () => {
  it('truncates long content with ellipsis', () => {
    const text = 'a'.repeat(150);
    expect(truncatePreview(text, 120)).toBe(`${'a'.repeat(120)}…`);
  });
});

describe('extractPeripheralTerms', () => {
  it('extracts only known prefixed notes', () => {
    expect(
      extractPeripheralTerms(
        ['peripheral_ambiguity_ignored: integração'],
        ['generic_entity_term_dropped: fornecedor'],
      ),
    ).toEqual(['integração', 'fornecedor']);
  });

  it('returns empty for unrecognized notes', () => {
    expect(extractPeripheralTerms(['some random note'], [])).toEqual([]);
  });
});
