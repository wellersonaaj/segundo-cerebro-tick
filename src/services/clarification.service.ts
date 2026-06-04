import { ClarificationsRepository } from '../repositories/clarifications.repository.js';
import type { ClarificationRequest } from '../types/domain.js';
import { expandClarificationAnswerFromOptions } from './confirmation-clarification-policy.js';
import type { InboxItemProcessPipeline } from './inbox-item-process.service.js';

export interface ResolveAndApplyResult {
  clarification: ClarificationRequest;
  inbox_item_id: string;
  processing_status: 'completed' | 'failed';
  extraction_run_id?: string;
  needs_clarification?: boolean;
}

export class ClarificationService {
  constructor(
    private readonly repo: ClarificationsRepository,
    private readonly v14Pipeline: InboxItemProcessPipeline | null = null,
  ) {}

  async list(status?: ClarificationRequest['status'], limit = 50): Promise<ClarificationRequest[]> {
    return this.repo.list(status, limit);
  }

  async listPending(limit = 50): Promise<ClarificationRequest[]> {
    return this.repo.list('pending', limit);
  }

  async resolve(id: string, answer: string): Promise<ClarificationRequest> {
    const item = await this.repo.findById(id);
    if (!item) throw new Error('Clarification not found');
    if (item.status !== 'pending') {
      throw new Error(`Clarification is not pending (status=${item.status})`);
    }
    const normalized = expandClarificationAnswerFromOptions(answer, item.suggested_answers ?? []);
    return this.repo.resolve(id, normalized);
  }

  async resolveAndApply(
    id: string,
    answer: string,
    options: { apply?: boolean } = {},
  ): Promise<ResolveAndApplyResult> {
    const apply = options.apply !== false;
    const item = await this.repo.findById(id);
    if (!item) throw new Error('Clarification not found');
    const clarification = await this.resolve(id, answer);
    if (!apply || !this.v14Pipeline) {
      return {
        clarification,
        inbox_item_id: clarification.inbox_item_id,
        processing_status: 'completed',
      };
    }

    const pipelineResult = await this.v14Pipeline.runReprocess(clarification.inbox_item_id);
    return {
      clarification,
      inbox_item_id: clarification.inbox_item_id,
      processing_status: pipelineResult.processing_status,
      extraction_run_id: pipelineResult.extraction_run_id,
      needs_clarification: pipelineResult.needs_clarification,
    };
  }

  async dismiss(id: string): Promise<ClarificationRequest> {
    const item = await this.repo.findById(id);
    if (!item) throw new Error('Clarification not found');
    return this.repo.dismiss(id);
  }
}
