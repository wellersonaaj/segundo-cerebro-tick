import { describe, expect, it, vi } from 'vitest';
import type { AssertionsRepository } from '../src/repositories/assertions.repository.js';
import type { ClarificationsRepository } from '../src/repositories/clarifications.repository.js';
import type { EntitiesRepository } from '../src/repositories/entities.repository.js';
import type { EventsRepository } from '../src/repositories/events.repository.js';
import type { InboxItemEntitiesRepository } from '../src/repositories/inbox-item-entities.repository.js';
import type { TasksRepository } from '../src/repositories/tasks.repository.js';
import { EntityUpsertService } from '../src/services/entity-upsert.service.js';
import { PersistenceService } from '../src/services/persistence.service.js';
import type { ExtractorOutput } from '../src/types/domain.js';

const TZ = 'America/Sao_Paulo';
const RECEIVED = '2026-05-31T10:00:00-03:00';
const RUN_ID = '00000000-0000-4000-8000-000000000010';

function emptyOutput(overrides: Partial<ExtractorOutput> = {}): ExtractorOutput {
  return {
    schema_version: '1.3',
    inbox_item_id: '00000000-0000-4000-8000-000000000001',
    events: [],
    entities: [],
    assertions: [],
    tasks: [],
    clarification_requests: [],
    requires_review: false,
    review_reasons: [],
    processing_notes: [],
    ...overrides,
  };
}

function buildService(
  entityUpsert: EntityUpsertService,
  events: Partial<EventsRepository> = {},
  assertions: Partial<AssertionsRepository> = {},
) {
  return new PersistenceService(
    {} as EntitiesRepository,
    {
      createCandidate: vi.fn(async () => ({ id: 'event-1' })),
      linkEntity: vi.fn(),
      ...events,
    } as unknown as EventsRepository,
    {
      createCandidate: vi.fn(async () => ({ id: 'a1' })),
      ...assertions,
    } as unknown as AssertionsRepository,
    {
      createCandidate: vi.fn(async () => ({ id: 't1' })),
    } as unknown as TasksRepository,
    {
      createManyCandidates: vi.fn(async () => []),
    } as unknown as ClarificationsRepository,
    {
      createCandidate: vi.fn(async () => ({ id: 'iie-1' })),
    } as unknown as InboxItemEntitiesRepository,
    entityUpsert,
  );
}

describe('PersistenceService persistCandidates', () => {
  it('uses resolver hint only when resolution is conclusive', async () => {
    const upsert = vi.fn(async () => ({
      entityId: 'e-resolved',
      canonicalName: 'Genius Hotels',
      entityType: 'company' as const,
      resolutionStatus: 'reused_from_resolver' as const,
      aliasesPersisted: [],
      aliasesSkipped: [],
      conflicts: [],
      aliasClarifications: [],
    }));

    const service = buildService({ upsert } as unknown as EntityUpsertService);

    await service.persistCandidates(
      'inbox-1',
      RUN_ID,
      emptyOutput({
        entities: [
          {
            name: 'Genius',
            entity_type: 'other',
            aliases: [],
            source_excerpt: 'Genius',
            confidence: 0.8,
          },
        ],
      }),
      {
        byExtractedName: new Map([['genius', 'e-resolved']]),
        resolutions: [
          {
            extractedName: 'Genius',
            status: 'resolved',
            resolvedEntityId: 'e-resolved',
            resolvedEntityName: 'Genius Hotels',
            method: 'exact_alias',
            confidence: 0.95,
            evidence: {},
            candidates: [],
          },
        ],
      },
      [],
      RECEIVED,
      TZ,
      'web',
    );

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ resolvedEntityId: 'e-resolved', extractionRunId: RUN_ID }),
    );
  });

  it('bootstrap links entities to primary event and creates inbox_item_entities', async () => {
    const linkEntity = vi.fn(async () => {});
    const createCandidate = vi.fn(async () => ({ id: 'event-1' }));
    const createIie = vi.fn(async () => ({ id: 'iie-1' }));
    const upsert = vi.fn(async () => ({
      entityId: 'e1',
      canonicalName: 'A',
      entityType: 'person' as const,
      resolutionStatus: 'created' as const,
      aliasesPersisted: [],
      aliasesSkipped: [],
      conflicts: [],
      aliasClarifications: [],
    }));

    const fullService = new PersistenceService(
      {} as EntitiesRepository,
      { createCandidate, linkEntity } as unknown as EventsRepository,
      { createCandidate: vi.fn() } as unknown as AssertionsRepository,
      { createCandidate: vi.fn() } as unknown as TasksRepository,
      { createManyCandidates: vi.fn(async () => []) } as unknown as ClarificationsRepository,
      { createCandidate: createIie } as unknown as InboxItemEntitiesRepository,
      { upsert } as unknown as EntityUpsertService,
    );

    await fullService.persistCandidates(
      'inbox-1',
      RUN_ID,
      emptyOutput({
        events: [
          {
            event_type: 'profile_created',
            description: 'snapshot',
            occurred_at: null,
            source_excerpt: 'snapshot',
            confidence: 1,
            entity_names: [],
          },
        ],
        entities: [
          {
            name: 'A',
            entity_type: 'person',
            aliases: [],
            source_excerpt: 'A',
            confidence: 1,
          },
        ],
      }),
      { byExtractedName: new Map(), resolutions: [] },
      [],
      RECEIVED,
      TZ,
      'bootstrap',
    );

    expect(createIie).toHaveBeenCalled();
    expect(linkEntity).toHaveBeenCalledWith('event-1', 'e1', {
      relationType: 'mentioned',
      role: null,
    });
  });

  it('persists all assertions without silent truncation', async () => {
    const createAssertion = vi.fn(async () => ({ id: 'a1' })) as never;
    const assertions = Array.from({ length: 20 }, (_, i) => ({
      assertion_type: 'fact' as const,
      content: `fact ${i}`,
      status: 'unverified' as const,
      source_excerpt: `excerpt ${i}`,
      confidence: 0.9,
    }));

    const service = buildService({ upsert: vi.fn() } as unknown as EntityUpsertService, {}, {
      createCandidate: createAssertion,
    });

    const result = await service.persistCandidates(
      'inbox-1',
      RUN_ID,
      emptyOutput({ assertions }),
      { byExtractedName: new Map(), resolutions: [] },
      [],
      RECEIVED,
      TZ,
      'bootstrap',
    );

    expect(createAssertion).toHaveBeenCalledTimes(20);
    expect(result.assertionIds).toHaveLength(20);
  });
});
