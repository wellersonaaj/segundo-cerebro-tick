import type { SupabaseClient } from '@supabase/supabase-js';
import { EXTRACTOR_VERSION } from '../openai/extractor.service.js';
import type { ExtractFn } from '../openai/extractor.service.js';
import { AssertionsRepository } from '../repositories/assertions.repository.js';
import { ClarificationsRepository } from '../repositories/clarifications.repository.js';
import { EntitiesRepository } from '../repositories/entities.repository.js';
import { EntityResolutionRepository } from '../repositories/entity-resolution.repository.js';
import { EventsRepository } from '../repositories/events.repository.js';
import { InboxItemsRepository } from '../repositories/inbox-items.repository.js';
import { TasksRepository } from '../repositories/tasks.repository.js';
import type { ProcessInboxResult, SourceMode } from '../types/domain.js';
import { log } from '../utils/logger.js';
import { applyPostResolutionSanitization } from './extraction-sanitizer.service.js';
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
  private readonly memoryResolver: MemoryResolverService;
  private readonly persistence: PersistenceService;
  private readonly clarificationsRepo: ClarificationsRepository;

  constructor(
    db: SupabaseClient,
    private readonly extract: ExtractFn,
  ) {
    const entitiesRepo = new EntitiesRepository(db);
    this.inboxRepo = new InboxItemsRepository(db);
    this.memoryResolver = new MemoryResolverService(
      entitiesRepo,
      new EntityResolutionRepository(db),
    );
    this.persistence = new PersistenceService(
      entitiesRepo,
      new EventsRepository(db),
      new AssertionsRepository(db),
      new TasksRepository(db),
      new ClarificationsRepository(db),
    );
    this.clarificationsRepo = new ClarificationsRepository(db);
  }

  async process(input: ProcessInboxInput): Promise<ProcessInboxResult> {
    const inboxItem = await this.inboxRepo.create(input);
    log('info', 'inbox_flow', { step: 'inbox_item_saved', inbox_item_id: inboxItem.id });

    await this.inboxRepo.updateStatus(inboxItem.id, 'processing');

    try {
      log('info', 'inbox_flow', {
        step: 'openai_extract_start',
        inbox_item_id: inboxItem.id,
      });

      const output = await this.extract({
        inbox_item_id: inboxItem.id,
        raw_content: input.raw_content,
        source_channel: input.source_channel,
        source_mode: input.source_mode,
        received_at: input.received_at,
        timezone: input.timezone,
      });

      log('info', 'inbox_flow', {
        step: 'openai_extract_done',
        inbox_item_id: inboxItem.id,
      });

      log('info', 'inbox_flow', {
        step: 'memory_resolver_start',
        inbox_item_id: inboxItem.id,
      });

      const resolvedMap = await this.memoryResolver.resolveEntities(
        inboxItem.id,
        output.entities,
        input.raw_content,
      );

      const clarificationFilter = this.memoryResolver.filterClarifications(
        output.clarification_requests,
        resolvedMap,
        resolvedMap.resolutions,
      );

      const sanitizedOutput = applyPostResolutionSanitization(
        output,
        resolvedMap,
        clarificationFilter,
      );

      log('info', 'inbox_flow', {
        step: 'memory_resolver_done',
        inbox_item_id: inboxItem.id,
        resolved_count: resolvedMap.resolutions.length,
        clarifications_remaining: sanitizedOutput.clarification_requests.length,
        review_reasons_remaining: sanitizedOutput.review_reasons.length,
      });

      log('info', 'inbox_flow', {
        step: 'persistence_start',
        inbox_item_id: inboxItem.id,
      });

      const persistResult = await this.persistence.persistExtraction(
        inboxItem.id,
        sanitizedOutput,
        resolvedMap,
        sanitizedOutput.clarification_requests,
        input.received_at,
        input.timezone,
      );

      log('info', 'inbox_flow', {
        step: 'persistence_done',
        inbox_item_id: inboxItem.id,
        entities_created: persistResult.entitiesCreated,
        events_created: persistResult.eventIds.length,
      });

      await this.inboxRepo.updateStatus(inboxItem.id, 'completed', {
        extractor_version: EXTRACTOR_VERSION,
        processing_error: null,
      });

      log('info', 'inbox processed', {
        inbox_item_id: inboxItem.id,
        entities_created: persistResult.entitiesCreated,
      });

      const result: ProcessInboxResult = {
        inbox_item_id: inboxItem.id,
        processing_status: 'completed',
        extractor_version: EXTRACTOR_VERSION,
        entities_created: persistResult.entitiesCreated,
        entities_resolved: persistResult.entitiesResolved,
        events_created: persistResult.eventIds.length,
        assertions_created: persistResult.assertionIds.length,
        tasks_created: persistResult.taskIds.length,
        clarifications_pending: sanitizedOutput.clarification_requests.length,
        clarifications_resolved_automatically: clarificationFilter.autoResolvedIndices.length,
        requires_review: sanitizedOutput.requires_review,
        review_reasons: sanitizedOutput.review_reasons,
        processing_notes: sanitizedOutput.processing_notes,
      };

      log('info', 'inbox_flow', {
        step: 'process_result_ready',
        inbox_item_id: inboxItem.id,
        processing_status: result.processing_status,
      });

      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.inboxRepo.updateStatus(inboxItem.id, 'failed', {
        extractor_version: EXTRACTOR_VERSION,
        processing_error: message,
      });
      log('error', 'inbox processing failed', {
        inbox_item_id: inboxItem.id,
        error: message,
        stack: err instanceof Error ? err.stack : undefined,
      });
      throw err;
    }
  }

  getInboxRepo(): InboxItemsRepository {
    return this.inboxRepo;
  }

  getClarificationsRepo(): ClarificationsRepository {
    return this.clarificationsRepo;
  }
}
