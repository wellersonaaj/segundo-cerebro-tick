import type { ExtractedTaskSignal } from '../openai/extractor-v1.4.types.js';
import type {
  ContextResolutionSource,
  IngestionContext,
  SourceMetadata,
  TaskContext,
  TaskResolutionOutcome,
  TaskSignalContextResolution,
} from '../types/ingestion-context.js';
import { normalizeText } from '../utils/normalize.js';

export const TASK_RESOLVE_PLAUSIBLE_MIN_SCORE = 0.35;
export const TASK_RESOLVE_MIN_SCORE = 0.42;
export const TASK_RESOLVE_SCORE_MARGIN = 0.12;

export interface TaskScoreCandidate {
  task: TaskContext;
  score: number;
  resolutionSource: ContextResolutionSource;
}

function tokenize(text: string): string[] {
  return normalizeText(text)
    .split(/\s+/)
    .filter((t) => t.length >= 2);
}

function tokenOverlapScore(a: string, b: string): number {
  const ta = new Set(tokenize(a));
  const tb = new Set(tokenize(b));
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) {
    if (tb.has(t)) inter += 1;
  }
  const union = new Set([...ta, ...tb]).size;
  return union === 0 ? 0 : inter / union;
}

/** Portuguese-friendly partial match (revisão ↔ revisar contrato). */
function rootAndSubstringBoost(vagueRef: string, taskRef: string): number {
  const v = normalizeText(vagueRef).replace(/\s+/g, '');
  const t = normalizeText(taskRef).replace(/\s+/g, '');
  if (v.length < 3 || t.length < 3) return 0;
  if (t.includes(v) || v.includes(t)) return 0.45;
  const prefixLen = Math.min(5, v.length, t.length);
  if (v.slice(0, prefixLen) === t.slice(0, prefixLen)) return 0.38;
  return 0;
}

function threadAffinityBoost(task: TaskContext, routing: SourceMetadata['routing']): number {
  const threads = [
    routing.thread_reference,
    routing.reply_to_reference,
  ].filter(Boolean) as string[];
  if (threads.length === 0 || !task.threadReferences?.length) return 0;
  for (const tr of threads) {
    const norm = normalizeText(tr);
    if (task.threadReferences.some((t) => normalizeText(t) === norm)) {
      return 0.18;
    }
  }
  return 0;
}

function subjectAffinityBoost(task: TaskContext, routing: SourceMetadata['routing']): number {
  if (!routing.subject?.trim()) return 0;
  const subj = normalizeText(routing.subject);
  const ref = normalizeText(task.reference);
  if (subj.includes(ref) || ref.includes(subj)) return 0.12;
  return tokenOverlapScore(routing.subject, task.reference) * 0.15;
}

export function scoreTaskCandidate(
  vagueRef: string,
  task: TaskContext,
  routing: SourceMetadata['routing'],
): TaskScoreCandidate {
  const base = Math.max(
    tokenOverlapScore(vagueRef, task.reference),
    tokenOverlapScore(vagueRef, task.normalizedReference),
    rootAndSubstringBoost(vagueRef, task.reference),
  );
  const thread = threadAffinityBoost(task, routing);
  const subject = subjectAffinityBoost(task, routing);
  const score = Math.min(1, base + thread + subject);
  let resolutionSource: ContextResolutionSource = 'context_unique_match';
  if (thread > 0 && thread >= subject) resolutionSource = 'thread_affinity';
  else if (subject > 0) resolutionSource = 'subject_affinity';
  return { task, score, resolutionSource };
}

function findExplicitMatch(ref: string, tasks: TaskContext[]): TaskContext | null {
  const norm = normalizeText(ref);
  const matches = tasks.filter(
    (t) =>
      normalizeText(t.reference) === norm ||
      normalizeText(t.normalizedReference) === norm ||
      t.id === ref,
  );
  return matches.length === 1 ? matches[0]! : null;
}

