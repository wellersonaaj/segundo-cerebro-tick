import type { SupabaseClient } from '@supabase/supabase-js';
import type { ExtractV14Fn } from '../openai/extractor-v1.4.service.js';
import { createOpenAiExtractorV14 } from '../openai/extractor-v1.4.service.js';
import type { ExtractorOutputV14 } from '../openai/extractor-v1.4.types.js';
import { CorrectionsRepository } from '../repositories/corrections.repository.js';
import type { InboxItem, SourceMode } from '../types/domain.js';
import { EMPTY_INGESTION_CONTEXT } from '../types/ingestion-context.js';
import type { CompactIngestionContext } from '../types/ingestion-context.js';
import type { CompiledMemoryV2 } from '../types/memory-compiler-v2.js';
import type { TemporalAnchor } from '../types/memory-compiler-v2.js';
import { buildEffectiveInputWithSourceBlocks } from '../utils/source-blocks.js';
import {
  ClarificationManagerV2Service,
  type ClarificationManagerV2Result,
  type FinalClarificationDecision,
} from './clarification-manager-v2.service.js';
import { DbReferenceResolverService } from './db-reference-resolver.service.js';
import { IngestionContextSelectorService } from './ingestion-context-selector.service.js';
import { MemoryCompilerV2Service } from './memory-compiler-v2.service.js';
import type { MemoryResolverResult } from './reference-resolver.service.js';
import { TaskContextResolverService } from './task-context-resolver.service.js';
import type { TaskSignalContextResolution } from '../types/ingestion-context.js';

export interface ExtractorV14CompileResult {
  output: ExtractorOutputV14;
  effectiveInput: string;
  resolverResult: MemoryResolverResult;
  taskSignalResolutions: TaskSignalContextResolution[];
  compactContext: CompactIngestionContext;
  temporalAnchor: TemporalAnchor | undefined;
  compiled: CompiledMemoryV2;
  clarificationMateriality: ClarificationManagerV2Result;
  finalDecision: FinalClarificationDecision;
}

export class ExtractorV14CompileService {
  private readonly correctionsRepo: CorrectionsRepository;
  private readonly dbResolver: DbReferenceResolverService;
  private readonly compiler = new MemoryCompilerV2Service();
  private readonly clarificationManager = new ClarificationManagerV2Service();
  private readonly taskResolver = new TaskContextResolverService();
  private readonly contextSelector = new IngestionContextSelectorService();

  constructor(
    db: SupabaseClient,
    private readonly extractV14: ExtractV14Fn = createOpenAiExtractorV14(),
  ) {
    this.correctionsRepo = new CorrectionsRepository(db);
    this.dbResolver = new DbReferenceResolverService(db);
  }

  async buildEffectiveInput(inboxItem: InboxItem): Promise<string> {
    const corrections = await this.correctionsRepo.listByInboxItem(inboxItem.id);
    return buildEffectiveInputWithSourceBlocks({
      raw_content: inboxItem.raw_content,
      corrections: corrections.map((c) => ({
        id: c.id,
        correction_text: c.correction_text,
      })),
    });
  }

  async compileFromInbox(inboxItem: InboxItem): Promise<ExtractorV14CompileResult> {
    const effectiveInput = await this.buildEffectiveInput(inboxItem);

    const output = await this.extractV14({
      effective_input: effectiveInput,
      source_channel: inboxItem.source_channel,
      source_mode: inboxItem.source_mode as SourceMode,
      received_at: inboxItem.received_at,
      timezone: inboxItem.timezone,
    });

    const resolverResult = await this.dbResolver.resolveForExtractorOutput(output);
    const taskSignalResolutions = this.taskResolver.resolveTaskSignals(
      output.task_signals ?? [],
      EMPTY_INGESTION_CONTEXT,
    );
    const compactContext = this.contextSelector.selectCompact(
      EMPTY_INGESTION_CONTEXT,
      output,
      effectiveInput,
    );

    const temporalAnchor = inboxItem.received_at?.trim()
      ? {
          receivedAt: inboxItem.received_at,
          timezone: inboxItem.timezone,
        }
      : undefined;

    const compiled = this.compiler.compile({
      extractorOutput: output,
      effectiveInput,
      resolverResult,
      fullIngestionContext: EMPTY_INGESTION_CONTEXT,
      compactIngestionContext: compactContext,
      taskSignalResolutions,
      temporalAnchor,
    });

    const cmInput = {
      llmCandidates: compiled.clarificationCandidates.filter((c) => c.source === 'llm'),
      compilerCandidates: compiled.clarificationCandidates.filter((c) => c.source !== 'llm'),
      resolverResult,
      flags: compiled.flags,
      extractorOutput: output,
      compiled: {
        tasks: compiled.tasks,
        assertions: compiled.assertions,
        events: compiled.events,
      },
      effectiveInput,
      ingestionContext: compactContext,
      taskSignalResolutions,
      contextResolutionEvidence: compiled.contextResolutionEvidence,
    };
    const clarificationMateriality = this.clarificationManager.classify(cmInput);
    const finalDecision = this.clarificationManager.computeFinalDecision(clarificationMateriality);

    return {
      output,
      effectiveInput,
      resolverResult,
      taskSignalResolutions,
      compactContext,
      temporalAnchor,
      compiled,
      clarificationMateriality,
      finalDecision,
    };
  }
}
