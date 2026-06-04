import type { SupabaseClient } from '@supabase/supabase-js';
import type { ExtractV14Fn } from '../openai/extractor-v1.4.service.js';
import { createOpenAiExtractorV14 } from '../openai/extractor-v1.4.service.js';
import type { ExtractorOutputV14 } from '../openai/extractor-v1.4.types.js';
import { getEnrichmentOptions, isExternalKnowledgeEnrichmentEnabled } from '../config/env.js';
import { CorrectionsRepository } from '../repositories/corrections.repository.js';
import { ClarificationsRepository } from '../repositories/clarifications.repository.js';
import type { InboxItem, SourceMode } from '../types/domain.js';
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
import { buildIngestionContextFromInboxItem } from './ingestion-context-from-inbox.service.js';
import { MemoryCompilerV2Service } from './memory-compiler-v2.service.js';
import type { MemoryResolverResult } from './reference-resolver.service.js';
import { TaskContextResolverService } from './task-context-resolver.service.js';
import type { TaskSignalContextResolution } from '../types/ingestion-context.js';
import {
  ExternalKnowledgeEnrichmentService,
} from './external-knowledge-enrichment.service.js';
import { createWebSearchProvider } from './web-search/tavily-provider.js';
import { MockWebSearchProvider } from './web-search/web-search-provider.js';

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
  private readonly clarificationsRepo: ClarificationsRepository;
  private readonly dbResolver: DbReferenceResolverService;
  private readonly compiler = new MemoryCompilerV2Service();
  private readonly clarificationManager = new ClarificationManagerV2Service();
  private readonly taskResolver = new TaskContextResolverService();
  private readonly contextSelector = new IngestionContextSelectorService();
  private readonly enrichmentService = new ExternalKnowledgeEnrichmentService();

  constructor(
    db: SupabaseClient,
    private readonly extractV14: ExtractV14Fn = createOpenAiExtractorV14(),
  ) {
    this.correctionsRepo = new CorrectionsRepository(db);
    this.clarificationsRepo = new ClarificationsRepository(db);
    this.dbResolver = new DbReferenceResolverService(db);
  }

  async buildEffectiveInput(inboxItem: InboxItem): Promise<string> {
    const corrections = await this.correctionsRepo.listByInboxItem(inboxItem.id);
    const answered = await this.clarificationsRepo.listAnsweredByInboxItem(inboxItem.id);
    return buildEffectiveInputWithSourceBlocks({
      raw_content: inboxItem.raw_content,
      corrections: corrections.map((c) => ({
        id: c.id,
        correction_text: c.correction_text,
      })),
      clarifications: answered.map((c) => ({
        id: c.id,
        question: c.question,
        answer: c.answer ?? '',
        target_reference: c.target_reference,
        issue_type: c.issue_type,
      })),
    });
  }

  async compileFromInbox(inboxItem: InboxItem): Promise<ExtractorV14CompileResult> {
    const effectiveInput = await this.buildEffectiveInput(inboxItem);
    const fullContext = buildIngestionContextFromInboxItem(inboxItem);

    const output = await this.extractV14({
      effective_input: effectiveInput,
      source_channel: inboxItem.source_channel,
      source_mode: inboxItem.source_mode as SourceMode,
      received_at: inboxItem.received_at,
      timezone: inboxItem.timezone,
    });

    const resolverResult = await this.dbResolver.resolveForExtractorOutput(
      output,
      fullContext.sourceMetadata.entityLike,
      inboxItem.source_mode,
    );
    const taskSignalResolutions = this.taskResolver.resolveTaskSignals(
      output.task_signals ?? [],
      fullContext,
    );
    const compactContext = this.contextSelector.selectCompact(
      fullContext,
      output,
      effectiveInput,
    );

    const temporalAnchor = inboxItem.received_at?.trim()
      ? {
          receivedAt: inboxItem.received_at,
          timezone: inboxItem.timezone,
        }
      : undefined;

    const enrichmentOpts = getEnrichmentOptions();
    let searchProvider = createWebSearchProvider(
      enrichmentOpts.webSearchProvider,
      enrichmentOpts.webSearchApiKey,
    );
    if (enrichmentOpts.webSearchProvider === 'mock') {
      searchProvider = new MockWebSearchProvider(new Map());
    }

    const externalEnrichment = await this.enrichmentService.enrich(
      output,
      inboxItem.received_at,
      {
        enabled: isExternalKnowledgeEnrichmentEnabled(),
        maxQueries: enrichmentOpts.maxQueries,
        autoApplyConfidence: enrichmentOpts.autoApplyConfidence,
        suggestConfidence: enrichmentOpts.suggestConfidence,
        searchProvider,
      },
    );

    const compiled = this.compiler.compile({
      extractorOutput: output,
      effectiveInput,
      resolverResult,
      fullIngestionContext: fullContext,
      compactIngestionContext: compactContext,
      taskSignalResolutions,
      temporalAnchor,
      externalEnrichment,
      enrichmentAutoApplyConfidence: enrichmentOpts.autoApplyConfidence,
      enrichmentSuggestConfidence: enrichmentOpts.suggestConfidence,
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
