import { AssertionsRepository } from '../repositories/assertions.repository.js';
import { EntitiesRepository } from '../repositories/entities.repository.js';
import { EntityResolutionRepository } from '../repositories/entity-resolution.repository.js';
import { EventsRepository } from '../repositories/events.repository.js';
import { TasksRepository } from '../repositories/tasks.repository.js';
import type { EntityType } from '../types/domain.js';

export class MemorySearchService {
  constructor(
    private readonly entitiesRepo: EntitiesRepository,
    private readonly eventsRepo: EventsRepository,
    private readonly assertionsRepo: AssertionsRepository,
    private readonly tasksRepo: TasksRepository,
    private readonly mentionsRepo: EntityResolutionRepository,
  ) {}

  async search(query: string, limit = 10) {
    const [entities, events, assertions, tasks, mentions] = await Promise.all([
      this.entitiesRepo.searchEntitiesQuery(query, [], limit),
      this.eventsRepo.searchText(query, limit),
      this.assertionsRepo.searchText(query, limit),
      this.tasksRepo.listOpen(query, limit),
      this.mentionsRepo.searchRecentMentions(query, 90, limit),
    ]);

    return {
      query,
      entities,
      events,
      assertions,
      tasks,
      recent_mentions: mentions,
    };
  }

  async getEntityDetails(entityId: string) {
    const entity = await this.entitiesRepo.findById(entityId);
    if (!entity) return null;
    const aliases = await this.entitiesRepo.getAliases(entityId);
    const events = await this.eventsRepo.listByEntity(entityId, 10);
    const tasks = await this.tasksRepo.listOpen(undefined, 20);
    const relatedTasks = tasks.filter(
      (t) =>
        t.source_excerpt.toLowerCase().includes(entity.name.toLowerCase()) ||
        t.title.toLowerCase().includes(entity.name.toLowerCase()),
    );
    return { entity, aliases, events, open_tasks: relatedTasks };
  }

  searchEntities(query: string, entityTypes: EntityType[] = [], limit = 5) {
    return this.entitiesRepo.searchEntitiesQuery(query, entityTypes, limit);
  }

  searchRecentMentions(query: string, days = 90, limit = 10) {
    return this.mentionsRepo.searchRecentMentions(query, days, limit);
  }

  listOpenTasks(query?: string, limit = 10) {
    return this.tasksRepo.listOpen(query, limit);
  }
}
