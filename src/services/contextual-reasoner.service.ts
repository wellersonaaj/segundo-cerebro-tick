import OpenAI from 'openai';
import { z } from 'zod';
import { loadEnv } from '../config/env.js';
import { log } from '../utils/logger.js';
import { withRetry } from '../utils/retry.js';
import {
  REASONER_PROMPT_VERSION,
  REASONER_SCHEMA_VERSION,
  REASONER_SYSTEM_PROMPT,
  REASONER_VERSION,
  buildReasonerUserMessage,
} from './contextual-reasoner.prompt.js';
import {
  ClarifResolutionSchema,
  NewCaptureSchema,
  NewClarificationSchema,
  ReasonerError,
  ReasonInput,
  ReasonInputSchema,
  ReasonOutput,
  ReasonOutputSchema,
  TaskUpdateSchema,
  type ReasonDecisionKind,
} from './contextual-reasoner.types.js';

const SAFE_FALLBACK: ReasonOutput = {
  decision: {
    kind: 'new_capture',
    confidence: 0.4,
    reasoning: 'fallback seguro: erro no reasoner, segue com new_capture',
  },
  clarif_resolutions: [],
  task_updates: [],
  new_capture: null,
  new_clarifications: [],
};

const DEFAULT_MAX_TOKENS = 1500;
const DEFAULT_TEMPERATURE = 0;

// ============================================================================
// LLM client interface (similar ao intent-classifier)
// ============================================================================

export interface ReasonerLlmResult {
  content: string;
  finish_reason?: string;
  model?: string;
  input_tokens?: number;
  output_tokens?: number;
}

export interface ReasonerLlmClient {
  completeJson(input: {
    model: string;
    system: string;
    user: string;
    maxTokens: number;
    temperature: number;
  }): Promise<ReasonerLlmResult>;
}

export class OpenAiReasonerClient implements ReasonerLlmClient {
  constructor(private readonly client: OpenAI) {}

  async completeJson(input: {
    model: string;
    system: string;
    user: string;
    maxTokens: number;
    temperature: number;
  }): Promise<ReasonerLlmResult> {
    const response = await withRetry(
      () =>
        this.client.chat.completions.create({
          model: input.model,
          messages: [
            { role: 'system', content: input.system },
            { role: 'user', content: input.user },
          ],
          response_format: { type: 'json_object' },
          max_completion_tokens: input.maxTokens,
          temperature: input.temperature,
        }),
      {
        maxAttempts: 3,
        baseDelayMs: 800,
        onRetry: (attempt, err, delay) => {
          log('warn', 'contextual_reasoner', {
            step: 'llm_retry',
            attempt,
            delay_ms: delay,
            error: err instanceof Error ? err.message : String(err),
          });
        },
      },
    );

    const choice = response.choices[0];
    const usage = response.usage;
    return {
      content: choice?.message?.content ?? '',
      finish_reason: choice?.finish_reason ?? undefined,
      model: response.model,
      input_tokens: usage?.prompt_tokens,
      output_tokens: usage?.completion_tokens,
    };
  }
}

// ============================================================================
// Parse + validate
// ============================================================================

export function parseReasonerLlmResponse(raw: string): ReasonOutput | null {
  try {
    const json = JSON.parse(raw);
    const parsed = ReasonOutputSchema.safeParse(json);
    if (!parsed.success) {
      log('warn', 'contextual_reasoner', {
        step: 'schema_validation_failed',
        errors: parsed.error.issues.slice(0, 5),
      });
      return null;
    }
    return parsed.data;
  } catch (err) {
    log('warn', 'contextual_reasoner', {
      step: 'json_parse_failed',
      error: err instanceof Error ? err.message : String(err),
      raw_preview: raw.slice(0, 300),
    });
    return null;
  }
}

/**
 * Sanity checks pós-parse. Garante consistência semântica.
 * Retorna o output (possivelmente corrigido) ou null se irrecuperável.
 */
export function sanityCheckReasonerOutput(
  output: ReasonOutput,
  input: ReasonInput,
): ReasonOutput {
  const clarifIds = new Set(input.pendingClarifications.map((c) => c.id));
  const taskIds = new Set(input.activeTasks.map((t) => t.id));

  // 1. clarif_resolutions: garantir que IDs existem nas pendentes
  const validResolutions = output.clarif_resolutions.filter((r) => {
    if (!clarifIds.has(r.clarification_id)) {
      log('warn', 'contextual_reasoner', {
        step: 'sanity_drop_clarif_resolution',
        reason: 'clarification_id_not_pending',
        clarification_id: r.clarification_id,
      });
      return false;
    }
    return true;
  });

  // 2. task_updates: garantir que task_id existe em activeTasks
  const validTaskUpdates = output.task_updates.filter((u) => {
    if (!taskIds.has(u.task_id)) {
      log('warn', 'contextual_reasoner', {
        step: 'sanity_drop_task_update',
        reason: 'task_id_not_active',
        task_id: u.task_id,
      });
      return false;
    }
    return true;
  });

  // 3. Se há resolutions com answered=true, decision.kind DEVE ser mixed ou pure_reply
  const hasAnsweredResolution = validResolutions.some((r) => r.answered);
  let decision = output.decision;
  if (hasAnsweredResolution && decision.kind === 'new_capture') {
    log('warn', 'contextual_reasoner', {
      step: 'sanity_correct_decision_kind',
      from: 'new_capture',
      to: 'mixed',
      reason: 'answered_resolution_present',
    });
    decision = { ...decision, kind: 'mixed' };
  }

  // 4. Se decision.kind é unrelated, garantir que new_capture é null
  let newCapture = output.new_capture;
  let newClarifications = output.new_clarifications;
  if (decision.kind === 'unrelated') {
    if (newCapture !== null) {
      log('warn', 'contextual_reasoner', {
        step: 'sanity_drop_new_capture',
        reason: 'decision_is_unrelated',
      });
      newCapture = null;
    }
    if (newClarifications.length > 0) {
      log('warn', 'contextual_reasoner', {
        step: 'sanity_drop_new_clarifications',
        reason: 'decision_is_unrelated',
      });
      newClarifications = [];
    }
  }

  // 5. Se decision.kind é pure_reply ou mixed, garantir que new_capture não é null
  // (exceto se for pure_reply com zero conteúdo novo — aí pode ser null)
  if (decision.kind === 'mixed' && newCapture === null) {
    log('warn', 'contextual_reasoner', {
      step: 'sanity_warn_mixed_without_new_capture',
    });
  }

  // 6. Garantir que new_clarifications tem issue_type canônico (básico)
  const VALID_ISSUE_TYPES = new Set([
    'ambiguous_identity',
    'unresolved_reference',
    'ambiguous_entity_type',
    'possible_contradiction',
    'low_confidence_event',
    'missing_assignee',
    'missing_due_date',
    'missing_assignee_or_due_date',
    'ambiguous_date',
    'other',
  ]);
  newClarifications = newClarifications.filter((c) => {
    if (!VALID_ISSUE_TYPES.has(c.issue_type)) {
      log('warn', 'contextual_reasoner', {
        step: 'sanity_drop_clarif_invalid_issue_type',
        issue_type: c.issue_type,
      });
      return false;
    }
    return true;
  });

  return {
    ...output,
    decision,
    clarif_resolutions: validResolutions,
    task_updates: validTaskUpdates,
    new_capture: newCapture,
    new_clarifications: newClarifications,
  };
}

