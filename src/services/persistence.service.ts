import { AssertionsRepository } from '../repositories/assertions.repository.js';
import { ClarificationsRepository } from '../repositories/clarifications.repository.js';
import { EntitiesRepository } from '../repositories/entities.repository.js';
import { EventsRepository } from '../repositories/events.repository.js';
import { TasksRepository } from '../repositories/tasks.repository.js';
import type { ExtractedEntity, ExtractorOutput } from '../types/domain.js';
import { normalizeText } from '../utils/normalize.js';
import { resolveDueAt } from '../utils/temporal.js';
import type { ResolvedEntityMap } from './memory-resolver.service.js';

export interface PersistenceResult {
  entityIds: Map<string, string>;
  eventIds: string[];
  assertionIds: string[];
  taskIds: string[];
  clarificationIds: string[];
  entitiesCreated: number;
  entitiesResolved: number;
}

export class PersistenceService {
  constructor(
    private readonly entitiesRepo: EntitiesRepository,
    private readonly eventsRepo: EventsRepository,
    private readonly assertionsRepo: AssertionsRepository,
    private readonly tasksRepo: TasksRepository,
    private readonly clarificationsRepo: ClarificationsRepository,
  ) {}

  async persistExtraction(
    inboxItemId: string,
    output: ExtractorOutput,
    resolvedMap: ResolvedEntityMap,
    clarifications: ExtractorOutput['clarification_requests'],
    receivedAt: string,
    timezone: string,
    correctionId?: string,
  ): Promise<PersistenceResult> {
    const entityIds = new Map<string, string>();
    let entitiesCreated = 0;
    let entitiesResolved = 0;

    for (const entity of output.entities) {
      const key = normalizeText(entity.name);
      const existingId = resolvedMap.byExtractedName.get(key);
      if (existingId) {
        entityIds.set(key, existingId);
        entitiesResolved++;
        continue;
      }

      const found = await this.entitiesRepo.findByNormalizedName(key);
      if (found) {
        entityIds.set(key, found.id);
        entitiesResolved++;
        continue;
      }

      const created = await this.createEntity(entity);
      entityIds.set(key, created.id);
      entitiesCreated++;
    }

    const eventIds: string[] = [];
    for (const event of output.events) {
      const created = await this.eventsRepo.create(inboxItemId, event, correctionId);
      eventIds.push(created.id);
      const names = event.entity_names ?? [];
      for (const name of names) {
        const eid = entityIds.get(normalizeText(name));
        if (eid) await this.eventsRepo.linkEntity(created.id, eid);
      }
      for (const entity of output.entities) {
        if (
          normalizeText(event.source_excerpt).includes(normalizeText(entity.name)) ||
          normalizeText(event.description).includes(normalizeText(entity.name))
        ) {
          const eid = entityIds.get(normalizeText(entity.name));
          if (eid) await this.eventsRepo.linkEntity(created.id, eid);
        }
      }
    }

    const assertionIds: string[] = [];
    for (const assertion of output.assertions) {
      const a = await this.assertionsRepo.create(inboxItemId, assertion, correctionId);
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
      const t = await this.tasksRepo.create(inboxItemId, task, dueIso, correctionId);
      taskIds.push(t.id);
    }

    const savedClarifications = await this.clarificationsRepo.createMany(
      inboxItemId,
      clarifications,
    );

    return {
      entityIds,
      eventIds,
      assertionIds,
      taskIds,
      clarificationIds: savedClarifications.map((c) => c.id),
      entitiesCreated,
      entitiesResolved,
    };
  }

  private async createEntity(entity: ExtractedEntity) {
    try {
      return await this.entitiesRepo.create(entity.name, entity.entity_type);
    } catch {
      const existing = await this.entitiesRepo.findByNormalizedName(normalizeText(entity.name));
      if (existing) return existing;
      throw new Error(`Failed to create entity: ${entity.name}`);
    }
  }
}
