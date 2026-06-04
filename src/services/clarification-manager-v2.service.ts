import type { ExtractorOutputV14 } from '../openai/extractor-v1.4.types.js';
import type {
  CompiledClarificationCandidateV2,
  CompiledMemoryV2,
  CompilerFlagsV2,
} from '../types/memory-compiler-v2.js';
import type {
  CalibrationRegime,
  CompactIngestionContext,
  ContextResolutionEvidence,
  TaskSignalContextResolution,
} from '../types/ingestion-context.js';
import type { MemoryResolverResult } from './reference-resolver.service.js';
import { isMvpRegistryEligibleReference } from '../config/mvp-registry-policy.js';
import { normalizeText } from '../utils/normalize.js';

const SECONDARY_DETAIL =
  /\b(telefone|e-mail|email|endereço|responsável secundário|contexto adicional)\b/i;

const SECONDARY_TOPIC_TYPE =
  /\b(financeiro|engenharia|comercial|jurídico|rh|marketing)\b/i;

const VAR_NOISE = /\(var\s+\d+\)/i;

const TASK_OPEN_SECONDARY_ISSUES = new Set([
  'missing_assignee',
  'ambiguous_due_date',
  'unclear_due_date',
  'missing_information',
  'missing_context',
  'ambiguous_deadline',
]);

const CREATE_ENRICHMENT_ISSUES = new Set([
  'missing_due_date',
  'missing_assignee',
  'missing_assignee_or_due_date',
]);

const TASK_BLOCKED_SECONDARY_ISSUES = new Set([
  'missing_approver',
  'missing_assignee_or_approver',
]);

const PROJECT_STATUS_SECONDARY_ISSUES = new Set([
  'missing_responsible',
  'missing_owner',
  'severity_and_actions',
  'missing_mitigation',
  'unclear_risk',
  'unknown_risk',
  'ambiguous_status',
  'missing_details',
  'especificar_impacto',
]);

export type ClarificationMateriality = 'blocking' | 'non_blocking' | 'discarded';

export interface ClassifiedClarificationV2 extends CompiledClarificationCandidateV2 {
  materiality: ClarificationMateriality;
}

export interface ClarificationManagerV2Result {
  blocking: ClassifiedClarificationV2[];
  nonBlocking: ClassifiedClarificationV2[];
  discarded: ClassifiedClarificationV2[];
}

export interface FinalClarificationDecision {
  status: 'accepted' | 'needs_clarification';
  blockingCount: number;
  nonBlockingCount: number;
  discardedCount: number;
}

export interface ClarificationManagerV2Input {
  llmCandidates: CompiledClarificationCandidateV2[];
  compilerCandidates: CompiledClarificationCandidateV2[];
  resolverResult: MemoryResolverResult;
  flags: CompilerFlagsV2;
  extractorOutput?: ExtractorOutputV14;
  compiled?: Pick<CompiledMemoryV2, 'tasks' | 'assertions' | 'events'>;
  effectiveInput?: string;
  ingestionContext?: CompactIngestionContext;
  taskSignalResolutions?: TaskSignalContextResolution[];
  contextResolutionEvidence?: ContextResolutionEvidence[];
  regime?: CalibrationRegime;
}

/**
 * Materiality for update_due_date with context resolution:
 * - due_at literal (e.g. "sexta-feira") is preserved on CompiledTaskV2.dueAt as emitted.
 * - ambiguous_date → non_blocking when task is context-resolved and due_at is present.
 * - Absolute timestamp normalization is a future deterministic step; CM does not invent dates.
 */
