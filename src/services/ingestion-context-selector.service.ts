import type { ExtractorOutputV14 } from '../openai/extractor-v1.4.types.js';
import type {
  CompactIngestionContext,
  IngestionContext,
  ProjectContext,
  TaskContext,
} from '../types/ingestion-context.js';
import { normalizeText } from '../utils/normalize.js';

const MAX_OPEN_TASKS = 8;
const MAX_ACTIVE_PROJECTS = 4;

function collectQueryTerms(output: ExtractorOutputV14, effectiveInput: string): Set<string> {
  const terms = new Set<string>();
  const add = (t: string | null | undefined) => {
    if (t?.trim()) terms.add(normalizeText(t));
  };

  for (const s of output.task_signals ?? []) {
    add(s.task_reference);
    add(s.title);
    add(s.project_reference);
  }
  for (const a of output.assertions) {
    add(a.subject_reference);
    add(a.object_reference);
  }

  for (const word of normalizeText(effectiveInput).split(/\s+/)) {
    if (word.length >= 3) terms.add(word);
  }

  return terms;
}

function taskRelevance(
  task: TaskContext,
  terms: Set<string>,
  threadRef?: string,
  subject?: string,
): number {
  let score = 0;
  const ref = normalizeText(task.reference);
  for (const t of terms) {
    if (ref.includes(t) || t.includes(ref)) score += 1;
  }
  if (threadRef && task.threadReferences?.some((tr) => normalizeText(tr) === normalizeText(threadRef))) {
    score += 2;
  }
  if (subject && tokenOverlap(subject, task.reference) > 0.2) {
    score += 1;
  }
  return score;
}

function tokenOverlap(a: string, b: string): number {
  const ta = new Set(normalizeText(a).split(/\s+/).filter((x) => x.length >= 2));
  const tb = new Set(normalizeText(b).split(/\s+/).filter((x) => x.length >= 2));
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) {
    if (tb.has(t)) inter += 1;
  }
  return inter / Math.max(ta.size, tb.size);
}

function projectRelevance(project: ProjectContext, terms: Set<string>): number {
  const ref = normalizeText(project.reference);
  let score = 0;
  for (const t of terms) {
    if (ref.includes(t) || t.includes(ref)) score += 1;
  }
  return score;
}

/**
 * v1 enxuto: openTasks, activeProjects, routing signals for ranking only.
 * TaskContextResolver MUST use full context before this truncation runs.
 */
export class IngestionContextSelectorService {
  selectCompact(
    full: IngestionContext,
    output: ExtractorOutputV14,
    effectiveInput: string,
  ): CompactIngestionContext {
    const terms = collectQueryTerms(output, effectiveInput);
    const threadRef =
      full.sourceMetadata.routing.thread_reference ??
      full.sourceMetadata.routing.reply_to_reference;
    const subject = full.sourceMetadata.routing.subject;

    const rankedTasks = [...full.openTasks]
      .map((t) => ({
        task: t,
        score: taskRelevance(t, terms, threadRef, subject),
      }))
      .sort((a, b) => b.score - a.score);

    const openTasks =
      rankedTasks.some((r) => r.score > 0)
        ? rankedTasks
            .filter((r) => r.score > 0)
            .slice(0, MAX_OPEN_TASKS)
            .map((r) => r.task)
        : full.openTasks.slice(0, MAX_OPEN_TASKS);

    const rankedProjects = [...full.activeProjects]
      .map((p) => ({ project: p, score: projectRelevance(p, terms) }))
      .sort((a, b) => b.score - a.score);

    const activeProjects =
      rankedProjects.some((r) => r.score > 0)
        ? rankedProjects
            .filter((r) => r.score > 0)
            .slice(0, MAX_ACTIVE_PROJECTS)
            .map((r) => r.project)
        : full.activeProjects.slice(0, MAX_ACTIVE_PROJECTS);

    return {
      activeProjects,
      openTasks,
      activeAliases: full.activeAliases,
      recentEntities: full.recentEntities,
      recentAssertions: full.recentAssertions,
      recentEvents: full.recentEvents,
      sourceMetadata: full.sourceMetadata,
    };
  }
}
