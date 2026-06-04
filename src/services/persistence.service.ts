import { AssertionsRepository } from '../repositories/assertions.repository.js';
import { ClarificationsRepository } from '../repositories/clarifications.repository.js';
import { EntitiesRepository } from '../repositories/entities.repository.js';
import { EventsRepository } from '../repositories/events.repository.js';
import { InboxItemEntitiesRepository } from '../repositories/inbox-item-entities.repository.js';
import { TasksRepository } from '../repositories/tasks.repository.js';
import type { ExtractedClarification, ExtractorOutput } from '../types/domain.js';
import { normalizeText } from '../utils/normalize.js';
import { resolveDueAt } from '../utils/temporal.js';
import {
  eventRefFromExtracted,
  isBootstrapSourceChannel,
  logBootstrapPrimaryEventSelected,
  selectBootstrapPrimaryEvent,
} from './bootstrap-primary-event.js';
import { EntityUpsertService } from './entity-upsert.service.js';
import type { ResolvedEntityMap } from './memory-resolver.service.js';

export interface PersistenceResult {
  entityIds: Map<string, string>;
  canonicalEntityIds: string[];
  eventIds: string[];
  assertionIds: string[];
  taskIds: string[];
  clarificationIds: string[];
  entitiesCreated: number;
  entitiesResolved: number;
  aliasesPersisted: number;
  bootstrapPrimaryEventId?: string;
}

export class PersistenceService {
  constructor(
    private readonly entitiesRepo: EntitiesRepository,
    private readonly eventsRepo: EventsRepository,
    private readonly assertionsRepo: AssertionsRepository,
    private readonly tasksRepo: TasksRepository,
    private readonly clarificationsRepo: ClarificationsRepository,
    private readonly inboxItemEntitiesRepo: InboxItemEntitiesRepository,
    private readonly entityUpsert: EntityUpsertService,
  ) {}

  async persistCandidates(
    inboxItemId: string,
    extractionRunId: string,
    output: ExtractorOutput,
    resolvedMap: ResolvedEntityMap,
    clarifications: ExtractorOutput['clarification_requests'],
    receivedAt: string,
    timezone: string,
    sourceChannel: string,
    correctionId?: string,
  ): Promise<PersistenceResult> {
    const entityIds = new Map<string, string>();
    const canonicalEntityIds: string[] = [];
    let entitiesCreated = 0;
    let entitiesResolved = 0;
    let aliasesPersisted = 0;
    const aliasClarifications: ExtractedClarification[] = [];

    for (const entity of output.entities) {
      const key = normalizeText(entity.name);
      const resolution = resolvedMap.resolutions.find(
        (r) => normalizeText(r.extractedName) === key,
      );
      const resolvedEntityId =
        resolution?.status === 'resolved' ? resolution.resolvedEntityId : null;

      const upsert = await this.entityUpsert.upsert({
        inboxItemId,
        extractionRunId,
        extractedEntity: entity,
        resolvedEntityId,
      });

      entityIds.set(key, upsert.entityId);
      canonicalEntityIds.push(upsert.entityId);
      aliasesPersisted += upsert.aliasesPersisted.length;
      aliasClarifications.push(...upsert.aliasClarifications);

      await this.inboxItemEntitiesRepo.createCandidate({
        inboxItemId,
        extractionRunId,
        entityId: upsert.entityId,
        relationType: 'mentioned',
        sourceExcerpt: entity.source_excerpt,
        confidence: entity.confidence,
        correctionId,
      });

      if (upsert.resolutionStatus === 'created') {
        entitiesCreated++;
      } else {
        entitiesResolved++;
      }
    }

    const uniqueCanonicalEntityIds = [...new Set(canonicalEntityIds)];
    const isBootstrap = isBootstrapSourceChannel(sourceChannel);

    const eventIds: string[] = [];
    const persistedEventRefs: ReturnType<typeof eventRefFromExtracted>[] = [];

    for (let index = 0; index < output.events.length; index++) {
      const event = output.events[index]!;
      const created = await this.eventsRepo.createCandidate(
        inboxItemId,
        extractionRunId,
        event,
        correctionId,
      );
      eventIds.push(created.id);
      persistedEventRefs.push(eventRefFromExtracted(created.id, event, index));

      if (!isBootstrap) {
        await this.linkEventContextually(created.id, event, entityIds, output);
      }
    }

    let bootstrapPrimaryEventId: string | undefined;

    if (isBootstrap && persistedEventRefs.length > 0) {
      const selection = selectBootstrapPrimaryEvent(persistedEventRefs);
      if (selection) {
        bootstrapPrimaryEventId = selection.eventId;
        for (const entityId of uniqueCanonicalEntityIds) {
          await this.eventsRepo.linkEntity(selection.eventId, entityId, {
            relationType: 'mentioned',
            role: null,
          });
        }
        logBootstrapPrimaryEventSelected(
          inboxItemId,
          selection,
          uniqueCanonicalEntityIds.length,
        );
      }
    }

    const assertionIds: string[] = [];
    for (const assertion of output.assertions) {
      const a = await this.assertionsRepo.createCandidate(
        inboxItemId,
        extractionRunId,
        assertion,
        correctionId,
      );
      assertionIds.push(a.id);
    }

    const taskIds: string[] = [];
    for (const task of output.tasks) {
      const dueAt = resolveDueAt(
        task.temporal_reference_text,
        task.due_at,
        receivedAt,
        timezone,
      );
      const dueIso = dueAt ? (dueAt.includes('T') ? dueAt : `${dueAt}T12:00:00`) : null;
      const t = await this.tasksRepo.createCandidate(
        inboxItemId,
        extractionRunId,
        task,
        dueIso,
        correctionId,
      );
      taskIds.push(t.id);
    }

    const allClarifications = [...clarifications, ...aliasClarifications];
    const savedClarifications = await this.clarificationsRepo.createManyCandidates(
      inboxItemId,
      extractionRunId,
      allClarifications,
      correctionId,
    );

    return {
      entityIds,
      canonicalEntityIds: uniqueCanonicalEntityIds,
      eventIds,
      assertionIds,
      taskIds,
      clarificationIds: savedClarifications.map((c) => c.id),
      entitiesCreated,
      entitiesResolved,
      aliasesPersisted,
      bootstrapPrimaryEventId,
    };
  }

  private async linkEventContextually(
    eventId: string,
    event: ExtractorOutput['events'][number],
    entityIds: Map<string, string>,
    output: ExtractorOutput,
  ): Promise<void> {
    const names = event.entity_names ?? [];
    for (const name of names) {
      const eid = entityIds.get(normalizeText(name));
      if (eid) await this.eventsRepo.linkEntity(eventId, eid);
    }
    for (const entity of output.entities) {
      if (
        normalizeText(event.source_excerpt).includes(normalizeText(entity.name)) ||
        normalizeText(event.description).includes(normalizeText(entity.name))
      ) {
        const eid = entityIds.get(normalizeText(entity.name));
        if (eid) await this.eventsRepo.linkEntity(eventId, eid);
      }
    }
  }
}