export function resolveTaskReferenceAgainstContext(
  vagueRef: string,
  allOpenTasks: TaskContext[],
  routing: SourceMetadata['routing'],
): TaskResolutionOutcome {
  const candidateCountBeforeTruncation = allOpenTasks.length;

  if (!vagueRef.trim()) {
    return {
      status: 'unresolved',
      bestScore: 0,
      secondBestScore: null,
      scoreMargin: null,
      candidateCountBeforeTruncation,
      resolutionReason: 'no_plausible_candidate',
    };
  }

  const explicit = findExplicitMatch(vagueRef, allOpenTasks);
  if (explicit) {
    return {
      status: 'resolved',
      taskId: explicit.id,
      canonicalReference: explicit.reference,
      bestScore: 1,
      secondBestScore: null,
      scoreMargin: null,
      candidateCountBeforeTruncation,
      resolutionReason: 'explicit_match',
      resolutionSource: 'explicit_reference',
    };
  }

  const scored = allOpenTasks
    .map((t) => scoreTaskCandidate(vagueRef, t, routing))
    .sort((a, b) => b.score - a.score);

  const best = scored[0];
  const second = scored[1];
  const plausible = scored.filter((c) => c.score >= TASK_RESOLVE_PLAUSIBLE_MIN_SCORE);

  if (plausible.length > 1 && best && second) {
    const margin = best.score - second.score;
    if (margin < TASK_RESOLVE_SCORE_MARGIN) {
      return {
        status: 'ambiguous',
        candidates: plausible.map((p) => p.task),
        bestScore: best.score,
        secondBestScore: second.score,
        scoreMargin: margin,
        candidateCountBeforeTruncation,
        resolutionReason: 'ambiguous_close_scores',
      };
    }
  }

  if (plausible.length > 1) {
    return {
      status: 'ambiguous',
      candidates: plausible.map((p) => p.task),
      bestScore: best?.score ?? 0,
      secondBestScore: second?.score ?? null,
      scoreMargin: best && second ? best.score - second.score : null,
      candidateCountBeforeTruncation,
      resolutionReason: 'multiple_before_truncation',
    };
  }

  if (!best || best.score < TASK_RESOLVE_MIN_SCORE) {
    return {
      status: 'unresolved',
      bestScore: best?.score ?? 0,
      secondBestScore: second?.score ?? null,
      scoreMargin: best && second ? best.score - second.score : null,
      candidateCountBeforeTruncation,
      resolutionReason: 'score_below_minimum',
    };
  }

  const margin = second ? best.score - second.score : best.score;
  if (second && margin < TASK_RESOLVE_SCORE_MARGIN) {
    return {
      status: 'ambiguous',
      candidates: [best.task, second.task],
      bestScore: best.score,
      secondBestScore: second.score,
      scoreMargin: margin,
      candidateCountBeforeTruncation,
      resolutionReason: 'ambiguous_close_scores',
    };
  }

  return {
    status: 'resolved',
    taskId: best.task.id,
    canonicalReference: best.task.reference,
    bestScore: best.score,
    secondBestScore: second?.score ?? null,
    scoreMargin: margin,
    candidateCountBeforeTruncation,
    resolutionReason: 'score_above_margin',
    resolutionSource: best.resolutionSource,
  };
}

export class TaskContextResolverService {
  resolveTaskSignals(
    signals: ExtractedTaskSignal[],
    fullContext: IngestionContext,
  ): TaskSignalContextResolution[] {
    const routing = fullContext.sourceMetadata.routing;
    const allTasks = fullContext.openTasks;

    return signals.map((signal, taskSignalIndex) => {
      const ref = signal.task_reference?.trim() ?? '';
      const needsResolve =
        signal.operation !== 'create' &&
        (!ref || this.isVagueReference(ref, allTasks));

      if (!needsResolve && ref) {
        return {
          taskSignalIndex,
          operation: signal.operation,
          outcome: resolveTaskReferenceAgainstContext(ref, allTasks, routing),
        };
      }

      if (signal.operation === 'create') {
        return {
          taskSignalIndex,
          operation: signal.operation,
          outcome: {
            status: 'unresolved',
            bestScore: 0,
            secondBestScore: null,
            scoreMargin: null,
            candidateCountBeforeTruncation: allTasks.length,
            resolutionReason: 'no_plausible_candidate',
          },
        };
      }

      const query = ref || signal.title?.trim() || signal.source_excerpt;
      const outcome = resolveTaskReferenceAgainstContext(query, allTasks, routing);
      return { taskSignalIndex, operation: signal.operation, outcome };
    });
  }

  private isVagueReference(ref: string, tasks: TaskContext[]): boolean {
    if (findExplicitMatch(ref, tasks)) return false;
    const plausible = tasks.filter(
      (t) => scoreTaskCandidate(ref, t, {}).score >= TASK_RESOLVE_MIN_SCORE,
    );
    return plausible.length !== 1;
  }
}
