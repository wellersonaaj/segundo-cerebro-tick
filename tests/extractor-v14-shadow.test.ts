import { afterEach, describe, expect, it, vi } from 'vitest';
import { resetEnvCache } from '../src/config/env.js';
import { ExtractionPipelineService } from '../src/services/extraction-pipeline.service.js';
import { ExtractorV14ShadowService } from '../src/services/extractor-v14-shadow.service.js';
import { MemoryCompilerV2Service } from '../src/services/memory-compiler-v2.service.js';
import type { InboxItem } from '../src/types/domain.js';
import type { ExtractorOutputV14 } from '../src/openai/extractor-v1.4.types.js';
import { buildEffectiveInputWithSourceBlocks } from '../src/utils/source-blocks.js';
import { buildExtractorV14ShadowSafeLog } from '../src/services/extractor-v14-shadow-log.js';
import type { CompiledMemoryV2 } from '../src/types/memory-compiler-v2.js';

const inboxItem: InboxItem = {
  id: 'inbox-1',
  raw_content: 'Chris participou da reunião.',
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

function buildPipeline(shadow?: ExtractorV14ShadowService) {
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
    shadow,
  );

  Object.assign(pipeline, {
    runRpc: {
      startExtractionRun: vi.fn(async () => ({ run_id: 'run-1', inbox_item_id: 'inbox-1' })),
      promoteExtractionRun,
      failExtractionRun: vi.fn(),
    },
    runsRepo: { saveRawOutput: vi.fn(), markValidated: vi.fn() },
    memoryCompiler: {
      compile: vi.fn(() => ({
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
    clarificationManager: { recommend: vi.fn(() => []) },
  });

  return { pipeline, promoteExtractionRun, persistCandidates };
}

describe('Extractor v1.4 shadow integration', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    resetEnvCache();
    vi.restoreAllMocks();
  });

  it('does not run v1.4 shadow when EXTRACTOR_V14_SHADOW_ENABLED=false', async () => {
    process.env.EXTRACTOR_V14_SHADOW_ENABLED = 'false';
    resetEnvCache();
    const runShadow = vi.fn();
    const shadow = { runShadow } as unknown as ExtractorV14ShadowService;
    const { pipeline, promoteExtractionRun } = buildPipeline(shadow);
    await pipeline.runPipeline({
      inboxItem,
      triggerType: 'initial',
      inputContent: 'test',
      inputContentHash: 'abc',
    });
    expect(runShadow).not.toHaveBeenCalled();
    expect(promoteExtractionRun).toHaveBeenCalled();
  });

  it('runs v1.4 shadow without blocking persistence when enabled', async () => {
    process.env.EXTRACTOR_V14_SHADOW_ENABLED = 'true';
    resetEnvCache();
    const runShadow = vi.fn(async () => ({
      inbox_item_id: 'inbox-1',
      extraction_run_id: 'run-1',
      input_hash: 'deadbeef',
      extractor_v14_schema_version: '1.4',
      compiled_decision: 'accepted',
      compiled_confidence: 1,
      duration_ms: 10,
      counts: {
        entity_mentions: 0,
        aliases: 0,
        events: 0,
        assertions: 0,
        tasks: 0,
        clarification_candidates: 0,
        dropped_artifacts: 0,
        recommended_clarifications: 0,
      },
      dropped_reasons: {},
    }));
    const shadow = { runShadow } as unknown as ExtractorV14ShadowService;
    const { pipeline, promoteExtractionRun, persistCandidates } = buildPipeline(shadow);
    await pipeline.runPipeline({
      inboxItem,
      triggerType: 'initial',
      inputContent: 'test',
      inputContentHash: 'abc',
    });
    expect(runShadow).toHaveBeenCalled();
    expect(persistCandidates).toHaveBeenCalled();
    expect(promoteExtractionRun).toHaveBeenCalled();
  });

  it('continues v1.3 pipeline when v1.4 shadow throws', async () => {
    process.env.EXTRACTOR_V14_SHADOW_ENABLED = 'true';
    resetEnvCache();
    const runShadow = vi.fn(async () => {
      throw new Error('shadow extractor boom');
    });
    const shadow = { runShadow } as unknown as ExtractorV14ShadowService;
    const { pipeline, promoteExtractionRun } = buildPipeline(shadow);
    await pipeline.runPipeline({
      inboxItem,
      triggerType: 'initial',
      inputContent: 'test',
      inputContentHash: 'abc',
    });
    expect(promoteExtractionRun).toHaveBeenCalled();
  });

  it('shadow safe log does not include raw_content or source_excerpt', () => {
    const sensitive = 'SECRET_RAW_CONTENT_UNIQUE_TOKEN_xyz';
    const compiled = {
      decision: { status: 'accepted', confidence: 1, reasons: [] },
      resolvedEntities: [],
      aliases: [],
      events: [],
      assertions: [],
      tasks: [],
      clarificationCandidates: [],
      droppedArtifacts: [],
      flags: {
        negatedReferences: [],
        supersededReferences: [],
        presentSourceBlocks: [],
        contextResolvedTasks: [],
        contextAmbiguousTasks: [],
      },
      taskSignalResolutions: [],
      contextResolutionEvidence: [],
      compilerVersion: 'memory-compiler-v2',
      compilerNotes: [],
    } as CompiledMemoryV2;

    const safe = buildExtractorV14ShadowSafeLog({
      inboxItemId: 'inbox-1',
      runId: 'run-1',
      effectiveInput: sensitive,
      compiled,
      recommendedClarificationCount: 0,
      durationMs: 1,
    });

    const serialized = JSON.stringify(safe);
    expect(serialized).not.toContain(sensitive);
    expect(serialized).not.toContain('source_excerpt');
    expect(serialized).not.toContain('raw_content');
    expect(safe.input_hash).toHaveLength(16);
  });
});

describe('SOURCE_BLOCK invalid → compiler v2 rejected', () => {
  it('rejects when source_block_reference is missing from effective input', () => {
    const effectiveInput = buildEffectiveInputWithSourceBlocks({
      raw_content: 'texto curto',
    });
    const output: ExtractorOutputV14 = {
      schema_version: '1.4',
      entity_mentions: [],
      aliases: [],
      events: [],
      assertions: [
        {
          assertion_kind: 'fact',
          subject_reference: 'Alex',
          predicate: 'participou',
          object_reference: null,
          value_text: null,
          related_entity_references: [],
          source_excerpt: 'Alex',
          source_block_reference: '[SOURCE_BLOCK:correction:00000000-0000-0000-0000-000000000099]',
          confidence: 0.9,
        },
      ],
      task_signals: [],
      correction_signals: [],
      clarification_candidates: [],
      review_hints: [],
      extraction_notes: [],
    };
    const compiler = new MemoryCompilerV2Service();
    const compiled = compiler.compile({
      extractorOutput: output,
      effectiveInput,
      resolverResult: { references: [], byReferenceText: new Map() },
    });
    expect(compiled.decision.status).toBe('rejected');
  });
});

describe('EXTRACTOR_RUNTIME_VERSION', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    resetEnvCache();
  });

  it('throws EXTRACTOR_V14_RUNTIME_NOT_ENABLED for v1.4', async () => {
    process.env.EXTRACTOR_RUNTIME_VERSION = 'v1.4';
    resetEnvCache();
    const { loadEnv } = await import('../src/config/env.js');
    expect(() => loadEnv()).toThrow('EXTRACTOR_V14_RUNTIME_NOT_ENABLED');
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
