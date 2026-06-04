import type { SupabaseClient } from '@supabase/supabase-js';
import type { ExtractFn } from '../openai/extractor.service.js';
import { AssertionsRepository } from '../repositories/assertions.repository.js';
import { ClarificationsRepository } from '../repositories/clarifications.repository.js';
import { CorrectionsRepository } from '../repositories/corrections.repository.js';
import { EntityAliasEvidencesRepository } from '../repositories/entity-alias-evidences.repository.js';
import { EntityResolutionRepository } from '../repositories/entity-resolution.repository.js';
import { EntitiesRepository } from '../repositories/entities.repository.js';
import { EventsRepository } from '../repositories/events.repository.js';
import { InboxItemEntitiesRepository } from '../repositories/inbox-item-entities.repository.js';
import { InboxItemsRepository } from '../repositories/inbox-items.repository.js';
import { TasksRepository } from '../repositories/tasks.repository.js';
import { EntityUpsertService } from './entity-upsert.service.js';
import { ExtractionPipelineService } from './extraction-pipeline.service.js';
import { MemoryResolverService } from './memory-resolver.service.js';
import { PersistenceService } from './persistence.service.js';

export class CorrectionService {
  private readonly inboxRepo: InboxItemsRepository;
  private readonly correctionsRepo: CorrectionsRepository;
  private readonly pipeline: ExtractionPipelineService;

  constructor(db: SupabaseClient, extract: ExtractFn) {
    this.inboxRepo = new InboxItemsRepository(db);
    this.correctionsRepo = new CorrectionsRepository(db);
    const entitiesRepo = new EntitiesRepository(db);
    const aliasEvidencesRepo = new EntityAliasEvidencesRepository(db);
    const entityUpsert = new EntityUpsertService(entitiesRepo, aliasEvidencesRepo);
    const memoryResolver = new MemoryResolverService(
      entitiesRepo,
      new EntityResolutionRepository(db),
    );
    const persistence = new PersistenceService(
      entitiesRepo,
      new EventsRepository(db),
      new AssertionsRepository(db),
      new TasksRepository(db),
      new ClarificationsRepository(db),
      new InboxItemEntitiesRepository(db),
      entityUpsert,
    );
    this.pipeline = new ExtractionPipelineService(db, extract, memoryResolver, persistence);
  }

  async applyCorrection(inboxItemId: string, correctionText: string) {
    const inbox = await this.inboxRepo.findById(inboxItemId);
    if (!inbox) throw new Error('Inbox item not found');

    const correction = await this.correctionsRepo.create(inboxItemId, correctionText);
    const effective = await this.pipeline.getEffectiveInputBuilder().buildEffectiveInput(inboxItemId);

    const result = await this.pipeline.runPipeline({
      inboxItem: inbox,
      triggerType: 'correction',
      inputContent: effective.content,
      inputContentHash: effective.contentHash,
      correctionId: correction.id,
    });

    return {
      correction_id: correction.id,
      ...result,
    };
  }
}

export class ReprocessService {
  private readonly inboxRepo: InboxItemsRepository;
  private readonly pipeline: ExtractionPipelineService;

  constructor(db: SupabaseClient, extract: ExtractFn) {
    this.inboxRepo = new InboxItemsRepository(db);
    const entitiesRepo = new EntitiesRepository(db);
    const aliasEvidencesRepo = new EntityAliasEvidencesRepository(db);
    const entityUpsert = new EntityUpsertService(entitiesRepo, aliasEvidencesRepo);
    const memoryResolver = new MemoryResolverService(
      entitiesRepo,
      new EntityResolutionRepository(db),
    );
    const persistence = new PersistenceService(
      entitiesRepo,
      new EventsRepository(db),
      new AssertionsRepository(db),
      new TasksRepository(db),
      new ClarificationsRepository(db),
      new InboxItemEntitiesRepository(db),
      entityUpsert,
    );
    this.pipeline = new ExtractionPipelineService(db, extract, memoryResolver, persistence);
  }

  async reprocess(inboxItemId: string) {
    const inbox = await this.inboxRepo.findById(inboxItemId);
    if (!inbox) throw new Error('Inbox item not found');

    const effective = await this.pipeline.getEffectiveInputBuilder().buildEffectiveInput(inboxItemId);

    return this.pipeline.runPipeline({
      inboxItem: inbox,
      triggerType: 'reprocess',
      inputContent: effective.content,
      inputContentHash: effective.contentHash,
    });
  }
}
