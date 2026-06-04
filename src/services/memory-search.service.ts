import { AssertionsRepository } from '../repositories/assertions.repository.js';
import { EntitiesRepository } from '../repositories/entities.repository.js';
import { EntityResolutionRepository } from '../repositories/entity-resolution.repository.js';
import { EventsRepository } from '../repositories/events.repository.js';
import { InboxItemEntitiesRepository } from '../repositories/inbox-item-entities.repository.js';
import { TasksRepository } from '../repositories/tasks.repository.js';
import type { EntityType } from '../types/domain.js';

export class MemorySearchService {
  constructor(
    private readonly entitiesRepo: EntitiesRepository,
    private readonly eventsRepo: EventsRepository,
    private readonly assertionsRepo: AssertionsRepository,
    private readonly tasksRepo: TasksRepository,
    private readonly mentionsRepo: EntityResolutionRepository,
    private readonly inboxItemEntitiesRepo: InboxItemEntitiesRepository,
  ) {}

  async getEntityDetails(entityId: string) {
    const entity = await this.entitiesRepo.findById(entityId);
    if (!entity || entity.registry_status !== 'active') return null;
    const aliasRows = await this.entitiesRepo.getAliases(entityId);
    const aliases = aliasRows.map((a) => a.alias);
    const events = await this.eventsRepo.listByEntity(entityId, 10);
    const tasks = await this.tasksRepo.listOpen(undefined, 20);
    const relatedTasks = tasks.filter(
      (t) =>
        t.source_excerpt.toLowerCase().includes(entity.name.toLowerCase()) ||
        t.title.toLowerCase().includes(entity.name.toLowerCase()),
    );
    const sources = await this.inboxItemEntitiesRepo.listActiveByEntity(entityId);
    return { entity, aliases, events, open_tasks: relatedTasks, sources };
  }

  async getEntitySources(entityId: string) {
    const links = await this.inboxItemEntitiesRepo.listActiveByEntity(entityId);
    return links.map((link) => ({
      inbox_item_id: link.inbox_item_id,
      extraction_run_id: link.extraction_run_id,
      relation_type: link.relation_type,
      source_excerpt: link.source_excerpt,
      confidence: link.confidence,
    }));
  }

  async search(query: string, limit = 10) {
    const [entities, events, assertions, tasks, mentions] = await Promise.all([
      this.entitiesRepo.searchEntitiesQuery(query, [], limit),
      this.eventsRepo.searchText(query, limit),
      this.assertionsRepo.searchText(query, limit),
      this.tasksRepo.listOpen(query, limit),
      this.mentionsRepo.searchRecentMentions(query, 90, limit),
    ]);

    const entitiesWithAliases = await Promise.all(
      entities.map(async (e) => ({
        ...e,
        aliases: (await this.entitiesRepo.getAliases(e.id)).map((a) => a.alias),
      })),
    );

    return {
      query,
      entities: entitiesWithAliases,
      events,
      assertions,
      tasks,
      recent_mentions: mentions,
    };
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
