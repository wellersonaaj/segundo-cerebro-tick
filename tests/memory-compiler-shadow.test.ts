import { afterEach, describe, expect, it, vi } from 'vitest';
import { resetEnvCache } from '../src/config/env.js';
import { ExtractionPipelineService } from '../src/services/extraction-pipeline.service.js';
import type { InboxItem } from '../src/types/domain.js';

const inboxItem: InboxItem = {
  id: 'inbox-1',
  raw_content: 'test content',
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

const extractOutput = {
  schema_version: '1.3',
  inbox_item_id: 'inbox-1',
  events: [],
  entities: [],
  assertions: [],
  tasks: [],
  clarification_requests: [],
  requires_review: false,
  review_reasons: [],
  processing_notes: [],
};

function buildPipeline(compileThrows = false) {
  const promoteExtractionRun = vi.fn(async () => ({
    inbox_item_id: 'inbox-1',
    run_id: 'run-1',
    stale_run: false,
    has_active_memory: true,
  }));

  const persistCandidates = vi.fn(async () => ({
    entitiesCreated: 0,
    entitiesResolved: 0,
    eventIds: [],
    assertionIds: [],
    taskIds: [],
    clarificationIds: [],
  }));

  const pipeline = new ExtractionPipelineService(
    { rpc: vi.fn() } as never,
    vi.fn(async () => extractOutput),
    {
      resolveEntities: vi.fn(async () => ({ byExtractedName: new Map(), resolutions: [] })),
      filterClarifications: vi.fn((c) => ({ remaining: c, autoResolvedIndices: [] })),
    } as never,
    { persistCandidates } as never,
  );

  Object.assign(pipeline, {
    runRpc: {
      startExtractionRun: vi.fn(async () => ({ run_id: 'run-1', inbox_item_id: 'inbox-1' })),
      promoteExtractionRun,
      failExtractionRun: vi.fn(),
    },
    runsRepo: { saveRawOutput: vi.fn(), markValidated: vi.fn() },
    memoryCompiler: {
      compile: compileThrows
        ? vi.fn(() => {
            throw new Error('compiler boom');
          })
        : vi.fn(() => ({
            compilerVersion: 'memory-compiler-v1',
            entities: [],
            aliases: [],
            events: [],
            assertions: [],
            tasks: [],
            clarificationCandidates: [],
            compilerNotes: [],
            droppedArtifacts: [],
            flags: {
              negatedTerms: [],
              explicitAliasLabels: [],
              blockedClarificationRefs: [],
              weakTopicsPreserved: [],
            },
          })),
    },
    clarificationManager: {
      recommend: vi.fn(() => []),
    },
  });

  return { pipeline, promoteExtractionRun, persistCandidates };
}

describe('Memory compiler shadow mode', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    resetEnvCache();
  });

  it('does not run compiler when MEMORY_COMPILER_MODE=off', async () => {
    process.env.MEMORY_COMPILER_MODE = 'off';
    resetEnvCache();
    const { pipeline, promoteExtractionRun } = buildPipeline();
    await pipeline.runPipeline({
      inboxItem,
      triggerType: 'initial',
      inputContent: 'test',
      inputContentHash: 'abc',
    });
    expect(promoteExtractionRun).toHaveBeenCalled();
    expect(pipeline['memoryCompiler'].compile).not.toHaveBeenCalled();
  });

  it('runs compiler in shadow without changing persistence', async () => {
    process.env.MEMORY_COMPILER_MODE = 'shadow';
    resetEnvCache();
    const { pipeline, promoteExtractionRun, persistCandidates } = buildPipeline();
    await pipeline.runPipeline({
      inboxItem,
      triggerType: 'initial',
      inputContent: 'test',
      inputContentHash: 'abc',
    });
    expect(pipeline['memoryCompiler'].compile).toHaveBeenCalled();
    expect(persistCandidates).toHaveBeenCalled();
    expect(promoteExtractionRun).toHaveBeenCalled();
  });

  it('continues productive pipeline when compiler throws', async () => {
    process.env.MEMORY_COMPILER_MODE = 'shadow';
    resetEnvCache();
    const { pipeline, promoteExtractionRun } = buildPipeline(true);
    await pipeline.runPipeline({
      inboxItem,
      triggerType: 'initial',
      inputContent: 'test',
      inputContentHash: 'abc',
    });
    expect(promoteExtractionRun).toHaveBeenCalled();
  });
});

describe('MEMORY_COMPILER_MODE=enforce', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    resetEnvCache();
  });

  it('throws MEMORY_COMPILER_ENFORCE_NOT_IMPLEMENTED on loadEnv', async () => {
    process.env.MEMORY_COMPILER_MODE = 'enforce';
    resetEnvCache();
    const { loadEnv } = await import('../src/config/env.js');
    expect(() => loadEnv()).toThrow('MEMORY_COMPILER_ENFORCE_NOT_IMPLEMENTED');
  });
});