export class ClarificationManagerV2Service {
  classify(input: ClarificationManagerV2Input): ClarificationManagerV2Result {
    const merged = [...input.compilerCandidates, ...input.llmCandidates];
    const seen = new Set<string>();
    const blocking: ClassifiedClarificationV2[] = [];
    const nonBlocking: ClassifiedClarificationV2[] = [];
    const discarded: ClassifiedClarificationV2[] = [];

    for (const c of merged) {
      const key = `${c.issueType}:${normalizeText(c.targetReference)}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const classified: ClassifiedClarificationV2 = { ...c, materiality: 'blocking' };

      if (this.shouldDiscard(c, input)) {
        classified.materiality = 'discarded';
        discarded.push(classified);
        continue;
      }

      if (this.isNonBlockingMateriality(c, input)) {
        classified.materiality = 'non_blocking';
        nonBlocking.push(classified);
        continue;
      }

      blocking.push(classified);
    }

    return { blocking, nonBlocking, discarded };
  }

  recommend(input: ClarificationManagerV2Input): CompiledClarificationCandidateV2[] {
    return this.classify(input).blocking;
  }

  computeFinalDecision(result: ClarificationManagerV2Result): FinalClarificationDecision {
    const materialBlocking = result.blocking.filter((c) => this.isMaterialBlocking(c));
    return {
      status: materialBlocking.length > 0 ? 'needs_clarification' : 'accepted',
      blockingCount: materialBlocking.length,
      nonBlockingCount: result.nonBlocking.length,
      discardedCount: result.discarded.length,
    };
  }

  private isMaterialBlocking(c: CompiledClarificationCandidateV2): boolean {
    return c.blockingScope !== 'none' && c.priority !== 'low';
  }

  private isRegistrableCreate(input: ClarificationManagerV2Input): boolean {
    const hasCompiledCreate = input.compiled?.tasks.some(
      (t) => t.operation === 'create' && Boolean(t.title?.trim()),
    );
    const hasSignalCreate = input.extractorOutput?.task_signals?.some(
      (s) => s.operation === 'create' && Boolean(s.title?.trim()),
    );
    return Boolean(hasCompiledCreate || hasSignalCreate);
  }

  private isContextResolvedDueDateUpdate(input: ClarificationManagerV2Input): boolean {
    const hasEvidence = (input.contextResolutionEvidence?.length ?? 0) > 0;
    const resolvedDueDate = input.taskSignalResolutions?.some(
      (r) => r.operation === 'update_due_date' && r.outcome.status === 'resolved',
    );
    const compiledDueAt = input.compiled?.tasks.some(
      (t) => t.operation === 'update_due_date' && Boolean(t.dueAt?.trim()),
    );
    const signalDueAt = input.extractorOutput?.task_signals?.some(
      (s) => s.operation === 'update_due_date' && Boolean(s.due_at?.trim()),
    );
    return Boolean(hasEvidence && resolvedDueDate && (compiledDueAt || signalDueAt));
  }

  private isNonBlockingMateriality(
    c: CompiledClarificationCandidateV2,
    input: ClarificationManagerV2Input,
  ): boolean {
    if (
      c.blockingScope === 'knowledge_confirmation' &&
      (c.issueType === 'ambiguous_entity_identity' || c.issueType === 'ambiguous_entity_type') &&
      input.extractorOutput &&
      !isMvpRegistryEligibleReference(c.targetReference, input.extractorOutput)
    ) {
      return true;
    }

    if (this.isRegistrableCreate(input) && CREATE_ENRICHMENT_ISSUES.has(c.issueType)) {
      return true;
    }

    if (c.issueType === 'ambiguous_date' && this.isContextResolvedDueDateUpdate(input)) {
      return true;
    }

    if (c.issueType === 'unclear_scope' && this.isUnclearScopeEnrichmentForCreate(c, input)) {
      return true;
    }

    if (this.isStatusUpdateClarificationNonBlocking(c, input)) {
      return true;
    }

    return false;
  }

  /**
   * status_update registrável: ambiguous_date, unclear_scope e other (enrichment)
   * não bloqueiam ingestão do fato principal.
   */
  private isStatusUpdateClarificationNonBlocking(
    c: CompiledClarificationCandidateV2,
    input: ClarificationManagerV2Input,
  ): boolean {
    const enrichmentIssues = new Set(['ambiguous_date', 'unclear_scope', 'other']);
    if (!enrichmentIssues.has(c.issueType)) return false;
    if (!this.isRegistrableStatusUpdate(input)) return false;
    if (this.hasStatusUpdateMaterialBlockers(input)) return false;
    return true;
  }

  private hasStatusUpdateMaterialBlockers(input: ClarificationManagerV2Input): boolean {
    const allCandidates = [...input.compilerCandidates, ...input.llmCandidates];
    const registryIdentityIssues = new Set([
      'ambiguous_entity_identity',
      'ambiguous_entity_type',
    ]);
    if (
      allCandidates.some(
        (cl) =>
          cl.issueType === 'ambiguous_identity' ||
          (registryIdentityIssues.has(cl.issueType) &&
            input.extractorOutput != null &&
            isMvpRegistryEligibleReference(cl.targetReference, input.extractorOutput)),
      )
    ) {
      return true;
    }
    const otherBlockingIssueTypes = new Set([
      'possible_contradiction',
      'missing_external_action_target',
      'status_update_missing_value',
    ]);
    if (allCandidates.some((cl) => otherBlockingIssueTypes.has(cl.issueType))) {
      return true;
    }
    if (this.hasImmediateExternalAction(input)) return true;
    if (this.hasConflictingAlias(input)) return true;
    if (this.hasAmbiguousTaskReferenceContext(input)) return true;
    if (this.hasNonCreateTaskOperation(input)) return true;
    return false;
  }

  private isRegistrableStatusUpdate(input: ClarificationManagerV2Input): boolean {
    const compiledOk = input.compiled?.assertions.some(
      (a) =>
        a.assertionKind === 'status_update' &&
        Boolean(a.subjectReference?.trim()) &&
        Boolean(a.predicate?.trim()) &&
        Boolean(a.valueText?.trim()),
    );
    const extractorOk = input.extractorOutput?.assertions.some(
      (a) =>
        a.assertion_kind === 'status_update' &&
        Boolean(a.subject_reference?.trim()) &&
        Boolean(a.predicate?.trim()) &&
        Boolean(a.value_text?.trim()),
    );
    return Boolean(compiledOk || extractorOk);
  }

  /** unclear_scope → non_blocking only for registrable create without material blockers. */
  private isUnclearScopeEnrichmentForCreate(
    c: CompiledClarificationCandidateV2,
    input: ClarificationManagerV2Input,
  ): boolean {
    if (c.issueType !== 'unclear_scope') return false;
    if (!this.isRegistrableCreate(input)) return false;
    if (this.hasNonCreateTaskOperation(input)) return false;
    if (this.hasImmediateExternalAction(input)) return false;
    if (this.hasMaterialIdentityConflict(input)) return false;
    if (this.hasConflictingAlias(input)) return false;
    if (this.hasOpenMaterialContradiction(input)) return false;
    if (this.hasAmbiguousTaskReferenceContext(input)) return false;
    return true;
  }

  private hasNonCreateTaskOperation(input: ClarificationManagerV2Input): boolean {
    const compiledNonCreate = input.compiled?.tasks.some((t) => t.operation !== 'create');
    const signalNonCreate = input.extractorOutput?.task_signals?.some(
      (s) => s.operation !== 'create',
    );
    return Boolean(compiledNonCreate || signalNonCreate);
  }

  private hasImmediateExternalAction(input: ClarificationManagerV2Input): boolean {
    const allCandidates = [...input.compilerCandidates, ...input.llmCandidates];
    if (
      allCandidates.some(
        (cl) =>
          cl.blockingScope === 'external_action' ||
          cl.targetType === 'external_action' ||
          cl.issueType === 'missing_external_action_target',
      )
    ) {
      return true;
    }
    const output = input.extractorOutput;
    if (!output) return false;
    return output.events.some((e) =>
      ['document_sent', 'email_sent', 'message_sent'].includes(e.event_kind),
    );
  }

  private hasMaterialIdentityConflict(input: ClarificationManagerV2Input): boolean {
    const allCandidates = [...input.compilerCandidates, ...input.llmCandidates];
    if (
      allCandidates.some(
        (cl) =>
          cl.issueType === 'ambiguous_identity' ||
          ((cl.issueType === 'ambiguous_entity_identity' ||
            cl.issueType === 'ambiguous_entity_type') &&
            input.extractorOutput != null &&
            isMvpRegistryEligibleReference(cl.targetReference, input.extractorOutput)),
      )
    ) {
      return true;
    }
    const output = input.extractorOutput;
    if (!output) return false;
    return output.review_hints.some(
      (h) =>
        (h.issue_type === 'ambiguous_identity' || h.issue_type === 'ambiguous_entity_type') &&
        h.confidence >= 0.45,
    );
  }

  private hasConflictingAlias(input: ClarificationManagerV2Input): boolean {
    if (input.flags.negatedReferences.length > 0 || input.flags.supersededReferences.length > 0) {
      return true;
    }
    const output = input.extractorOutput;
    if (!output) return false;
    if (output.aliases.some((a) => a.negated_former_references.length > 0)) return true;
    return output.correction_signals.some((s) => s.correction_type === 'invalidate_alias');
  }

  private hasOpenMaterialContradiction(input: ClarificationManagerV2Input): boolean {
    const allCandidates = [...input.compilerCandidates, ...input.llmCandidates];
    if (allCandidates.some((cl) => cl.issueType === 'possible_contradiction')) {
      return true;
    }
    const output = input.extractorOutput;
    if (!output) return false;
    return output.review_hints.some(
      (h) => h.issue_type === 'possible_contradiction' && h.confidence >= 0.45,
    );
  }

  private hasAmbiguousTaskReferenceContext(input: ClarificationManagerV2Input): boolean {
    if (input.taskSignalResolutions?.some((r) => r.outcome.status === 'ambiguous')) {
      return true;
    }
    const allCandidates = [...input.compilerCandidates, ...input.llmCandidates];
    return allCandidates.some((cl) => cl.issueType === 'ambiguous_task_reference');
  }

  private hasPrimaryTaskSignal(output: ExtractorOutputV14): boolean {
    return output.task_signals?.some((s) => {
      switch (s.operation) {
        case 'create':
          return Boolean(s.title?.trim());
        case 'update_due_date':
          return Boolean(s.task_reference?.trim() && s.due_at?.trim());
        case 'update_assignee':
          return Boolean(s.task_reference?.trim() && s.assignee_reference?.trim());
        case 'update_blocker':
          return Boolean(s.task_reference?.trim() && s.blocked_reason?.trim());
        case 'complete':
        case 'cancel':
        case 'update_status':
          return Boolean(s.task_reference?.trim());
        default:
          return false;
      }
    });
  }

  private shouldDiscard(
    c: CompiledClarificationCandidateV2,
    input: ClarificationManagerV2Input,
  ): boolean {
    const refNorm = normalizeText(c.targetReference);

    if (input.flags.negatedReferences.some((n) => refNorm === n || refNorm === normalizeText(n))) {
      return true;
    }

    if (input.flags.supersededReferences.some((n) => refNorm === n || refNorm === normalizeText(n))) {
      return true;
    }

    const output = input.extractorOutput;
    if (output) {
      for (const sig of output.correction_signals) {
        if (sig.current_reference && normalizeText(sig.current_reference) === refNorm) {
          return true;
        }
        if (
          sig.previous_reference &&
          normalizeText(sig.previous_reference) === refNorm &&
          sig.current_reference
        ) {
          return true;
        }
      }

      const onlyPrevious = output.correction_signals.some(
        (s) =>
          s.previous_reference &&
          normalizeText(s.previous_reference) === refNorm &&
          !output.events.some((e) =>
            e.related_entities.some(
              (r) => normalizeText(r.entity_reference) === refNorm,
            ),
          ) &&
          !output.assertions.some(
            (a) =>
              normalizeText(a.subject_reference) === refNorm ||
              (a.object_reference && normalizeText(a.object_reference) === refNorm),
          ),
      );
      if (onlyPrevious) return true;
    }

    const resolved = input.resolverResult.byReferenceText.get(c.targetReference);
    if (
      resolved?.status === 'resolved' &&
      (c.issueType === 'ambiguous_entity_type' ||
        c.issueType === 'ambiguous_identity' ||
        c.issueType === 'ambiguous_entity_identity')
    ) {
      return true;
    }

    if (SECONDARY_DETAIL.test(`${c.question} ${c.reason}`)) {
      return true;
    }

    if (
      (c.issueType === 'ambiguous_entity_type' || c.issueType === 'missing_context') &&
      SECONDARY_TOPIC_TYPE.test(`${c.targetReference} ${c.question} ${c.reason}`)
    ) {
      return true;
    }

    if (VAR_NOISE.test(`${c.question} ${c.reason}`) || (input.effectiveInput && VAR_NOISE.test(input.effectiveInput))) {
      return true;
    }

    const hasCompiledTasks = (input.compiled?.tasks?.length ?? 0) > 0;
    const hasTaskSignals = output ? this.hasPrimaryTaskSignal(output) : false;
    const primaryTaskPresent = hasCompiledTasks || hasTaskSignals;

    const anyContextResolved = input.taskSignalResolutions?.some(
      (r) => r.outcome.status === 'resolved',
    );
    if (anyContextResolved) {
      if (
        c.issueType === 'missing_task_reference' ||
        c.issueType === 'ambiguous_task_reference' ||
        TASK_OPEN_SECONDARY_ISSUES.has(c.issueType) ||
        c.issueType === 'ambiguous_due_date' ||
        c.issueType === 'unclear_due_date'
      ) {
        return true;
      }
    }

    if (
      input.taskSignalResolutions?.some((r) => r.outcome.status === 'ambiguous') &&
      c.issueType === 'ambiguous_task_reference'
    ) {
      return false;
    }

    if (
      input.regime === 'first_contact' &&
      (input.compiled?.tasks.some((t) => t.operation === 'create') ||
        (input.compiled?.assertions?.length ?? 0) > 0 ||
        output?.task_signals?.some((s) => s.operation === 'create'))
    ) {
      if (
        TASK_OPEN_SECONDARY_ISSUES.has(c.issueType) ||
        PROJECT_STATUS_SECONDARY_ISSUES.has(c.issueType) ||
        c.issueType === 'missing_responsible'
      ) {
        return true;
      }
    }

    if (primaryTaskPresent && TASK_OPEN_SECONDARY_ISSUES.has(c.issueType)) {
      const isCreateOrOpen =
        input.compiled?.tasks.some((t) => t.operation === 'create') ||
        output?.task_signals?.some((s) => s.operation === 'create');
      if (isCreateOrOpen || c.priority !== 'high') {
        return true;
      }
    }

    if (primaryTaskPresent && TASK_BLOCKED_SECONDARY_ISSUES.has(c.issueType)) {
      const isBlocker =
        input.compiled?.tasks.some((t) => t.operation === 'update_blocker') ||
        output?.task_signals?.some((s) => s.operation === 'update_blocker');
      if (isBlocker) return true;
    }

    if (
      input.compiled?.assertions?.some((a) => a.assertionKind === 'status_update') &&
      (PROJECT_STATUS_SECONDARY_ISSUES.has(c.issueType) ||
        c.issueType === 'missing_responsible' ||
        c.issueType === 'missing_context')
    ) {
      return true;
    }

    if (
      output &&
      output.assertions.length > 0 &&
      c.issueType === 'unresolved_reference' &&
      c.blockingScope === 'none'
    ) {
      return true;
    }

    if (
      output &&
      output.correction_signals.some((s) => s.correction_type === 'replace_subject') &&
      (c.issueType === 'participant_conflict' || c.reason.includes('correction'))
    ) {
      return true;
    }

    if (c.blockingScope === 'none' && c.priority === 'low') {
      return true;
    }

    if (c.issueType === 'missing_context' && c.priority === 'low') {
      return true;
    }

    return false;
  }
}
