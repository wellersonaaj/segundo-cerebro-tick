import { ClarificationsRepository } from '../repositories/clarifications.repository.js';
import type { ClarificationRequest } from '../types/domain.js';

export class ClarificationService {
  constructor(private readonly repo: ClarificationsRepository) {}

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
    return this.repo.resolve(id, answer);
  }

  async dismiss(id: string): Promise<ClarificationRequest> {
    const item = await this.repo.findById(id);
    if (!item) throw new Error('Clarification not found');
    return this.repo.dismiss(id);
  }
}
