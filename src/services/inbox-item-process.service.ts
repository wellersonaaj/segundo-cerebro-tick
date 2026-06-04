import type { InboxItemsRepository } from '../repositories/inbox-items.repository.js';
import type { InboxItem } from '../types/domain.js';
import { isValidUuid } from '../utils/uuid.js';

export type InboxItemProcessErrorCode =
  | 'INVALID_UUID'
  | 'NOT_FOUND'
  | 'ALREADY_PROCESSED'
  | 'ALREADY_PROCESSING'
  | 'RUN_ALREADY_IN_PROGRESS'
  | 'PIPELINE_NOT_WIRED';

export class InboxItemProcessError extends Error {
  constructor(
    readonly code: InboxItemProcessErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'InboxItemProcessError';
  }
}

export interface InboxItemProcessSuccess {
  ok: true;
  inbox_item_id: string;
  processing_status: 'completed' | 'failed';
  already_processed?: boolean;
  extraction_run_id?: string;
  extractor_version?: string | null;
  needs_clarification?: boolean;
}

/** Wired in Checkpoint B — v1.4-only extraction pipeline. */
export interface InboxItemProcessPipeline {
  run(inboxItem: InboxItem): Promise<Omit<InboxItemProcessSuccess, 'ok'>>;
  runReprocess(inboxItemId: string): Promise<Omit<InboxItemProcessSuccess, 'ok'>>;
}

export class InboxItemProcessService {
  constructor(
    private readonly inboxRepo: InboxItemsRepository,
    private readonly pipeline: InboxItemProcessPipeline | null = null,
  ) {}

  async processById(id: string): Promise<InboxItemProcessSuccess> {
    if (!isValidUuid(id)) {
      throw new InboxItemProcessError('INVALID_UUID', 'Invalid inbox item id');
    }

    const inboxItem = await this.inboxRepo.findById(id);
    if (!inboxItem) {
      throw new InboxItemProcessError('NOT_FOUND', 'Inbox item not found');
    }

    if (inboxItem.processing_status === 'completed') {
      return {
        ok: true,
        inbox_item_id: inboxItem.id,
        processing_status: 'completed',
        already_processed: true,
        extraction_run_id: inboxItem.active_extraction_run_id ?? undefined,
        extractor_version: inboxItem.extractor_version,
      };
    }

    if (inboxItem.processing_status === 'processing') {
      throw new InboxItemProcessError('ALREADY_PROCESSING', 'Inbox item is already processing', {
        inbox_item_id: inboxItem.id,
      });
    }

    if (!this.pipeline) {
      throw new InboxItemProcessError(
        'PIPELINE_NOT_WIRED',
        'Extraction pipeline v1.4 is not wired yet',
        { inbox_item_id: inboxItem.id },
      );
    }

    try {
      const result = await this.pipeline.run(inboxItem);
      return { ok: true, ...result };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('RUN_ALREADY_IN_PROGRESS')) {
        throw new InboxItemProcessError('RUN_ALREADY_IN_PROGRESS', message, {
          inbox_item_id: inboxItem.id,
        });
      }
      throw err;
    }
  }

  async reprocessById(id: string): Promise<InboxItemProcessSuccess> {
    if (!isValidUuid(id)) {
      throw new InboxItemProcessError('INVALID_UUID', 'Invalid inbox item id');
    }
    if (!this.pipeline) {
      throw new InboxItemProcessError('PIPELINE_NOT_WIRED', 'Extraction pipeline v1.4 is not wired');
    }
    const inboxItem = await this.inboxRepo.findById(id);
    if (!inboxItem) {
      throw new InboxItemProcessError('NOT_FOUND', 'Inbox item not found');
    }
    const result = await this.pipeline.runReprocess(id);
    return { ok: true, ...result };
  }
}
