import { afterEach, describe, expect, it, vi } from 'vitest';
import { resetEnvCache } from '../src/config/env.js';
import { EXTRACTOR_V14_VERSION } from '../src/openai/extractor-v1.4.prompt.js';
import type { ExtractV14Fn } from '../src/openai/extractor-v1.4.service.js';
import { EMPTY_INGESTION_CONTEXT } from '../src/types/ingestion-context.js';
import { ExtractionPipelineV14Service } from '../src/services/extraction-pipeline-v14.service.js';
import type { ExtractorV14CompileResult } from '../src/services/extractor-v14-compile.service.js';
import { ExtractorV14CompileService } from '../src/services/extractor-v14-compile.service.js';
import { DbReferenceResolverService } from '../src/services/db-reference-resolver.service.js';
import { CorrectionsRepository } from '../src/repositories/corrections.repository.js';
import { ClarificationsRepository } from '../src/repositories/clarifications.repository.js';
import type { InboxItem } from '../src/types/domain.js';
import type { CompiledMemoryV2 } from '../src/types/memory-compiler-v2.js';
import { createMockExtractV14, loadExtractorV14Fixture } from './helpers/mock-extractor-v14.js';

const INBOX_ID = 'f0000000-0000-4000-8000-000000000099';
const RUN_ID = 'a0000000-0000-4000-8000-000000000001';

const inboxItem: InboxItem = {
  id: INBOX_ID,
  raw_content: 'Enviar contrato ao fornecedor.',
  source_channel: 'telegram',
  source_mode: 'conversational',
  received_at: '2026-06-01T10:00:00-03:00',
  timezone: 'America/Sao_Paulo',
  processing_status: 'pending',
  extractor_version: null,
  processing_error: null,
  processed_at: null,
  active_extraction_run_id: null,
  latest_extraction_run_id: null,
  created_at: '2026-06-01T10:00:00Z',
};

function baseCompiled(overrides: Partial<CompiledMemoryV2> = {}): CompiledMemoryV2 {
  return {
    compilerVersion: 'memory-compiler-v2',
    resolvedEntities: [],
    aliases: [],
    events: [],
    assertions: [],
    tasks: [],
    clarificationCandidates: [],
    reviewHints: [],
    droppedArtifacts: [],
    compilerNotes: [],
    decision: { status: 'accepted', reasons: ['ok'], confidence: 0.9 },
    flags: {
      negatedReferences: [],
      supersededReferences: [],
      presentSourceBlocks: [],
      contextResolvedTasks: [],
      contextAmbiguousTasks: [],
    },
    taskSignalResolutions: [],
    contextResolutionEvidence: [],
    ...overrides,
  };
}

function baseCompileResult(
  overrides: Partial<ExtractorV14CompileResult> = {},
): ExtractorV14CompileResult {
  const output = loadExtractorV14Fixture();
  const compiled = overrides.compiled ?? baseCompiled();
  return {
    output,
    effectiveInput: inboxItem.raw_content,
    resolverResult: { references: [], byReferenceText: new Map() },
    taskSignalResolutions: [],
    compactContext: EMPTY_INGESTION_CONTEXT,
    temporalAnchor: { receivedAt: inboxItem.received_at, timezone: inboxItem.timezone },
    compiled,
    clarificationMateriality: { blocking: [], nonBlocking: [], discarded: [] },
    finalDecision: {
      status: 'accepted',
      blockingCount: 0,
      nonBlockingCount: 0,
      discardedCount: 0,
    },
    ...overrides,
  };
}

function buildPipeline(compileResult: ExtractorV14CompileResult, extractV14?: ExtractV14Fn) {
  const extractV14Fn = extractV14 ?? createMockExtractV14(compileResult.output);
  const extractV14Spy = vi.fn(extractV14Fn);

  const runRpc = {
    startExtractionRun: vi.fn(async () => ({ run_id: RUN_ID, inbox_item_id: INBOX_ID })),
    promoteExtractionRun: vi.fn(async () => ({
      inbox_item_id: INBOX_ID,
      run_id: RUN_ID,
      has_active_memory: true,
    })),
    failExtractionRun: vi.fn(async () => ({
      inbox_item_id: INBOX_ID,
      run_id: RUN_ID,
      processing_status: 'failed',
      has_active_memory: false,
      stale_run: false,
    })),
  };

  const runsV2Repo = {
    saveRawOutput: vi.fn(async () => undefined),
    saveCompiledOutput: vi.fn(async () => undefined),
    markValidated: vi.fn(async () => undefined),
  };

  const persistCandidates = vi.fn(async () => ({
    entityIds: [],
    eventIds: [],
    assertionIds: [],
    taskMutationIds: [],
    clarificationIds: [],
    aliasEvidenceIds: [],
    inboxItemEntityIds: [],
  }));

  const compileService = {
    buildEffectiveInput: vi.fn(async () => inboxItem.raw_content),
    compileFromInbox: vi.fn(async () => compileResult),
  } as unknown as ExtractorV14CompileService;

  const pipeline = new ExtractionPipelineV14Service({ rpc: vi.fn() } as never, extractV14Spy, {
    runRpc: runRpc as never,
    runsV2Repo: runsV2Repo as never,
    persistenceV2: { persistCandidates } as never,
    compileService,
  });

  return {
    pipeline,
    runRpc,
    runsV2Repo,
    persistCandidates,
    extractV14Spy,
    compileService,
  };
}