// ============================================================================
// Main service
// ============================================================================

export class ContextualReasonerService {
  constructor(
    private readonly llm: ReasonerLlmClient,
    private readonly model = 'gpt-4o-mini',
    private readonly maxTokens = DEFAULT_MAX_TOKENS,
    private readonly temperature = DEFAULT_TEMPERATURE,
  ) {}

  /**
   * Decide o que fazer com a mensagem atual dado o contexto.
   * Nunca lança — sempre retorna output (mesmo que seja SAFE_FALLBACK).
   */
  async reason(input: ReasonInput): Promise<ReasonOutput> {
    // 1. Validar input
    const inputParsed = ReasonInputSchema.safeParse(input);
    if (!inputParsed.success) {
      log('error', 'contextual_reasoner', {
        step: 'input_validation_failed',
        errors: inputParsed.error.issues.slice(0, 5),
      });
      return SAFE_FALLBACK;
    }

    // 2. Se não há contexto nenhum (sem clarifs, sem thread, sem tasks)
    //    E a msg é trivial, retorna unrelated direto sem gastar LLM call
    const isTrivial = input.currentMessage.trim().length < 5;
    const hasContext =
      input.pendingClarifications.length > 0 ||
      input.threadContext.recentMessages.length > 0 ||
      input.activeTasks.length > 0;
    if (isTrivial && !hasContext) {
      return {
        decision: {
          kind: 'unrelated',
          confidence: 0.9,
          reasoning: 'Mensagem trivial sem contexto para raciocinar.',
        },
        clarif_resolutions: [],
        task_updates: [],
        new_capture: null,
        new_clarifications: [],
      };
    }

    // 3. Chamar LLM
    const userMessage = buildReasonerUserMessage(inputParsed.data);
    let llmResult: ReasonerLlmResult;
    try {
      llmResult = await this.llm.completeJson({
        model: this.model,
        system: REASONER_SYSTEM_PROMPT,
        user: userMessage,
        maxTokens: this.maxTokens,
        temperature: this.temperature,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log('error', 'contextual_reasoner', {
        step: 'llm_error',
        error: message,
      });
      return SAFE_FALLBACK;
    }

    // 4. Parse
    const parsed = parseReasonerLlmResponse(llmResult.content);
    if (!parsed) {
      log('warn', 'contextual_reasoner', {
        step: 'parse_failed',
        finish_reason: llmResult.finish_reason ?? 'n/a',
        raw_length: llmResult.content.length,
        model: llmResult.model,
        input_tokens: llmResult.input_tokens,
        output_tokens: llmResult.output_tokens,
      });
      return SAFE_FALLBACK;
    }

    // 5. Sanity checks
    const checked = sanityCheckReasonerOutput(parsed, inputParsed.data);

    // 6. Log sucesso
    log('info', 'contextual_reasoner', {
      step: 'reasoned',
      decision: checked.decision.kind,
      confidence: checked.decision.confidence,
      reasoning: checked.decision.reasoning,
      n_resolutions: checked.clarif_resolutions.length,
      n_task_updates: checked.task_updates.length,
      has_new_capture: checked.new_capture !== null,
      n_new_clarifications: checked.new_clarifications.length,
      model: llmResult.model,
      input_tokens: llmResult.input_tokens,
      output_tokens: llmResult.output_tokens,
      finish_reason: llmResult.finish_reason,
    });

    return checked;
  }
}

// ============================================================================
// Factory
// ============================================================================

export function createContextualReasonerService(model?: string): ContextualReasonerService {
  const env = loadEnv();
  if (!env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY required for contextual reasoner');
  }
  const client = new OpenAI({ apiKey: env.OPENAI_API_KEY, timeout: 30_000 });
  return new ContextualReasonerService(
    new OpenAiReasonerClient(client),
    model ?? env.REASONER_MODEL,
  );
}

export { REASONER_PROMPT_VERSION, REASONER_SCHEMA_VERSION, REASONER_VERSION };
