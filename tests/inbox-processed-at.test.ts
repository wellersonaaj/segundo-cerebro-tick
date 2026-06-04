import { describe, expect, it, vi } from 'vitest';
import { InboxItemsRepository } from '../src/repositories/inbox-items.repository.js';

describe('InboxItemsRepository.updateStatus processed_at', () => {
  it('sets processed_at on completed and clears processing_error', async () => {
    const update = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) });
    const db = { from: vi.fn(() => ({ update })) } as never;
    const repo = new InboxItemsRepository(db);

    await repo.updateStatus('id-1', 'completed', {
      extractor_version: 'extractor-v1.3',
      processing_error: null,
    });

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        processing_status: 'completed',
        processing_error: null,
        processed_at: expect.any(String),
        extractor_version: 'extractor-v1.3',
      }),
    );
  });

  it('clears processed_at and processing_error on processing', async () => {
    const update = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) });
    const db = { from: vi.fn(() => ({ update })) } as never;
    const repo = new InboxItemsRepository(db);

    await repo.updateStatus('id-1', 'processing');

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        processing_status: 'processing',
        processed_at: null,
        processing_error: null,
      }),
    );
  });

  it('keeps processed_at null and stores processing_error on failed', async () => {
    const update = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) });
    const db = { from: vi.fn(() => ({ update })) } as never;
    const repo = new InboxItemsRepository(db);

    await repo.updateStatus('id-1', 'failed', {
      extractor_version: 'extractor-v1.3',
      processing_error: 'resolver failed',
    });

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        processing_status: 'failed',
        processed_at: null,
        processing_error: 'resolver failed',
      }),
    );
  });
});
