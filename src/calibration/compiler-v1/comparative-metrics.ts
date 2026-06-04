import type { CompiledExtraction } from '../../types/memory-compiler.js';
import type { CalibrationCase } from './types.js';
import type { ExtractorOutput } from '../../types/domain.js';
import { viewForEvaluation } from './build-current-output.js';

export type ComparativeCategory =
  | 'bootstrap_panorama'
  | 'static_preferences'
  | 'episodic'
  | 'passive_email'
  | 'tasks'
  | 'aliases'
  | 'negations'
  | 'corrections'
  | 'ambiguities'
  | 'other';

export function mapToComparativeCategory(category: string): ComparativeCategory {
  if (category.startsWith('bootstrap')) return 'bootstrap_panorama';
  if (category === 'static_preferences') return 'static_preferences';
  if (category.startsWith('episodic')) return 'episodic';
  if (category === 'passive_email') return 'passive_email';
  if (category.startsWith('task')) return 'tasks';
  if (category.includes('alias')) return 'aliases';
  if (category.includes('negation')) return 'negations';
  if (category.includes('correction') || category.includes('reprocess')) return 'corrections';
  if (category.includes('ambiguous')) return 'ambiguities';
  return 'other';
}

export interface MetricSlice {
  current: number;
  compiled: number;
  absolute_diff: number;
  percent_diff: number | null;
}

function slice(current: number, compiled: number): MetricSlice {
  const absolute_diff = compiled - current;
  const percent_diff =
    current === 0 ? (compiled === 0 ? 0 : null) : Math.round((absolute_diff / current) * 1000) / 10;
  return { current, compiled, absolute_diff, percent_diff };
}

export function buildComparativeMetrics(
  testCase: CalibrationCase,
  current: ExtractorOutput,
  compiled: CompiledExtraction,
): Record<string, MetricSlice> {
  const cur = viewForEvaluation(current);
  const comp = {
    entities: compiled.entities.length,
    events: compiled.events.length,
    assertions: compiled.assertions.length,
    tasks: compiled.tasks.length,
    clarifications: compiled.clarificationCandidates.length,
    aliases: compiled.aliases.length,
    dropped: compiled.droppedArtifacts.length,
  };

  return {
    entity_count: slice((cur.entities as string[]).length, comp.entities),
    event_count: slice((cur.events as string[]).length, comp.events),
    assertion_count: slice((cur.assertions as string[]).length, comp.assertions),
    task_count: slice((cur.tasks as string[]).length, comp.tasks),
    clarification_count: slice((cur.clarifications as string[]).length, comp.clarifications),
    alias_count: slice((cur.aliases as string[]).length, comp.aliases),
  };
}
