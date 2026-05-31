import type { SupabaseClient } from '@supabase/supabase-js';
import type { ExtractFn } from '../openai/extractor.service.js';
import { AssertionsRepository } from '../repositories/assertions.repository.js';
import { CorrectionsRepository } from '../repositories/corrections.repository.js';
import { EntitiesRepository } from '../repositories/entities.repository.js';
import { EntityResolutionRepository } from '../repositories/entity-resolution.repository.js';
import { EventsRepository } from '../repositories/events.repository.js';
import { InboxItemsRepository } from '../repositories/inbox-items.repository.js';
import { TasksRepository } from '../repositories/tasks.repository.js';
import { ClarificationsRepository } from '../repositories/clarifications.repository.js';
import { EXTRACTOR_VERSION } from '../openai/extractor.service.js';
import { applyPostResolutionSanitization } from './extraction-sanitizer.service.js';
import { MemoryResolverService } from './memory-resolver.service.js';
import { PersistenceService } from './persistence.service.js';

/**
 * Correction strategy (documented):
 * 1. Preserve original inbox_item.raw_content unchanged.
 * 2. Append correction to corrections table.
 * 3. Mark prior events/assertions/open-tasks from same inbox_item as superseded.
 * 4. Re-run extractor with augmented context: original + all corrections.
 * 5. Persist new records linked to correction_id; queries filter status=active / record_status=active.
 */
export class CorrectionService {
  private readonly inboxRepo: InboxItemsRepository;
  private readonly correctionsRepo: CorrectionsRepository;
  private readonly eventsRepo: EventsRepository;
  private readonly assertionsRepo: AssertionsRepository;
  private readonly tasksRepo: TasksRepository;
  private readonly memoryResolver: MemoryResolverService;
  private readonly persistence: PersistenceService;

  constructor(db: SupabaseClient, private readonly extract: ExtractFn) {
    this.inboxRepo = new InboxItemsRepository(db);
    this.correctionsRepo = new CorrectionsRepository(db);
    this.eventsRepo = new EventsRepository(db);
    this.assertionsRepo = new AssertionsRepository(db);
    this.tasksRepo = new TasksRepository(db);
    const entitiesRepo = new EntitiesRepository(db);
    this.memoryResolver = new MemoryResolverService(
      entitiesRepo,
      new EntityResolutionRepository(db),
    );
    this.persistence = new PersistenceService(
      entitiesRepo,
      this.eventsRepo,
      this.assertionsRepo,
      this.tasksRepo,
      new ClarificationsRepository(db),
    );
  }

  async applyCorrection(inboxItemId: string, correctionText: string) {
    const inbox = await this.inboxRepo.findById(inboxItemId);
    if (!inbox) throw new Error('Inbox item not found');

    const correction = await this.correctionsRepo.create(inboxItemId, correctionText);
    await this.eventsRepo.supersedeByInboxItem(inboxItemId, correction.id);
    await this.assertionsRepo.supersedeByInboxItem(inboxItemId, correction.id);
    await this.tasksRepo.supersedeByInboxItem(inboxItemId, correction.id);

    const prior = await this.correctionsRepo.listByInboxItem(inboxItemId);
    const augmentedContent = [
      inbox.raw_content,
      ...prior.map((c) => `[CORREÇÃO] ${c.correction_text}`),
    ].join('\n\n');

    await this.inboxRepo.updateStatus(inboxItemId, 'processing');

    const output = await this.extract({
      inbox_item_id: inboxItemId,
      raw_content: augmentedContent,
      source_channel: inbox.source_channel,
      source_mode: inbox.source_mode,
      received_at: inbox.received_at,
      timezone: inbox.timezone,
    });

    const resolvedMap = await this.memoryResolver.resolveEntities(
      inboxItemId,
      output.entities,
      augmentedContent,
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

    const result = await this.persistence.persistExtraction(
      inboxItemId,
      sanitizedOutput,
      resolvedMap,
      sanitizedOutput.clarification_requests,
      inbox.received_at,
      inbox.timezone,
      correction.id,
    );

    await this.inboxRepo.updateStatus(inboxItemId, 'completed', {
      extractor_version: EXTRACTOR_VERSION,
      processing_error: null,
    });

    return {
      correction_id: correction.id,
      inbox_item_id: inboxItemId,
      ...result,
    };
  }
}
