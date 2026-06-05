import { randomUUID } from 'node:crypto';
import { loadEnv } from '../config/env.js';
import type { ParsedTelegramCapture } from '../telegram/parse-update.js';
import { getCurrentTurn } from '../utils/turn-context.js';
import { startTurn } from '../utils/structured-logger.js';
import type { AssistantDelivery } from './assistant-turn.types.js';
import type { AssistantTurnService } from './assistant-turn.service.js';
import type { CommandHandlerService } from './command-handler.service.js';
import type { IntentClassifierService, IntentResult } from './intent-classifier.service.js';
import type { RAGPipelineService } from './rag-pipeline.service.js';

export interface UnifiedRouterInput {
  capture: ParsedTelegramCapture;
  text: string;
  threadId: string;
  delivery: AssistantDelivery;
  receivedAt: string;
  timezone: string;
  sourceReference: string;
  metadata: Record<string, unknown>;
}

export type UnifiedRouterResult =
  | { kind: 'async_started'; turn_id: string; thread_id: string }
  | { kind: 'sync_reply'; text: string };

const DISABLED_CLASSIFIER_RESULT: IntentResult = {
  intent: 'save',
  confidence: 1,
  reasoning: 'INTENT_CLASSIFIER_ENABLED=false',
};

function parseCommand(text: string): { command: string; args: string[] } {
  const trimmed = text.trim();
  const parts = trimmed.split(/\s+/);
  const command = parts[0] ?? trimmed;
  return { command, args: parts.slice(1) };
}

export class UnifiedRouterService {
  constructor(
    private readonly classifier: IntentClassifierService | null,
    private readonly assistantTurn: AssistantTurnService,
    private readonly rag: RAGPipelineService | null,
    private readonly commands: CommandHandlerService,
    private readonly classifierEnabled = loadEnv().INTENT_CLASSIFIER_ENABLED,
  ) {}

  async handle(input: UnifiedRouterInput): Promise<UnifiedRouterResult> {
    const turn = getCurrentTurn();
    const result = await this.classifyIntent(input.text, turn?.turn_id);

    await turn?.handle.stage('route_dispatch', {
      output: { intent: result.intent, confidence: result.confidence },
    });

    switch (result.intent) {
      case 'save':
        return this.dispatchCapture(input, 'capture');
      case 'update':
        return this.dispatchCapture(input, 'correction');
      case 'query':
        return this.dispatchQuery(input.text, turn);
      case 'command':
        return this.dispatchCommand(input, result, turn);
      default:
        return this.dispatchCapture(input, 'capture');
    }
  }

  private async classifyIntent(text: string, turnId?: string): Promise<IntentResult> {
    if (!this.classifierEnabled || !this.classifier) {
      return DISABLED_CLASSIFIER_RESULT;
    }

    const ctx = getCurrentTurn();
    if (ctx) {
      let classified!: IntentResult;
      await ctx.handle.stage('intent_classify', async () => {
        classified = await this.classifier!.classify(text);
        return {
          output: classified,
          model: loadEnv().INTENT_CLASSIFIER_MODEL,
        };
      });
      return classified;
    }

    const ephemeral = startTurn({ turn_id: turnId ?? randomUUID() });
    let classified!: IntentResult;
    await ephemeral.stage('intent_classify', async () => {
      classified = await this.classifier!.classify(text);
      return {
        output: classified,
        model: loadEnv().INTENT_CLASSIFIER_MODEL,
      };
    });
    await ephemeral.finish();
    return classified;
  }

  private async dispatchCapture(
    input: UnifiedRouterInput,
    mode: 'capture' | 'correction',
  ): Promise<UnifiedRouterResult> {
    const ack = await this.assistantTurn.startCapture({
      text: input.text,
      thread_id: input.threadId,
      channel: 'telegram',
      received_at: input.receivedAt,
      timezone: input.timezone,
      source_reference: input.sourceReference,
      metadata: input.metadata,
      delivery: input.delivery,
      mode,
    });
    return { kind: 'async_started', turn_id: ack.turn_id, thread_id: ack.thread_id };
  }

  private async dispatchQuery(
    text: string,
    turn: ReturnType<typeof getCurrentTurn>,
  ): Promise<UnifiedRouterResult> {
    if (!this.rag) {
      return { kind: 'sync_reply', text: 'Consulta indisponível: RAG não configurado.' };
    }

    let answer!: string;
    if (turn) {
      await turn.handle.stage('compose', async () => {
        const result = await this.rag!.answer(text);
        answer = result.answer;
        return {
          output: { confidence: result.confidence, sources: result.sources.length },
        };
      });
    } else {
      const result = await this.rag.answer(text);
      answer = result.answer;
    }

    return { kind: 'sync_reply', text: answer };
  }

  private async dispatchCommand(
    input: UnifiedRouterInput,
    result: IntentResult,
    turn: ReturnType<typeof getCurrentTurn>,
  ): Promise<UnifiedRouterResult> {
    const { command, args } = parseCommand(result.suggested_command ?? input.text);
    const ctxTurnId = turn?.turn_id ?? randomUUID();

    let response!: Awaited<ReturnType<CommandHandlerService['handle']>>;
    if (turn) {
      await turn.handle.stage('command', async () => {
        response = await this.commands.handle(command, args, {
          turn_id: ctxTurnId,
          chat_id: input.capture.chatId,
          user_id: input.capture.userId,
        });
        return { output: { command, args_count: args.length } };
      });
    } else {
      response = await this.commands.handle(command, args, {
        turn_id: ctxTurnId,
        chat_id: input.capture.chatId,
        user_id: input.capture.userId,
      });
    }

    return { kind: 'sync_reply', text: response.text };
  }
}