describe('ExtractionPipelineV14Service', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    resetEnvCache();
    vi.restoreAllMocks();
  });

  it('happy path pending → completed with promote and markValidated', async () => {
    const { pipeline, runRpc, runsV2Repo } = buildPipeline(baseCompileResult());
    const result = await pipeline.run(inboxItem);

    expect(result.processing_status).toBe('completed');
    expect(result.extraction_run_id).toBe(RUN_ID);
    expect(result.extractor_version).toBe(EXTRACTOR_V14_VERSION);
    expect(runRpc.startExtractionRun).toHaveBeenCalledOnce();
    expect(runRpc.promoteExtractionRun).toHaveBeenCalledWith(RUN_ID);
    expect(runsV2Repo.markValidated).toHaveBeenCalledWith(RUN_ID);
  });

  it('passes correctionId to startExtractionRun and persistCandidates on correction trigger', async () => {
    const correctionId = 'c0000000-0000-4000-8000-000000000001';
    const { pipeline, runRpc, persistCandidates } = buildPipeline(baseCompileResult());

    await pipeline.runWithTrigger(inboxItem, 'correction', { correctionId });

    expect(runRpc.startExtractionRun).toHaveBeenCalledWith(
      expect.objectContaining({ correctionId }),
    );
    expect(persistCandidates).toHaveBeenCalledWith(
      expect.objectContaining({ correctionId }),
    );
  });

  it('calls compileFromInbox exactly once (single LLM path)', async () => {
    const compileResult = baseCompileResult();
    const { pipeline, compileService } = buildPipeline(compileResult);

    await pipeline.run(inboxItem, { preContextBlock: 'MEMORIA RELEVANTE:\n[1] test' });

    expect(compileService.compileFromInbox).toHaveBeenCalledOnce();
    expect(compileService.compileFromInbox).toHaveBeenCalledWith(
      inboxItem,
      expect.objectContaining({ preContextBlock: expect.any(String) }),
    );
  });

  it('never invokes extractor v1.3 ExtractFn', async () => {
    const extractV13 = vi.fn();
    const { pipeline, compileService } = buildPipeline(baseCompileResult());
    await pipeline.run(inboxItem);
    expect(compileService.compileFromInbox).toHaveBeenCalledOnce();
    expect(extractV13).not.toHaveBeenCalled();
  });

  it('invalid_source_block → compilerNote, accepted, persist + promote', async () => {
    const compileResult = baseCompileResult({
      compiled: baseCompiled({
        decision: {
          status: 'accepted',
          reasons: ['compiled_without_blocking_issues'],
          confidence: 0.9,
        },
      }),
    });
    const { pipeline, runRpc, persistCandidates } = buildPipeline(compileResult);
    const result = await pipeline.run(inboxItem);

    expect(result.processing_status).toBe('completed');
    expect(persistCandidates).toHaveBeenCalledOnce();
    expect(runRpc.promoteExtractionRun).toHaveBeenCalledOnce();
    expect(runRpc.failExtractionRun).not.toHaveBeenCalled();
  });

  it('external_action pending → promote allowed; needs_clarification; no external side effect', async () => {
    const compileResult = baseCompileResult({
      finalDecision: {
        status: 'needs_clarification',
        blockingCount: 1,
        nonBlockingCount: 0,
        discardedCount: 0,
      },
      clarificationMateriality: {
        blocking: [
          {
            source: 'llm',
            targetType: 'external_action',
            issueType: 'missing_external_action_target',
            targetReference: 'Enviar contrato',
            question: 'Para quem enviar?',
            reason: 'destinatário ambíguo',
            priority: 'high',
            blockingScope: 'external_action',
            materiality: 'blocking',
            sourceExcerpt: 'Enviar contrato',
            suggestedAnswers: [],
          },
        ],
        nonBlocking: [],
        discarded: [],
      },
    });
    const externalExecutor = vi.fn();
    const { pipeline, runRpc } = buildPipeline(compileResult);

    const result = await pipeline.run(inboxItem);

    expect(result.processing_status).toBe('completed');
    expect(result.needs_clarification).toBe(true);
    expect(runRpc.promoteExtractionRun).toHaveBeenCalledWith(RUN_ID);
    expect(externalExecutor).not.toHaveBeenCalled();
  });

  it('task_execution pending → promote allowed', async () => {
    const compileResult = baseCompileResult({
      finalDecision: {
        status: 'needs_clarification',
        blockingCount: 1,
        nonBlockingCount: 0,
        discardedCount: 0,
      },
      clarificationMateriality: {
        blocking: [
          {
            source: 'compiler',
            targetType: 'task',
            issueType: 'missing_task_target',
            targetReference: 'Cobrar fornecedor',
            question: 'Qual fornecedor?',
            reason: 'alvo ambíguo',
            priority: 'medium',
            blockingScope: 'task_execution',
            materiality: 'blocking',
            sourceExcerpt: 'Cobrar fornecedor',
            suggestedAnswers: [],
          },
        ],
        nonBlocking: [],
        discarded: [],
      },
    });
    const { pipeline, runRpc } = buildPipeline(compileResult);
    const result = await pipeline.run(inboxItem);

    expect(result.processing_status).toBe('completed');
    expect(runRpc.promoteExtractionRun).toHaveBeenCalledWith(RUN_ID);
  });

  it('knowledge_confirmation pending → promote allowed', async () => {
    const compileResult = baseCompileResult({
      finalDecision: {
        status: 'needs_clarification',
        blockingCount: 1,
        nonBlockingCount: 0,
        discardedCount: 0,
      },
      clarificationMateriality: {
        blocking: [
          {
            source: 'llm',
            targetType: 'entity',
            issueType: 'ambiguous_entity_type',
            targetReference: 'Projeto Atlas',
            question: 'É project ou topic?',
            reason: 'tipo ambíguo',
            priority: 'medium',
            blockingScope: 'knowledge_confirmation',
            materiality: 'blocking',
            sourceExcerpt: 'Projeto Atlas',
            suggestedAnswers: [],
          },
        ],
        nonBlocking: [],
        discarded: [],
      },
    });
    const { pipeline, runRpc } = buildPipeline(compileResult);
    const result = await pipeline.run(inboxItem);

    expect(result.processing_status).toBe('completed');
    expect(runRpc.promoteExtractionRun).toHaveBeenCalledWith(RUN_ID);
  });

  it('LLM failure → fail_extraction_run and rethrow', async () => {
    const { pipeline, runRpc, compileService } = buildPipeline(baseCompileResult());
    vi.mocked(compileService.compileFromInbox).mockRejectedValue(new Error('OpenAI timeout'));

    await expect(pipeline.run(inboxItem)).rejects.toThrow('OpenAI timeout');
    expect(runRpc.failExtractionRun).toHaveBeenCalledWith(RUN_ID, 'OpenAI timeout');
    expect(runRpc.promoteExtractionRun).not.toHaveBeenCalled();
  });

  it('persistence failure → fail_extraction_run and rethrow', async () => {
    const { pipeline, runRpc, persistCandidates } = buildPipeline(baseCompileResult());
    persistCandidates.mockRejectedValue(new Error('persist failed'));

    await expect(pipeline.run(inboxItem)).rejects.toThrow('persist failed');
    expect(runRpc.failExtractionRun).toHaveBeenCalledWith(RUN_ID, 'persist failed');
    expect(runRpc.promoteExtractionRun).not.toHaveBeenCalled();
  });

  it('extractV14 invoked exactly once through real compile service', async () => {
    const output = loadExtractorV14Fixture();
    const extractV14 = vi.fn(createMockExtractV14(output));
    vi.spyOn(CorrectionsRepository.prototype, 'listByInboxItem').mockResolvedValue([]);
    vi.spyOn(ClarificationsRepository.prototype, 'listAnsweredByInboxItem').mockResolvedValue([]);
    vi.spyOn(DbReferenceResolverService.prototype, 'resolveForExtractorOutput').mockResolvedValue({
      references: [],
      byReferenceText: new Map(),
    });

    const compileService = new ExtractorV14CompileService({ rpc: vi.fn() } as never, extractV14);
    await compileService.compileFromInbox(inboxItem);

    expect(extractV14).toHaveBeenCalledOnce();
  });
});
