import { describe, expect, it } from 'vitest';
import { selectBootstrapPrimaryEvent } from '../src/services/bootstrap-primary-event.js';

describe('selectBootstrapPrimaryEvent', () => {
  it('returns single event when only one exists', () => {
    const result = selectBootstrapPrimaryEvent([
      { id: 'e1', event_type: 'profile_created', confidence: 0.8, index: 0 },
    ]);
    expect(result).toEqual({
      eventId: 'e1',
      eventType: 'profile_created',
      strategy: 'single_event',
    });
  });

  it('prefers document_snapshot over profile_created', () => {
    const result = selectBootstrapPrimaryEvent([
      { id: 'e1', event_type: 'profile_created', confidence: 1, index: 0 },
      { id: 'e2', event_type: 'document_snapshot', confidence: 0.5, index: 1 },
    ]);
    expect(result?.eventId).toBe('e2');
    expect(result?.strategy).toBe('document_snapshot');
  });

  it('prefers profile_created when no document_snapshot', () => {
    const result = selectBootstrapPrimaryEvent([
      { id: 'e1', event_type: 'conversation', confidence: 1, index: 0 },
      { id: 'e2', event_type: 'profile_created', confidence: 0.5, index: 1 },
    ]);
    expect(result?.eventId).toBe('e2');
    expect(result?.strategy).toBe('profile_created');
  });

  it('uses highest confidence when no priority event types', () => {
    const result = selectBootstrapPrimaryEvent([
      { id: 'e1', event_type: 'conversation', confidence: 0.3, index: 0 },
      { id: 'e2', event_type: 'other', confidence: 0.9, index: 1 },
    ]);
    expect(result?.eventId).toBe('e2');
    expect(result?.strategy).toBe('highest_confidence');
  });

  it('breaks confidence ties by first persisted index', () => {
    const result = selectBootstrapPrimaryEvent([
      { id: 'e1', event_type: 'conversation', confidence: 0.9, index: 0 },
      { id: 'e2', event_type: 'other', confidence: 0.9, index: 1 },
    ]);
    expect(result?.eventId).toBe('e1');
    expect(result?.strategy).toBe('first_persisted');
  });
});
