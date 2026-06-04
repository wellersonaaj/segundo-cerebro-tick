import type { ExtractorOutput } from '../../types/domain.js';
import {
  applyBootstrapAssertionReview,
  mergeBootstrapAssertionReview,
} from '../../services/bootstrap-assertion-review.js';
import {
  applyPostResolutionSanitization,
  filterClarificationsAfterResolution,
} from '../../services/extraction-sanitizer.service.js';
import type { ResolvedEntityMap } from '../../services/memory-resolver.service.js';

export function buildCurrentOutput(
  output: ExtractorOutput,
  resolvedMap: ResolvedEntityMap,
  sourceChannel: string,
): ExtractorOutput {
  const clarificationFilter = filterClarificationsAfterResolution(
    output.clarification_requests,
    resolvedMap,
    resolvedMap.resolutions,
  );
  const sanitized = applyPostResolutionSanitization(output, resolvedMap, clarificationFilter);
  const review = applyBootstrapAssertionReview(sourceChannel, sanitized);
  return mergeBootstrapAssertionReview(sanitized, review);
}

export function viewForEvaluation(output: ExtractorOutput): Record<string, string[]> {
  return {
    entities: output.entities.map((e) => e.name),
    events: output.events.map((e) => e.event_type),
    event_descriptions: output.events.map((e) => e.description),
    aliases: output.entities.flatMap((e) => e.aliases ?? []),
    tasks: output.tasks.map((t) => t.title),
    clarifications: output.clarification_requests.map((c) => c.question),
    assertions: output.assertions.map((a) => a.content),
  };
}
