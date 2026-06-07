import type { ExtractorOutputV14 } from '../openai/extractor-v1.4.types.js';
import type { ExtractedTask, InboxItem } from '../types/domain.js';
import type { ClarificationService } from './clarification.service.js';
import type { TasksRepository } from '../repositories/tasks.repository.js';
import type { InboxItemsRepository } from '../repositories/inbox-items.repository.js';
import type { ClarificationsRepository } from '../repositories/clarifications.repository.js';
import type { InboxItemProcessService } from './inbox-item-process.service.js';
import type { ReasonInput, ReasonOutput } from './contextual-reasoner.types.js';
import { log } from '../utils/logger.js';
import { parseClarificationAnswer } from '../telegram/parse-clarification-answer.js';

export interface DispatcherDeps {
  clarificationService: ClarificationService | null;
  clarificationsRepo: ClarificationsRepository;
  inboxRepo: InboxItemsRepository;
  tasksRepo: TasksRepository | null;
  v14Process: InboxItemProcessService | null;
}

export interface DispatcherInput {
  inboxId: string;
  reasonOutput: ReasonOutput;
  reasonInput: ReasonInput;
  mode: 'shadow' | 'act';
}

export interface DispatcherResult {
  /** Quantas clarifs foram resolvidas */
  clarifsResolved: number;
  /** Se rodou extraction (com effective_input ou normal) */
  extractionRan: boolean;
  /** Se pediu confirmação pro user (cancel/update que não age direto) */
  awaitingConfirmation: boolean;
  /** Se pulou por decisão unrelated */
  skippedAsUnrelated: boolean;
  /** Se algum sanity check rejeitou a ação (e caiu pra fallback) */
  sanityCheckFailed: boolean;
  /** Logs estruturados (resumo das ações) */
  actions: Array<{ kind: string; detail: string }>;
}

/**
 * Contextual Reasoner Dispatcher (Fase 5.3).
 *
 * Recebe a saída do Reasoner e AGE baseado na decisão:
 * - pure_reply: resolve clarif_resolutions + skip extraction
 * - new_capture: roda extraction (com effective_input se fornecido)
 * - mixed: resolve clarif_resolutions + roda extraction com effective_input
 * - update_existing: roda extraction normal (o LLM atualiza via extração)
 *   + loga task_updates (vai pra follow-up do user)
 * - cancel_pending: NÃO cancela direto. Envia follow-up pedindo confirmação.
 * - unrelated: skip, sem extração, sem follow-up
 *
 * Em modo 'shadow': loga TUDO mas não age. Usado pra rollout seguro.
 */
export class ContextualReasonerDispatcher {
  constructor(private readonly deps: DispatcherDeps) {}

