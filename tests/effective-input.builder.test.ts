import { describe, expect, it, vi } from 'vitest';
import { EffectiveInputBuilder } from '../src/services/effective-input.builder.js';

describe('EffectiveInputBuilder', () => {
  it('builds content with corrections in chronological order', async () => {
    const inboxRepo = {
      findById: vi.fn(async () => ({
        id: 'inbox-1',
        raw_content: 'Marcelo participou da reunião',
        source_channel: 'test',
        source_mode: 'conversational',
        received_at: '2026-05-31T10:00:00-03:00',
        timezone: 'America/Sao_Paulo',
        processing_status: 'completed',
        extractor_version: 'extractor-v1.3',
        processing_error: null,
        processed_at: null,
        active_extraction_run_id: 'run-1',
        latest_extraction_run_id: 'run-1',
        created_at: '',
      })),
    };
    const correctionsRepo = {
      listByInboxItem: vi.fn(async () => [
        { id: 'c1', inbox_item_id: 'inbox-1', correction_text: 'Na verdade, Bruno participou', created_at: '2026-06-01T10:00:00Z' },
      ]),
    };

    const customBuilder = new EffectiveInputBuilder({} as never);
    Object.assign(customBuilder, {
      inboxRepo,
      correctionsRepo,
    });

    const result = await customBuilder.buildEffectiveInput('inbox-1');
    expect(result.content).toContain('Marcelo participou da reunião');
    expect(result.content).toContain('[CORREÇÃO] Na verdade, Bruno participou');
    expect(result.correctionIds).toEqual(['c1']);
    expect(result.contentHash).toMatch(/^[a-f0-9]{64}$/);
  });
});
