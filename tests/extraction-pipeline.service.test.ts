import { describe, expect, it, vi } from 'vitest';
import { ExtractionPipelineService } from '../src/services/extraction-pipeline.service.js';
import type { InboxItem } from '../src/types/domain.js';

const inboxItem: InboxItem = {
  id: 'inbox-1',
  raw_content: 'test',
  source_channel: 'test',
  source_mode: 'conversational',
  received_at: '2026-05-31T10:00:00-03:00',
  timezone: 'America/Sao_Paulo',
  processing_status: 'pending',
  extractor_version: null,
  processing_error: null,
  processed_at: null,
  active_extraction_run_id: null,
  latest_extraction_run_id: null,
  created_at: '',
};

describe('ExtractionPipelineService', () => {
  it('calls fail RPC and does not promote when extract throws', async () => {
    const failExtractionRun = vi.fn(async () => ({
      inbox_item_id: 'inbox-1',
      run_id: 'run-1',
      stale_run: false,
      has_active_memory: false,
    }));
    const promoteExtractionRun = vi.fn();

    const db = {
      rpc: vi.fn((name: string) => {
        if (name === 'start_extraction_run') {
          return { data: { run_id: 'run-1', inbox_item_id: 'inbox-1' }, error: null };
        }
        return { data: null, error: null };
      }),
    };

    const pipeline = new ExtractionPipelineService(
      db as never,
      vi.fn(async () => {
        throw new Error('extract failed');
      }),
      { resolveEntities: vi.fn(), filterClarifications: vi.fn() } as never,
      {} as never,
    );

    Object.assign(pipeline, {
      runRpc: { startExtractionRun: vi.fn(async () => ({ run_id: 'run-1', inbox_item_id: 'inbox-1' })), promoteExtractionRun, failExtractionRun },
      runsRepo: { saveRawOutput: vi.fn(), markValidated: vi.fn() },
    });

    await expect(
      pipeline.runPipeline({
        inboxItem,
        triggerType: 'initial',
        inputContent: 'test',
        inputContentHash: 'abc',
      }),
    ).rejects.toThrow('extract failed');

    expect(failExtractionRun).toHaveBeenCalled();
    expect(promoteExtractionRun).not.toHaveBeenCalled();
  });
});