  /**
   * Despacha a decisão. Retorna o que foi feito (pra logging e follow-up).
   */
  async dispatch(input: DispatcherInput): Promise<DispatcherResult> {
    const { reasonOutput: out, mode } = input;
    const result: DispatcherResult = {
      clarifsResolved: 0,
      extractionRan: false,
      awaitingConfirmation: false,
      skippedAsUnrelated: false,
      sanityCheckFailed: false,
      actions: [],
    };

    const acting = mode === 'act';
    const decision = out.decision.kind;

    log('info', 'contextual_reasoner_dispatcher', {
      step: 'dispatch_start',
      inbox_id: input.inboxId,
      decision,
      mode,
      confidence: out.decision.confidence,
      n_resolutions: out.clarif_resolutions.length,
      n_task_updates: out.task_updates.length,
      has_new_capture: out.new_capture !== null,
      n_new_clarifications: out.new_clarifications.length,
    });

    // 1. UNRELATED: skip
    if (decision === 'unrelated') {
      result.skippedAsUnrelated = true;
      result.actions.push({ kind: 'unrelated_skip', detail: out.decision.reasoning });
      log('info', 'contextual_reasoner_dispatcher', {
        step: 'unrelated_skipped',
        inbox_id: input.inboxId,
      });
      return result;
    }

    // 2. CANCEL_PENDING: pedir confirmação (não cancela direto)
    if (decision === 'cancel_pending') {
      const valid = await this.validateTaskUpdates(out, input);
      if (!valid) {
        result.sanityCheckFailed = true;
        result.actions.push({ kind: 'cancel_blocked', detail: 'task_id inválido' });
        // Fall through to new_capture handling
      } else {
        result.awaitingConfirmation = true;
        result.actions.push({
          kind: 'cancel_requested',
          detail: out.task_updates[0]?.reasoning ?? 'user quer cancelar',
        });
        if (acting) {
          // Em act: NÃO cancela direto. Só marca a action. O follow-up
          // vai pedir confirmação. Cancel real requer input explícito do user.
        }
        log('info', 'contextual_reasoner_dispatcher', {
          step: 'cancel_awaiting_confirmation',
          inbox_id: input.inboxId,
          n_task_updates: out.task_updates.length,
        });
      }
    }

    // 3. Resolver clarif_resolutions (sempre que acting)
    if (acting && out.clarif_resolutions.length > 0 && this.deps.clarificationService) {
      const resolved = await this.resolveClarifications(input);
      result.clarifsResolved = resolved;
      if (resolved > 0) {
        result.actions.push({
          kind: 'clarifs_resolved',
          detail: `${resolved} clarif(s) resolvida(s) automaticamente`,
        });
      }
    } else if (out.clarif_resolutions.length > 0) {
      // shadow mode
      result.actions.push({
        kind: 'clarifs_would_resolve',
        detail: `${out.clarif_resolutions.length} clarif(s) (shadow mode)`,
      });
    }

    // 4. Extraction: NÃO roda aqui — a pipeline (v14Process) faz isso
    //    depois. O Reasoner já resolveu as clarifs pendentes, então a
    //    extraction vai ver o estado limpo. Em v1, o dispatcher só
    //    prepara o terreno; em v2 (5.4) pode rodar extraction dedicado.
    if (out.new_capture && this.deps.v14Process) {
      result.actions.push({
        kind: 'extraction_scheduled',
        detail: `effective_input: "${out.new_capture.effective_input.slice(0, 80)}"`,
      });
    }

    // 5. Log task_updates pra follow-up do user
    if (out.task_updates.length > 0) {
      for (const upd of out.task_updates) {
        result.actions.push({
          kind: 'task_update_logged',
          detail: `${upd.operation} task=${upd.task_id.slice(0, 8)} value=${upd.new_value?.slice(0, 40) ?? 'null'}`,
        });
      }
    }

    log('info', 'contextual_reasoner_dispatcher', {
      step: 'dispatch_done',
      inbox_id: input.inboxId,
      clarifs_resolved: result.clarifsResolved,
      extraction_ran: result.extractionRan,
      awaiting_confirmation: result.awaitingConfirmation,
      sanity_check_failed: result.sanityCheckFailed,
      skipped_unrelated: result.skippedAsUnrelated,
      n_actions: result.actions.length,
    });

    return result;
  }

  private async validateTaskUpdates(
    out: ReasonOutput,
    input: DispatcherInput,
  ): Promise<boolean> {
    if (out.task_updates.length === 0) return true;
    if (!this.deps.tasksRepo) return false;
    try {
      // Pega inboxIds do thread (do reasonInput)
      const inboxIds = new Set<string>([input.inboxId]);
      for (const m of input.reasonInput.threadContext.recentMessages) {
        inboxIds.add(m.inbox_item_id);
      }
      const activeTasks = await this.deps.tasksRepo.listActiveByInboxItemIds(
        Array.from(inboxIds),
        50,
      );
      const validIds = new Set(activeTasks.map((t) => t.id));
      return out.task_updates.every((u) => validIds.has(u.task_id));
    } catch (err) {
      log('warn', 'contextual_reasoner_dispatcher', {
        step: 'validate_task_updates_failed',
        error: err instanceof Error ? err.message : String(err),
      });
      return false;
    }
  }

  private async resolveClarifications(input: DispatcherInput): Promise<number> {
    const { reasonOutput: out, inboxId } = input;
    let resolved = 0;
    for (const r of out.clarif_resolutions) {
      if (!r.answered || !r.answer) continue;
      try {
        // Buscar a clarif pra pegar suggested_answers (parseClarificationAnswer expande)
        const clarif = await this.deps.clarificationsRepo.findById(r.clarification_id);
        if (!clarif) {
          log('warn', 'contextual_reasoner_dispatcher', {
            step: 'clarif_not_found',
            clarification_id: r.clarification_id,
          });
          continue;
        }
        if (clarif.status !== 'pending') {
          log('info', 'contextual_reasoner_dispatcher', {
            step: 'clarif_not_pending',
            clarification_id: r.clarification_id,
            status: clarif.status,
          });
          continue;
        }
        const answer = parseClarificationAnswer(
          r.answer,
          clarif.suggested_answers ?? [],
        );
        await this.deps.clarificationService!.resolveAndApply(
          r.clarification_id,
          answer,
          { apply: true },
        );
        resolved++;
        log('info', 'contextual_reasoner_dispatcher', {
          step: 'clarif_resolved',
          clarification_id: r.clarification_id,
          answer: answer.slice(0, 60),
        });
      } catch (err) {
        log('warn', 'contextual_reasoner_dispatcher', {
          step: 'clarif_resolve_failed',
          clarification_id: r.clarification_id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return resolved;
  }

  private async runExtraction(): Promise<never> {
    throw new Error('unused in v1 — pipeline runs extraction');
  }
}
