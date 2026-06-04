import type { ClarificationsRepository } from '../repositories/clarifications.repository.js';
import type { ExtractedClarification } from '../types/domain.js';
import type { UncertaintyGap } from './uncertainty-aggregator.js';

function gapToClarification(gap: UncertaintyGap): ExtractedClarification {
  const issueType: ExtractedClarification['issue_type'] =
    gap.kind === 'temporal'
      ? 'missing_date'
      : gap.kind === 'unresolved_entity'
        ? 'ambiguous_entity_type'
        : 'other';

  return {
    target_type: gap.kind === 'temporal' ? 'event' : gap.kind === 'assignee_or_due' ? 'task' : 'entity',
    target_reference: gap.target_reference,
    issue_type: issueType,
    question: gap.question,
    reason: `assistant_ephemeral_gap:${gap.kind}`,
    priority: 'medium',
    blocking_scope: 'none',
    suggested_answers: gap.suggested_answers,
    source_excerpt: gap.source_excerpt,
  };
}

export async function persistEphemeralUncertaintyGaps(
  clarificationsRepo: ClarificationsRepository,
  inboxItemId: string,
  extractionRunId: string | null,
  gaps: UncertaintyGap[],
): Promise<void> {
  const ephemeral = gaps.filter((g) => !g.clarification_id);
  if (!ephemeral.length) return;

  const items = ephemeral.map(gapToClarification);
  await clarificationsRepo.createManyCandidates(inboxItemId, extractionRunId, items);
}
