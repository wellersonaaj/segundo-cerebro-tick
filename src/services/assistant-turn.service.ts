import { randomUUID } from 'node:crypto';
import { isGreenfieldSchemaEnabled } from '../config/env.js';
import type { ExtractorOutputV14 } from '../openai/extractor-v1.4.types.js';
import type { ClarificationsRepository } from '../repositories/clarifications.repository.js';
import type { InboxItemsRepository } from '../repositories/inbox-items.repository.js';
import type { TaskAuditRepository } from '../repositories/task-audit.repository.js';
import type { ExtractionRunsV2Repository } from '../repositories/v2/extraction-runs-v2.repository.js';
import type { ExternalKnowledgeEnrichmentResult } from '../types/external-knowledge-enrichment.js';
import type { CompiledMemoryV2 } from '../types/memory-compiler-v2.js';
import {
  isTelegramPromptableClarification,
  withTelegramClarificationState,
} from '../telegram/telegram-metadata.js';
import { log } from '../utils/logger.js';
import {
  composeAssistantAck,
  composeClarificationAck,
  composeFollowUpMessage,
} from './assistant-response-composer.js';
import {
  buildAssistantThreadId,
  withAssistantTurnMetadata,
} from './assistant-session.service.js';
import {
  createAssistantTurn,
  setAssistantTurnStatus,
} from './assistant-turn.store.js';
import type {
  AssistantTurnAck,
  ResolveClarificationInput,
  StartCaptureInput,
} from './assistant-turn.types.js';
import type { ClarificationService } from './clarification.service.js';
import type { InboxItemProcessService } from './inbox-item-process.service.js';
import { aggregateUncertaintyGaps } from './uncertainty-aggregator.js';
export class AssistantTurnService {
  constructor(
    private readonly inboxRepo: InboxItemsRepository,
    private readonly v14Process: InboxItemProcessService | null,
    private readonly clarificationsRepo: ClarificationsRepository,
    private readonly clarificationService: ClarificationService | null,
    private readonly taskAuditRepo: TaskAuditRepository,
    private readonly runsV2Repo: ExtractionRunsV2Repository,
  ) {}

