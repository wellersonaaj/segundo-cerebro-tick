import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { CorrectionsRepository } from '../repositories/corrections.repository.js';
import { InboxItemsRepository } from '../repositories/inbox-items.repository.js';
import { parseCorrectionBlocks } from '../utils/correction-blocks.js';
import { buildEffectiveInputWithSourceBlocks } from '../utils/source-blocks.js';

export interface EffectiveInput {
  content: string;
  contentHash: string;
  correctionIds: string[];
}

export class EffectiveInputBuilder {
  private readonly inboxRepo: InboxItemsRepository;
  private readonly correctionsRepo: CorrectionsRepository;

  constructor(db: SupabaseClient) {
    this.inboxRepo = new InboxItemsRepository(db);
    this.correctionsRepo = new CorrectionsRepository(db);
  }

  async buildEffectiveInput(inboxItemId: string): Promise<EffectiveInput> {
    const inbox = await this.inboxRepo.findById(inboxItemId);
    if (!inbox) throw new Error('Inbox item not found');

    const corrections = await this.correctionsRepo.listByInboxItem(inboxItemId);
    const joined = [
      inbox.raw_content,
      ...corrections.map((c) => `[CORREÇÃO] ${c.correction_text}`),
    ].join('\n\n');
    const { effectiveContent } = parseCorrectionBlocks(joined);
    const contentHash = createHash('sha256').update(effectiveContent, 'utf8').digest('hex');

    return {
      content: effectiveContent,
      contentHash,
      correctionIds: corrections.map((c) => c.id),
    };
  }

  /** Formato v1.4 com SOURCE_BLOCK (não usado pelo pipeline v1.3 produtivo). */
  async buildEffectiveInputWithSourceBlocks(inboxItemId: string): Promise<EffectiveInput> {
    const inbox = await this.inboxRepo.findById(inboxItemId);
    if (!inbox) throw new Error('Inbox item not found');

    const corrections = await this.correctionsRepo.listByInboxItem(inboxItemId);
    const content = buildEffectiveInputWithSourceBlocks({
      raw_content: inbox.raw_content,
      corrections: corrections.map((c) => ({
        id: c.id,
        correction_text: c.correction_text,
      })),
    });
    const contentHash = createHash('sha256').update(content, 'utf8').digest('hex');

    return {
      content,
      contentHash,
      correctionIds: corrections.map((c) => c.id),
    };
  }
}
