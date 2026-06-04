import type { ExtractorOutputV14 } from '../../openai/extractor-v1.4.types.js';
import type { CompiledClarificationCandidateV2, CompiledMemoryV2 } from '../../types/memory-compiler-v2.js';
import type { CompilerDecisionStatus } from '../../types/memory-compiler-v2.js';
import { matchesMustNotEntityMention } from './entity-mention-match.js';
import type { FinalClarificationDecision } from '../../services/clarification-manager-v2.service.js';
import type { V14CalibrationExpectations } from './fixed-calibration-expectations.js';

export interface V14CaseEvaluationResult {
  scenario_id: string;
  passed: boolean;
  failures: string[];
}

export interface EvaluateV2CaseOptions {
  category?: string;
  recommended?: CompiledClarificationCandidateV2[];
  extractorOutput?: ExtractorOutputV14;
  finalDecision?: FinalClarificationDecision;
}

const EPISODIC_CONFIRMATION_EVENT_KINDS = new Set(['confirmation', 'document_sent']);

function isBlockingClarification(c: CompiledClarificationCandidateV2): boolean {
  return c.blockingScope !== 'none' && c.priority !== 'low';
}

function primaryContractSatisfied(
  compiled: CompiledMemoryV2,
  expected: V14CalibrationExpectations,
): boolean {
  for (const kind of expected.must_have?.event_kinds ?? []) {
    if (!compiled.events.some((e) => e.eventKind === kind)) return false;
  }
  for (const kind of expected.must_have?.assertion_kinds ?? []) {
    if (!compiled.assertions.some((a) => a.assertionKind === kind)) return false;
  }
  for (const op of expected.must_have?.task_operations ?? []) {
    if (!compiled.tasks.some((t) => t.operation === op)) return false;
  }
  for (const target of expected.must_have?.alias_targets ?? []) {
    if (
      !compiled.aliases.some(
        (a) => a.targetReference.includes(target) || a.targetCanonicalName === target,
      )
    ) {
      return false;
    }
  }
  return true;
}

function decisionMatches(
  compiled: CompiledMemoryV2,
  expected: CompilerDecisionStatus | undefined,
  recommended: CompiledClarificationCandidateV2[],
  finalDecision?: FinalClarificationDecision,
): boolean {
  if (!expected) return true;

  const effectiveStatus = finalDecision?.status ?? compiled.decision.status;
  if (effectiveStatus === expected) return true;

  if (expected !== 'accepted' || effectiveStatus !== 'needs_clarification') {
    return false;
  }

  const blockingCount = finalDecision?.blockingCount ?? recommended.filter(isBlockingClarification).length;
  if (blockingCount > 0) return false;
  return primaryContractSatisfied(compiled, { decision: expected });
}

