import { describe, expect, it } from 'vitest';
import { dueAtColumnsFromTemporal } from '../src/types/domain-v2.js';
import type { NormalizedTemporalValue } from '../src/types/temporal-normalization.js';

describe('domain-v2 dueAtColumnsFromTemporal', () => {
  it('maps NormalizedTemporalValue to column set', () => {
    const temporal: NormalizedTemporalValue = {
      literal: 'amanhã às 10h',
      status: 'resolved',
      precision: 'datetime',
      localDate: '2026-06-03',
      localTime: '10:00:00',
      instant: '2026-06-03T13:00:00.000Z',
      timezone: 'America/Sao_Paulo',
      timezoneSource: 'default',
      dueDateBoundary: 'exact',
      implicitYear: false,
      implicitMonth: false,
      confidence: 1,
      reasonCode: 'relative_day_resolved',
      reasonDetail: null,
      matchedPatternId: 'relative_with_time',
      normalizerId: 'temporal-normalizer',
      normalizerVersion: '1.0.0',
    };

    const cols = dueAtColumnsFromTemporal(temporal);
    expect(cols.due_at_literal).toBe('amanhã às 10h');
    expect(cols.due_at_local_date).toBe('2026-06-03');
    expect(cols.due_at_status).toBe('resolved');
    expect(cols.due_at_normalizer_version).toBe('1.0.0');
  });

  it('preserves fallback literal when temporal is null', () => {
    const cols = dueAtColumnsFromTemporal(null, 'sexta-feira');
    expect(cols.due_at_literal).toBe('sexta-feira');
    expect(cols.due_at_instant).toBeNull();
  });
});

describe('PersistenceV2Service mapping (structural)', () => {
  it('exports persistCandidates', async () => {
    const { PersistenceV2Service } = await import('../src/services/persistence-v2.service.js');
    expect(typeof PersistenceV2Service.prototype.persistCandidates).toBe('function');
  });
});
