import type { SupabaseClient } from '@supabase/supabase-js';
import { CorrectionsRepository } from '../repositories/corrections.repository.js';
import { InboxItemsRepository } from '../repositories/inbox-items.repository.js';
import { AssertionsV2Repository } from '../repositories/v2/assertions-v2.repository.js';
import { ExtractionPipelineV14Service } from './extraction-pipeline-v14.service.js';
import { createOpenAiExtractorV14 } from '../openai/extractor-v1.4.service.js';

export class CorrectionService {
  private readonly inboxRepo: InboxItemsRepository;
  private readonly correctionsRepo: CorrectionsRepository;
  private readonly assertionsRepo: AssertionsV2Repository;
  private readonly pipeline: ExtractionPipelineV14Service;

  constructor(db: SupabaseClient) {
    this.inboxRepo = new InboxItemsRepository(db);
    this.correctionsRepo = new CorrectionsRepository(db);
    this.assertionsRepo = new AssertionsV2Repository(db);
    this.pipeline = new ExtractionPipelineV14Service(db, createOpenAiExtractorV14());
  }

  async applyCorrection(inboxItemId: string, correctionText: string) {
    const inbox = await this.inboxRepo.findById(inboxItemId);
    if (!inbox) throw new Error('Inbox item not found');

    const correction = await this.correctionsRepo.create(inboxItemId, correctionText);

    const result = await this.pipeline.runWithTrigger(inbox, 'correction', {
      correctionId: correction.id,
    });

    if (result.extraction_run_id) {
      await this.assertionsRepo.ensureCorrectionAssertionsCurrent(
        result.extraction_run_id,
        correction.id,
      );
    }

    return {
      correction_id: correction.id,
      ...result,
    };
  }
}

export class ReprocessService {
  private readonly inboxRepo: InboxItemsRepository;
  private readonly pipeline: ExtractionPipelineV14Service;

  constructor(db: SupabaseClient) {
    this.inboxRepo = new InboxItemsRepository(db);
    this.pipeline = new ExtractionPipelineV14Service(db, createOpenAiExtractorV14());
  }

  async reprocess(inboxItemId: string) {
    const inbox = await this.inboxRepo.findById(inboxItemId);
    if (!inbox) throw new Error('Inbox item not found');

    return this.pipeline.runWithTrigger(inbox, 'reprocess');
  }
}