export function evaluateV2Case(
  scenarioId: string,
  compiled: CompiledMemoryV2,
  recommendedClarifications: number,
  expected: V14CalibrationExpectations,
  options?: EvaluateV2CaseOptions,
): V14CaseEvaluationResult {
  const failures: string[] = [];
  const recommended = options?.recommended ?? [];

  const category = options?.category;
  for (const kind of expected.must_have?.event_kinds ?? []) {
    const found =
      category === 'episodic_confirmation' && kind === 'confirmation'
        ? compiled.events.some((e) => EPISODIC_CONFIRMATION_EVENT_KINDS.has(e.eventKind))
        : compiled.events.some((e) => e.eventKind === kind);
    if (!found) {
      failures.push(`must_have event_kind ${kind}`);
    }
  }

  for (const target of expected.must_have?.alias_targets ?? []) {
    if (!compiled.aliases.some((a) => a.targetReference.includes(target) || a.targetCanonicalName === target)) {
      failures.push(`must_have alias_target ${target}`);
    }
  }

  for (const kind of expected.must_have?.assertion_kinds ?? []) {
    if (!compiled.assertions.some((a) => a.assertionKind === kind)) {
      failures.push(`must_have assertion_kind ${kind}`);
    }
  }

  const taskOps = expected.must_have?.task_operations ?? [];
  if (taskOps.length > 0) {
    for (const op of taskOps) {
      if (!compiled.tasks.some((t) => t.operation === op)) {
        failures.push(`must_have task_operation ${op}`);
      }
    }
  }

  for (const kind of expected.must_not_have?.event_kinds ?? []) {
    if (compiled.events.some((e) => e.eventKind === kind)) {
      failures.push(`must_not_have event_kind ${kind}`);
    }
  }

  for (const mention of expected.must_not_have?.entity_mentions ?? []) {
    if (
      compiled.resolvedEntities.some((e) => matchesMustNotEntityMention(e.mentionText, mention))
    ) {
      failures.push(`must_not_have entity_mention ${mention}`);
    }
  }

  if (
    expected.decision &&
    !decisionMatches(compiled, expected.decision, recommended, options?.finalDecision)
  ) {
    const got = options?.finalDecision?.status ?? compiled.decision.status;
    failures.push(`decision expected ${expected.decision} got ${got}`);
  }

  if (expected.min_clarifications != null && recommendedClarifications < expected.min_clarifications) {
    failures.push(
      `min_clarifications ${expected.min_clarifications} got ${recommendedClarifications}`,
    );
  }

  for (const issue of expected.must_not_have?.blocking_clarification_issue_types ?? []) {
    if (recommended.some((c) => isBlockingClarification(c) && c.issueType === issue)) {
      failures.push(`must_not_have blocking clarification ${issue}`);
    }
  }

  if (expected.must_have?.context_resolution === 'auto') {
    if (compiled.contextResolutionEvidence.length === 0) {
      failures.push('must_have context_resolution auto (no evidence)');
    }
  }

  if (expected.must_have?.context_resolution === 'ambiguous') {
    if (
      !recommended.some(
        (c) => isBlockingClarification(c) && c.issueType === 'ambiguous_task_reference',
      )
    ) {
      failures.push('must_have ambiguous_task_reference blocking clarification');
    }
  }

  const output = options?.extractorOutput;
  if (output && taskOps.length > 0) {
    for (const op of taskOps) {
      if (!(output.task_signals ?? []).some((s) => s.operation === op)) {
        failures.push(`extractor must emit task_signal ${op}`);
      }
    }
  }

  const temporalExp = expected.due_at_temporal;
  if (temporalExp) {
    const taskWithDue = compiled.tasks.find((t) => t.dueAt?.trim());
    if (!taskWithDue) {
      failures.push('due_at_temporal expected but no compiled task with dueAt');
    } else if (!taskWithDue.dueAtTemporal) {
      failures.push('due_at_temporal expected but dueAtTemporal is null');
    } else {
      const t = taskWithDue.dueAtTemporal;
      if (temporalExp.status != null && t.status !== temporalExp.status) {
        failures.push(`due_at_temporal.status expected ${temporalExp.status} got ${t.status}`);
      }
      if (temporalExp.localDate !== undefined && t.localDate !== temporalExp.localDate) {
        failures.push(
          `due_at_temporal.localDate expected ${temporalExp.localDate} got ${t.localDate}`,
        );
      }
      if (temporalExp.precision != null && t.precision !== temporalExp.precision) {
        failures.push(
          `due_at_temporal.precision expected ${temporalExp.precision} got ${t.precision}`,
        );
      }
      if (temporalExp.instantNull && t.instant != null) {
        failures.push('due_at_temporal.instant expected null');
      }
      if (temporalExp.instantPresent && t.instant == null) {
        failures.push('due_at_temporal.instant expected non-null');
      }
      if (temporalExp.reasonCode != null && t.reasonCode !== temporalExp.reasonCode) {
        failures.push(
          `due_at_temporal.reasonCode expected ${temporalExp.reasonCode} got ${t.reasonCode}`,
        );
      }
      if (
        temporalExp.normalizerVersion != null &&
        t.normalizerVersion !== temporalExp.normalizerVersion
      ) {
        failures.push(
          `due_at_temporal.normalizerVersion expected ${temporalExp.normalizerVersion} got ${t.normalizerVersion}`,
        );
      }
    }
  }

  return {
    scenario_id: scenarioId,
    passed: failures.length === 0,
    failures,
  };
}
