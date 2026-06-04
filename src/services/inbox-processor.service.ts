import type { SupabaseClient } from '@supabase/supabase-js';
import type { ExtractFn } from '../openai/extractor.service.js';
import { AssertionsRepository } from '../repositories/assertions.repository.js';
import { ClarificationsRepository } from '../repositories/clarifications.repository.js';
import { EntityAliasEvidencesRepository } from '../repositories/entity-alias-evidences.repository.js';
import { EntityResolutionRepository } from '../repositories/entity-resolution.repository.js';
import { EntitiesRepository } from '../repositories/entities.repository.js';
import { EventsRepository } from '../repositories/events.repository.js';
import { InboxItemEntitiesRepository } from '../repositories/inbox-item-entities.repository.js';
import { InboxItemsRepository } from '../repositories/inbox-items.repository.js';
import { TasksRepository } from '../repositories/tasks.repository.js';
import type { ProcessInboxResult, SourceMode } from '../types/domain.js';
import { log } from '../utils/logger.js';
import { EntityUpsertService } from './entity-upsert.service.js';
import { ExtractionPipelineService } from './extraction-pipeline.service.js';
import { MemoryResolverService } from './memory-resolver.service.js';
import { PersistenceService } from './persistence.service.js';

export interface ProcessInboxInput {
  raw_content: string;
  source_channel: string;
  source_mode: SourceMode;
  received_at: string;
  timezone: string;
}

export class InboxProcessorService {
  private readonly inboxRepo: InboxItemsRepository;
  private readonly pipeline: ExtractionPipelineService;
  private readonly clarificationsRepo: ClarificationsRepository;

  constructor(
    db: SupabaseClient,
    extract: ExtractFn,
  ) {
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
    this.inboxRepo = new InboxItemsRepository(db);
    this.clarificationsRepo = new ClarificationsRepository(db);
  }

  async process(input: ProcessInboxInput): Promise<ProcessInboxResult> {
    const inboxItem = await this.inboxRepo.create(input);
    log('info', 'inbox_flow', { step: 'inbox_item_saved', inbox_item_id: inboxItem.id });

    return this.pipeline.runPipeline({
      inboxItem,
      triggerType: 'initial',
      inputContent: input.raw_content,
      inputContentHash: await hashContent(input.raw_content),
      sourceChannel: input.source_channel,
      sourceMode: input.source_mode,
      receivedAt: input.received_at,
      timezone: input.timezone,
    });
  }

  getInboxRepo(): InboxItemsRepository {
    return this.inboxRepo;
  }

  getClarificationsRepo(): ClarificationsRepository {
    return this.clarificationsRepo;
  }

  getPipeline(): ExtractionPipelineService {
    return this.pipeline;
  }
}

async function hashContent(content: string): Promise<string> {
  const { createHash } = await import('node:crypto');
  return createHash('sha256').update(content, 'utf8').digest('hex');
}