  async startCapture(input: StartCaptureInput): Promise<AssistantTurnAck> {
    if (!isGreenfieldSchemaEnabled() || !this.v14Process) {
      throw new Error('GREENFIELD_PIPELINE_REQUIRED');
    }

    const turnId = randomUUID();
    const ackMessage = composeAssistantAck();

    createAssistantTurn({
      turn_id: turnId,
      thread_id: input.thread_id,
      channel: input.channel,
      status: 'processing',
      ack_message: ackMessage,
      created_at: new Date().toISOString(),
    });

    await input.delivery.sendAck(ackMessage);

    void this.runCapturePipeline(turnId, input).catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      log('error', 'assistant_turn', { step: 'background_failed', turn_id: turnId, error: message });
    });

    return { turn_id: turnId, thread_id: input.thread_id, ack_message: ackMessage };
  }

  async resolveClarification(input: ResolveClarificationInput): Promise<AssistantTurnAck> {
    if (!this.clarificationService) {
      throw new Error('CLARIFICATION_SERVICE_REQUIRED');
    }

    const turnId = randomUUID();
    const ackMessage = composeClarificationAck(input.answer);

    createAssistantTurn({
      turn_id: turnId,
      thread_id: input.thread_id,
      channel: input.channel,
      status: 'processing',
      ack_message: ackMessage,
      created_at: new Date().toISOString(),
    });

    await input.delivery.sendAck(ackMessage);

    void this.runClarificationPipeline(turnId, input).catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      log('error', 'assistant_turn', {
        step: 'clarification_background_failed',
        turn_id: turnId,
        error: message,
      });
    });

    return { turn_id: turnId, thread_id: input.thread_id, ack_message: ackMessage };
  }

  private async runCapturePipeline(turnId: string, input: StartCaptureInput): Promise<void> {
    try {
      let inboxItem = input.source_reference
        ? await this.inboxRepo.findBySourceReference(input.source_reference)
        : null;

      if (!inboxItem) {
        const metadata = withAssistantTurnMetadata(input.metadata ?? {}, {
          thread_id: input.thread_id,
          active_turn_id: turnId,
        });
        inboxItem = await this.inboxRepo.create({
          raw_content: input.text,
          source_channel: input.channel === 'telegram' ? 'telegram' : 'api',
          source_mode: 'conversational',
          received_at: input.received_at,
          timezone: input.timezone,
          source_reference: input.source_reference ?? null,
          metadata,
        });
      }

      const pipelineResult = await this.v14Process!.processById(inboxItem.id);
      await this.deliverFollowUp(turnId, input, inboxItem.id, pipelineResult);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setAssistantTurnStatus(turnId, 'failed', { error: message });
      await input.delivery.sendFollowUp(
        composeFollowUpMessage({
          raw_content: input.text,
          processing_status: 'failed',
          tasks: [],
          clarifications: [],
          gaps: [],
          processing_error: message,
        }),
      );
    }
  }

  private async runClarificationPipeline(
    turnId: string,
    input: ResolveClarificationInput,
  ): Promise<void> {
    try {
      const applyResult = await this.clarificationService!.resolveAndApply(
        input.clarification_id,
        input.answer,
        { apply: true },
      );

      await this.clearClarificationPrompt(input.inbox_item_id);

      const inbox = await this.inboxRepo.findById(applyResult.inbox_item_id);
      const rawContent = inbox?.raw_content ?? input.answer;

      await this.deliverFollowUp(
        turnId,
        {
          text: rawContent,
          thread_id: input.thread_id,
          channel: input.channel,
          received_at: new Date().toISOString(),
          timezone: 'America/Sao_Paulo',
          delivery: input.delivery,
        },
        applyResult.inbox_item_id,
        {
          processing_status: applyResult.processing_status,
          extraction_run_id: applyResult.extraction_run_id,
        },
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setAssistantTurnStatus(turnId, 'failed', { error: message });
      await input.delivery.sendFollowUp(`Não consegui aplicar sua resposta: ${message}`);
    }
  }

  private async deliverFollowUp(
    turnId: string,
    input: StartCaptureInput,
    inboxItemId: string,
    pipelineResult: {
      processing_status: 'completed' | 'failed';
      extraction_run_id?: string;
    },
  ): Promise<void> {
    const inbox = await this.inboxRepo.findById(inboxItemId);
    const rawContent = inbox?.raw_content ?? input.text;

    const [tasks, clarifications, extractorOutput, enrichment] = await Promise.all([
      this.taskAuditRepo.listByInboxItem(inboxItemId),
      this.clarificationsRepo.listPendingByInboxItem(inboxItemId),
      this.loadExtractorOutput(pipelineResult.extraction_run_id),
      this.loadEnrichmentEvidence(pipelineResult.extraction_run_id),
    ]);

    const gaps = aggregateUncertaintyGaps({
      clarifications,
      extractorOutput,
      maxGaps: 2,
    });

    const followUp = composeFollowUpMessage({
      raw_content: rawContent,
      processing_status: pipelineResult.processing_status,
      tasks,
      clarifications,
      gaps,
      enrichment,
    });

    const followUpMessageId = await input.delivery.sendFollowUp(followUp);

    await this.markActiveClarification(
      input,
      inboxItemId,
      clarifications,
      turnId,
      followUpMessageId,
    );

    setAssistantTurnStatus(turnId, pipelineResult.processing_status === 'failed' ? 'failed' : 'completed', {
      follow_up_message: followUp,
      inbox_item_id: inboxItemId,
      extraction_run_id: pipelineResult.extraction_run_id ?? null,
    });

    if (inbox) {
      await this.inboxRepo.updateMetadata(
        inboxItemId,
        withAssistantTurnMetadata(inbox.metadata ?? null, {
          thread_id: input.thread_id,
          active_turn_id: null,
        }),
      );
    }
  }

  private async markActiveClarification(
    input: StartCaptureInput,
    inboxItemId: string,
    clarifications: Awaited<ReturnType<ClarificationsRepository['listPendingByInboxItem']>>,
    turnId: string,
    promptMessageId: number | null,
  ): Promise<void> {
    if (input.channel !== 'telegram') return;

    const primary = clarifications.find((c) => isTelegramPromptableClarification(c));
    if (!primary || promptMessageId == null) return;

    const inbox = await this.inboxRepo.findById(inboxItemId);
    if (!inbox) return;

    await this.inboxRepo.updateMetadata(
      inboxItemId,
      withTelegramClarificationState(inbox.metadata ?? null, {
        active_clarification_id: primary.id,
        prompt_message_id: promptMessageId,
      }),
    );

    log('info', 'assistant_turn', {
      step: 'clarification_marked_active',
      turn_id: turnId,
      clarification_id: primary.id,
      inbox_item_id: inboxItemId,
      prompt_message_id: promptMessageId,
    });
  }

  private async clearClarificationPrompt(inboxItemId: string): Promise<void> {
    const inbox = await this.inboxRepo.findById(inboxItemId);
    if (!inbox) return;
    await this.inboxRepo.updateMetadata(
      inboxItemId,
      withTelegramClarificationState(inbox.metadata ?? null, null),
    );
  }

  private async loadExtractorOutput(
    runId: string | undefined,
  ): Promise<ExtractorOutputV14 | null> {
    if (!runId) return null;
    const run = await this.runsV2Repo.findById(runId);
    if (!run?.parsed_output) return null;
    return run.parsed_output as ExtractorOutputV14;
  }

  private async loadEnrichmentEvidence(
    runId: string | undefined,
  ): Promise<ExternalKnowledgeEnrichmentResult | null> {
    if (!runId) return null;
    const run = await this.runsV2Repo.findById(runId);
    const compiled = run?.compiled_output as (CompiledMemoryV2 & {
      enrichmentEvidence?: ExternalKnowledgeEnrichmentResult;
    }) | null;
    return compiled?.enrichmentEvidence ?? null;
  }

  static threadIdForTelegramChat(chatId: number): string {
    return buildAssistantThreadId('telegram', String(chatId));
  }
}
