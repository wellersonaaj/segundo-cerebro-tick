import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_EVENT_ENTITY_RELATION_TYPE,
  EventsRepository,
} from '../src/repositories/events.repository.js';

describe('EventsRepository.linkEntity', () => {
  function createRepo() {
    const insert = vi.fn().mockResolvedValue({ error: null });
    const db = {
      from: vi.fn(() => ({ insert })),
    };
    const repo = new EventsRepository(db as never);
    return { repo, insert };
  }

  it('persists mentioned when relationType is omitted', async () => {
    const { repo, insert } = createRepo();
    await repo.linkEntity('event-1', 'entity-1');

    expect(insert).toHaveBeenCalledWith({
      event_id: 'event-1',
      entity_id: 'entity-1',
      role: null,
      relation_type: DEFAULT_EVENT_ENTITY_RELATION_TYPE,
    });
  });

  it('preserves explicit relationType', async () => {
    const { repo, insert } = createRepo();
    await repo.linkEntity('event-1', 'entity-1', { relationType: 'participant' });

    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ relation_type: 'participant' }),
    );
  });

  it('keeps role null when absent', async () => {
    const { repo, insert } = createRepo();
    await repo.linkEntity('event-1', 'entity-1');

    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ role: null }));
  });

  it('preserves explicit role', async () => {
    const { repo, insert } = createRepo();
    await repo.linkEntity('event-1', 'entity-1', { role: 'organizer' });

    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ role: 'organizer' }));
  });

  it('never sends relation_type null', async () => {
    const { repo, insert } = createRepo();
    await repo.linkEntity('event-1', 'entity-1', { role: null });

    const payload = insert.mock.calls[0]?.[0] as { relation_type: string | null };
    expect(payload.relation_type).not.toBeNull();
    expect(payload.relation_type).toBe('mentioned');
  });
});
