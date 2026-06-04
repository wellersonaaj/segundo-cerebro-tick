import type { SupabaseClient } from '@supabase/supabase-js';
import type { ExtractV14Fn } from '../openai/extractor-v1.4.service.js';
import { createOpenAiExtractorV14 } from '../openai/extractor-v1.4.service.js';
import type { ExtractorOutputV14 } from '../openai/extractor-v1.4.types.js';
import { CorrectionsRepository } from '../repositories/corrections.repository.js';
import { ClarificationsRepository } from '../repositories/clarifications.repository.js';
import type { InboxItem, SourceMode } from '../types/domain.js';
import type { CompactIngestionContext } from '../types/ingestion-context.js';
import type { CompiledMemoryV2 } from '../types/memory-compiler-v2.js';
import type { TemporalAnchor } from '../types/memory-compiler-v2.js';
import { buildEffectiveInputWithSourceBlocks } from '../utils/source-blocks.js';
import {
  type FinalClarificationDecision,
  type ClarificationManagerV2Result,
  classifyClarifications,
  computeFinalDecisionFromMateriality,
} from '../types/clarification-types.js';
import { DbReferenceResolverService } from './db-reference-resolver.service.js';
import { IngestionContextSelectorService } from './ingestion-context-selector.service.js';
import { buildIngestionContextFromInboxItem } from './ingestion-context-from-inbox.service.js';
import { MemoryCompilerV2Service } from './memory-compiler-v2.service.js';
import type { MemoryResolverResult } from './reference-resolver.service.js';
import { TaskContextResolverService } from './task-context-resolver.service.js';
import type { TaskSignalContextResolution } from '../types/ingestion-context.js';
import { ThreadConversationContextService, prependThreadContextToEffectiveInput } from './thread-conversation-context.service.js';
import {
  applyImplicitAssigneeToOutput,
  suppressPronounClarifications,
} from './implicit-assignee.service.js';
import {
  collectResolvedThreadPronouns,
  isThirdPersonObjectPronoun,
} from './pronoun-coreference.service.js';

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
  private readonly taskResolver = new TaskContextResolverService();
  private readonly contextSelector = new IngestionContextSelectorService();
  private readonly threadContextService: ThreadConversationContextService;

  constructor(
    db: SupabaseClient,
    private readonly extractV14: ExtractV14Fn = createOpenAiExtractorV14(),
  ) {
    this.correctionsRepo = new CorrectionsRepository(db);
    this.clarificationsRepo = new ClarificationsRepository(db);
    this.dbResolver = new DbReferenceResolverService(db);
    this.threadContextService = new ThreadConversationContextService(db);
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
    const threadContext = await this.threadContextService.buildForInbox(inboxItem);
    const baseEffectiveInput = await this.buildEffectiveInput(inboxItem);
    const effectiveInput = prependThreadContextToEffectiveInput(baseEffectiveInput, threadContext);
    const fullContext = buildIngestionContextFromInboxItem(inboxItem);
    const sourceMode = inboxItem.source_mode as SourceMode;

    let output = await this.extractV14({
      effective_input: effectiveInput,
      source_channel: inboxItem.source_channel,
      source_mode: sourceMode,
      received_at: inboxItem.received_at,
      timezone: inboxItem.timezone,
    });

    output = applyImplicitAssigneeToOutput(output, sourceMode, inboxItem.raw_content);

    const resolverResult = await this.dbResolver.resolveForExtractorOutput(
      output,
      fullContext.sourceMetadata.entityLike,
      sourceMode,
      threadContext,
    );

    const resolvedPronouns = collectResolvedThreadPronouns(resolverResult);
    output = suppressPronounClarifications(output, resolvedPronouns);
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

    const compiled = this.compiler.compile({
      extractorOutput: output,
      effectiveInput,
      resolverResult,
      fullIngestionContext: fullContext,
      compactIngestionContext: compactContext,
      taskSignalResolutions,
      temporalAnchor,
    });

    if (resolvedPronouns.size) {
      compiled.clarificationCandidates = compiled.clarificationCandidates.filter(
        (c) =>
          !(
            isThirdPersonObjectPronoun(c.targetReference) &&
            resolvedPronouns.has(c.targetReference.toLowerCase())
          ),
      );
    }

    const clarificationMateriality = classifyClarifications(compiled.clarificationCandidates);
    const finalDecision = computeFinalDecisionFromMateriality(clarificationMateriality);

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
