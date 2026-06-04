import type { ExtractorOutputV14, TaskOperation } from '../../openai/extractor-v1.4.types.js';
import { isAllowedSourceBlockReference } from '../../openai/source-block-reference.js';
import type { CompiledMemoryV2 } from '../../types/memory-compiler-v2.js';
import { listSourceBlockIds } from '../../utils/source-blocks.js';
import { evaluateV2Case } from './evaluate-v2-case.js';
import {
  isEntityPrecisionApplicable,
  matchesMustNotEntityMention,
} from './entity-mention-match.js';
import type { V14CalibrationExpectations } from './fixed-calibration-expectations.js';
import { V14_LIVE_VARIATIONS } from './live-variations.js';
import { ClarificationManagerV2Service } from '../../services/clarification-manager-v2.service.js';
import { MemoryCompilerV2Service } from '../../services/memory-compiler-v2.service.js';
import {
  collectReferenceTextsFromExtractor,
  ReferenceResolverService,
  type MemoryResolverResult,
  type RegistryEntityFixture,
} from '../../services/reference-resolver.service.js';

export type AuditCode = 'A' | 'B' | 'C' | 'D' | 'E' | 'F';
export type AuditLayer =
  | 'extractor'
  | 'compiler'
  | 'clarification_manager'
  | 'fixture'
  | 'metric'
  | 'ambiguous';

export interface LiveV14CaptureFile {
  scenario_id: string;
  category: string;
  repetition_index: number;
  raw_content: string;
  effective_input: string;
  extractor_output: ExtractorOutputV14;
  compiled_decision?: string;
  evaluation?: { scenario_id: string; passed: boolean; failures: string[] };
}

export interface EntityPrecisionDetail {
  applicable: boolean;
  precision: number | null;
  true_positives: string[];
  false_positives: string[];
  false_negatives: string[];
  allowed: string[];
  optional: string[];
  must_have: string[];
  must_not_have: string[];
  alias_labels_as_entities: string[];
  notes: string[];
}

export type SourceBlockIssueClass =
  | 'null_legitimate'
  | 'invalid_format'
  | 'invented_block'
  | 'wrong_uuid'
  | 'missing_reference'
  | 'fixture_incomplete';

export interface SourceBlockIssue {
  field_path: string;
  artifact_type: string;
  value: string | null;
  allowed_blocks: string[];
  classification: SourceBlockIssueClass;
}

export type ClarificationAuditClass =
  | 'legitimate_blocking'
  | 'legitimate_non_blocking'
  | 'secondary'
  | 'already_resolved_by_output'
  | 'weak_reference_spurious'
  | 'negated_alias_spurious'
  | 'resolver_fixture_incomplete'
  | 'calibration_noise';

export interface ClarificationAuditItem {
  target_reference: string;
  issue_type: string;
  blocking_scope: string;
  priority: string;
  source: string;
  classification: ClarificationAuditClass;
  counts_as_false_clarification: boolean;
  rationale: string;
}

export interface EventAuditDetail {
  extractor_event_kinds: string[];
  extractor_episodic_confidences: number[];
  compiled_event_kinds: string[];
  dropped_events: Array<{ event_kind: string; reason: string }>;
  expected_event_kinds: string[];
  mismatch_layer: AuditLayer | null;
  rationale: string;
}

export interface NegationAuditDetail {
  aliases: Array<{
    alias: string;
    target_reference: string;
    negated_former_references: string[];
  }>;
  correction_signals: Array<{
    correction_type: string;
    previous_reference: string | null;
    current_reference: string | null;
    source_block_reference: string | null;
  }>;
  improper_positive_associations: string[];
  notes: string[];
}

export interface TaskAuditDetail {
  extractor_tasks: Array<{
    operation: string;
    task_reference: string | null;
    title: string | null;
    task_kind: string | null;
    status_signal: string | null;
    assignee_reference: string | null;
    target_reference: string | null;
    project_reference: string | null;
    due_at: string | null;
    blocked_reason: string | null;
    source_block_reference: string | null;
  }>;
  compiled_tasks: Array<{
    operation: string;
    task_reference: string | null;
    title: string;
    status_signal: string;
    assignee_entity_id: string | null;
  }>;
  notes: string[];
}

export interface LiveV14AuditRow {
  scenario_id: string;
  category: string;
  repetition: number;
  observed: {
    extractor_output: ExtractorOutputV14;
    compiled_output: {
      decision: CompiledMemoryV2['decision'];
      entity_mention_count: number;
      alias_count: number;
      event_count: number;
      assertion_count: number;
      task_count: number;
      task_operations: TaskOperation[];
      dropped_artifacts: CompiledMemoryV2['droppedArtifacts'];
      compiler_notes: string[];
    };
    clarification_output: {
      llm_count: number;
      compiler_count: number;
      recommended_count: number;
      recommended: Array<{
        issue_type: string;
        target_reference: string;
        blocking_scope: string;
        source: string;
      }>;
    };
    expected: V14CalibrationExpectations;
    evaluation_failures: string[];
    evaluation_passed: boolean;
  };
  metrics: {
    entity_precision: number | null;
    entity_precision_detail: EntityPrecisionDetail;
    event_kind_match: boolean | null;
    negation_error: boolean | null;
    false_clarification: boolean | null;
    source_block_reference_valid: boolean | null;
    source_block_issues: SourceBlockIssue[];
  };
  negation_audit: NegationAuditDetail | null;
  event_audit: EventAuditDetail | null;
  task_audit: TaskAuditDetail | null;
  clarification_audit: ClarificationAuditItem[];
  classification: {
    code: AuditCode;
    layer: AuditLayer;
    rationale: string;
  };
  recommended_fix: {
    prompt_change: string | null;
    compiler_change: string | null;
    clarification_change: string | null;
    metric_change: string | null;
    fixture_change: string | null;
  };
}

export interface CorrectedGlobalMetrics {
  entity_precision: number;
  entity_precision_global: number;
  entity_precision_applicable_runs: number;
  entity_precision_by_category: Record<string, number>;
  event_kind_match: number;
  event_kind_applicable_runs: number;
  negation_error_rate: number;
  negation_applicable_runs: number;
  alias_as_entity_rate: number;
  false_clarification_rate: number;
  false_clarification_rate_legacy: number;
  source_block_reference_validity: number;
  source_block_refs_total: number;
  alias_target_recall: number;
  task_recall: number;
  project_status_update_recall: number;
}

export { matchesMustNotEntityMention as matchesMustNot } from './entity-mention-match.js';

export function resolveExpected(
  category: string,
  repetition: number,
): V14CalibrationExpectations {
  const variation = V14_LIVE_VARIATIONS.find((v) => v.category === category);
  if (!variation) return {};
  void repetition;
  return variation.expected;
}

export function auditEntityPrecisionV14(
  expected: V14CalibrationExpectations,
  output: ExtractorOutputV14,
  compiled: CompiledMemoryV2,
  category: string,
): EntityPrecisionDetail {
  const mustHave: string[] = [];
  const mustNot = expected.must_not_have?.entity_mentions ?? [];
  const mustHaveAliases = expected.must_have?.alias_targets ?? [];

  const aliasLabels = new Set(output.aliases.map((a) => a.alias.toLowerCase()));
  const compiledMentions = compiled.resolvedEntities.map((e) => e.mentionText);
  const aliasAsEntity = output.entity_mentions
    .filter(
      (m) =>
        aliasLabels.has(m.mention_text.toLowerCase()) &&
        compiledMentions.some((c) => c.toLowerCase() === m.mention_text.toLowerCase()),
    )
    .map((m) => m.mention_text);

  const applicable = isEntityPrecisionApplicable(
    category,
    mustNot,
    mustHaveAliases,
    mustHave,
  );

  if (!applicable) {
    return {
      applicable: false,
      precision: null,
      true_positives: [],
      false_positives: [],
      false_negatives: [],
      allowed: [],
      optional: [],
      must_have: mustHave,
      must_not_have: mustNot,
      alias_labels_as_entities: aliasAsEntity,
      notes: ['Sem contrato aplicável de entity_mentions; precision N/A'],
    };
  }

  const true_positives: string[] = [];
  const false_positives: string[] = [];
  const false_negatives: string[] = [];
  const notes: string[] = [];

  for (const ent of compiledMentions) {
    if (mustNot.some((p) => matchesMustNotEntityMention(ent, p))) {
      false_positives.push(ent);
    } else if (mustHave.length === 0) {
      true_positives.push(ent);
    } else if (mustHave.some((p) => matchesMustNotEntityMention(ent, p))) {
      true_positives.push(ent);
    } else {
      false_positives.push(ent);
    }
  }

  for (const pattern of mustHave) {
    if (!compiledMentions.some((m) => matchesMustNotEntityMention(m, pattern))) {
      false_negatives.push(pattern);
    }
  }

  const evaluated = true_positives.length + false_positives.length;
  const precision = evaluated === 0 ? null : true_positives.length / evaluated;

  if (category.includes('alias') && aliasAsEntity.length > 0) {
    notes.push(`Codinome também em entity_mentions: ${aliasAsEntity.join(', ')}`);
  }

  return {
    applicable: true,
    precision,
    true_positives,
    false_positives,
    false_negatives,
    allowed: [],
    optional: [],
    must_have: mustHave,
    must_not_have: mustNot,
    alias_labels_as_entities: aliasAsEntity,
    notes,
  };
}

export function auditSourceBlockReferences(
  output: ExtractorOutputV14,
  effectiveInput: string,
): SourceBlockIssue[] {
  const allowed = listSourceBlockIds(effectiveInput);
  const present = new Set(allowed);
  const issues: SourceBlockIssue[] = [];

  const check = (
    field_path: string,
    artifact_type: string,
    value: string | null | undefined,
  ): void => {
    if (value == null || value.trim() === '') {
      issues.push({
        field_path,
        artifact_type,
        value: null,
        allowed_blocks: allowed,
        classification: 'null_legitimate',
      });
      return;
    }
    const v = value.trim();
    if (!isAllowedSourceBlockReference(v)) {
      issues.push({
        field_path,
        artifact_type,
        value: v,
        allowed_blocks: allowed,
        classification: 'invalid_format',
      });
      return;
    }
    if (!present.has(v)) {
      const isCorrection = v.includes('correction:');
      const uuidInInput = effectiveInput.includes(v.replace('[SOURCE_BLOCK:correction:', '').replace(']', ''));
      issues.push({
        field_path,
        artifact_type,
        value: v,
        allowed_blocks: allowed,
        classification: isCorrection && !uuidInInput ? 'wrong_uuid' : 'missing_reference',
      });
    }
  };

  for (const [i, c] of output.correction_signals.entries()) {
    check(`correction_signals[${i}].source_block_reference`, 'correction_signal', c.source_block_reference);
  }
  for (const [i, a] of output.assertions.entries()) {
    check(`assertions[${i}].source_block_reference`, 'assertion', a.source_block_reference);
  }
  for (const [i, t] of (output.task_signals ?? []).entries()) {
    check(`task_signals[${i}].source_block_reference`, 'task_signal', t.source_block_reference);
  }
  for (const [i, c] of output.clarification_candidates.entries()) {
    check(
      `clarification_candidates[${i}].source_block_reference`,
      'clarification',
      c.source_block_reference,
    );
  }

  return issues;
}

export function auditNegation(output: ExtractorOutputV14): NegationAuditDetail {
  const improper: string[] = [];
  for (const a of output.aliases) {
    for (const neg of a.negated_former_references) {
      const stillMentioned = output.entity_mentions.some(
        (m) =>
          m.mention_text.toLowerCase() === neg.toLowerCase() &&
          !m.mention_text.toLowerCase().includes(a.alias.toLowerCase()),
      );
      if (stillMentioned) {
        improper.push(`mention ${neg} após negar em alias ${a.alias}`);
      }
    }
  }
  for (const ev of output.events) {
    for (const rel of ev.related_entities) {
      for (const a of output.aliases) {
        if (
          a.negated_former_references.some(
            (n) => n.toLowerCase() === rel.entity_reference.toLowerCase(),
          )
        ) {
          improper.push(`event ${ev.event_kind} relaciona referência negada ${rel.entity_reference}`);
        }
      }
    }
  }

  return {
    aliases: output.aliases.map((a) => ({
      alias: a.alias,
      target_reference: a.target_reference,
      negated_former_references: a.negated_former_references,
    })),
    correction_signals: output.correction_signals.map((c) => ({
      correction_type: c.correction_type,
      previous_reference: c.previous_reference,
      current_reference: c.current_reference,
      source_block_reference: c.source_block_reference,
    })),
    improper_positive_associations: improper,
    notes: improper.length ? [] : ['Sem associação positiva óbvia a referência negada'],
  };
}

export function classifyClarification(
  c: {
    target_reference: string;
    issue_type: string;
    blocking_scope: string;
    priority: string;
    question: string;
    reason: string;
    source: string;
  },
  output: ExtractorOutputV14,
  compiled: CompiledMemoryV2,
  expected: V14CalibrationExpectations,
  resolverResult: MemoryResolverResult,
): ClarificationAuditItem {
  const ref = c.target_reference.toLowerCase();
  let classification: ClarificationAuditClass = 'legitimate_blocking';
  let rationale = 'clarificação material';
  let countsAsFalse = false;

  if (c.blocking_scope === 'none' || c.priority === 'low') {
    classification = 'legitimate_non_blocking';
    rationale = 'não bloqueante por scope/priority';
    countsAsFalse = expected.decision === 'accepted';
  }

  if (/\(var \d+\)/i.test(c.question) || /significado.*var/i.test(c.reason)) {
    classification = 'calibration_noise';
    rationale = 'ruído de template (var N) no texto sintético';
    countsAsFalse = true;
  }

  if (c.issue_type === 'ambiguous_entity_type' && /financeiro/i.test(ref)) {
    classification = 'secondary';
    rationale = 'tipo de tópico genérico; não bloqueia preferência principal';
    countsAsFalse = true;
  }

  const resolved = resolverResult.byReferenceText.get(c.target_reference);
  if (
    resolved?.status === 'resolved' &&
    (c.issue_type === 'ambiguous_entity_identity' || c.issue_type === 'unresolved_reference')
  ) {
    classification = 'resolver_fixture_incomplete';
    rationale = 'referência resolvida no registry fixture mas clarificação persiste';
    countsAsFalse = true;
  }

  if (output.aliases.some((a) => a.negated_former_references.some((n) => n.toLowerCase() === ref))) {
    classification = 'negated_alias_spurious';
    rationale = 'referência já negada em alias';
    countsAsFalse = true;
  }

  if (
    c.issue_type === 'participant_conflict' &&
    output.correction_signals.some((s) => s.correction_type === 'replace_subject')
  ) {
    classification = 'already_resolved_by_output';
    rationale = 'correction_signal estruturado já presente';
    countsAsFalse = expected.decision === 'accepted';
  }

  if (
    expected.decision === 'accepted' &&
    compiled.assertions.length > 0 &&
    c.issue_type === 'unresolved_reference'
  ) {
    classification = 'weak_reference_spurious';
    rationale = 'assertions materializadas; clarificação LLM redundante';
    countsAsFalse = true;
  }

  if (classification === 'legitimate_blocking' && expected.decision === 'needs_clarification') {
    countsAsFalse = false;
  }

  return {
    target_reference: c.target_reference,
    issue_type: c.issue_type,
    blocking_scope: c.blocking_scope,
    priority: c.priority,
    source: c.source,
    classification,
    counts_as_false_clarification: countsAsFalse,
    rationale,
  };
}

export function auditEvents(
  expected: V14CalibrationExpectations,
  output: ExtractorOutputV14,
  compiled: CompiledMemoryV2,
  category: string,
): EventAuditDetail | null {
  const expectedKinds = expected.must_have?.event_kinds ?? [];
  if (expectedKinds.length === 0 && !(expected.must_not_have?.event_kinds?.length)) {
    return null;
  }

  const extractorKinds = output.events.map((e) => e.event_kind);
  const dropped = compiled.droppedArtifacts
    .filter((d) => d.kind === 'event')
    .map((d) => ({
      event_kind: d.originalRef,
      reason: d.reason,
    }));

  const compiledKinds = compiled.events.map((e) => e.eventKind);
  let mismatch_layer: AuditLayer | null = null;
  let rationale = '';

  for (const kind of expectedKinds) {
    const inExtractor = extractorKinds.includes(kind as (typeof extractorKinds)[0]);
    const inCompiled = compiledKinds.includes(kind);
    if (!inExtractor) {
      mismatch_layer = 'extractor';
      rationale = `extractor não emitiu event_kind ${kind}`;
    } else if (!inCompiled) {
      mismatch_layer = 'compiler';
      rationale = `compiler descartou ou não promoveu ${kind}`;
    }
  }

  if (expectedKinds.length > 0 && category.includes('correction') && output.events.length > 0) {
    const wrongParticipant = output.events.some((e) =>
      e.related_entities.some((r) => r.entity_reference.toLowerCase().includes('chris')),
    );
    if (wrongParticipant && output.correction_signals.length > 0) {
      mismatch_layer = mismatch_layer ?? 'extractor';
      rationale =
        rationale ||
        'evento ainda associa participante pré-correção apesar de correction_signal';
    }
  }

  return {
    extractor_event_kinds: extractorKinds,
    extractor_episodic_confidences: output.events.map((e) => e.episodic_confidence),
    compiled_event_kinds: compiledKinds,
    dropped_events: dropped,
    expected_event_kinds: expectedKinds,
    mismatch_layer,
    rationale,
  };
}

export function auditTasks(output: ExtractorOutputV14, compiled: CompiledMemoryV2): TaskAuditDetail | null {
  if ((output.task_signals ?? []).length === 0 && compiled.tasks.length === 0) return null;
  return {
    extractor_tasks: (output.task_signals ?? []).map((t) => ({
      operation: t.operation,
      task_reference: t.task_reference,
      title: t.title,
      task_kind: t.task_kind,
      status_signal: t.status_signal,
      assignee_reference: t.assignee_reference,
      target_reference: t.target_reference,
      project_reference: t.project_reference,
      due_at: t.due_at,
      blocked_reason: t.blocked_reason,
      source_block_reference: t.source_block_reference,
    })),
    compiled_tasks: compiled.tasks.map((t) => ({
      operation: t.operation,
      task_reference: t.taskReference,
      title: t.title,
      status_signal: t.statusSignal,
      assignee_entity_id: t.assigneeEntityId,
    })),
    notes: [],
  };
}

export function classifyRun(input: {
  category: string;
  evaluation_passed: boolean;
  evaluation_failures: string[];
  entityDetail: EntityPrecisionDetail;
  sourceIssues: SourceBlockIssue[];
  clarificationItems: ClarificationAuditItem[];
  eventAudit: EventAuditDetail | null;
  negationAudit: NegationAuditDetail | null;
  compiled: CompiledMemoryV2;
  expected: V14CalibrationExpectations;
}): {
  code: AuditCode;
  layer: AuditLayer;
  rationale: string;
  recommended_fix: LiveV14AuditRow['recommended_fix'];
} {
  const fix: LiveV14AuditRow['recommended_fix'] = {
    prompt_change: null,
    compiler_change: null,
    clarification_change: null,
    metric_change: null,
    fixture_change: null,
  };

  const failures = input.evaluation_failures;
  const blob = failures.join(' ').toLowerCase();

  if (
    failures.some((f) => f.includes('must_not_have entity_mention')) &&
    !input.entityDetail.applicable
  ) {
    fix.fixture_change = 'must_not_have.entity_mentions: match exato (Zeta-1 ≠ Zeta)';
    fix.metric_change = 'não aplicar entity_precision em contratos alias-first';
    return {
      code: 'F',
      layer: 'metric',
      rationale: 'must_not substring em codinome com sufixo numérico',
      recommended_fix: fix,
    };
  }

  if (
    failures.some((f) => f.includes('must_not_have entity_mention')) &&
    input.entityDetail.notes.some((n) => n.includes('substring'))
  ) {
    fix.fixture_change = 'must_not usar match exato de codinome (Zeta-1 ≠ Zeta)';
    fix.metric_change = 'entity must_not: token boundary / alias label only';
    return {
      code: 'F',
      layer: 'metric',
      rationale: 'FP por substring em must_not (ex.: Zeta vs Zeta-1)',
      recommended_fix: fix,
    };
  }

  if (failures.some((f) => f.includes('must_not_have entity_mention'))) {
    if (input.entityDetail.alias_labels_as_entities.length > 0) {
      fix.prompt_change = 'não emitir entity_mention para label de alias; só aliases[]';
      return {
        code: 'D',
        layer: 'extractor',
        rationale: 'codinome modelado como entity_mention',
        recommended_fix: fix,
      };
    }
    fix.compiler_change = 'filtrar entity_mentions que são apenas labels de alias';
    return {
      code: 'A',
      layer: 'compiler',
      rationale: 'mention proibida permanece em resolvedEntities',
      recommended_fix: fix,
    };
  }

  const invalidBlocks = input.sourceIssues.filter(
    (s) => s.classification !== 'null_legitimate' && s.value != null,
  );
  if (invalidBlocks.length > 0) {
    fix.prompt_change = 'source_block_reference somente blocos presentes no input';
    return {
      code: 'C',
      layer: 'extractor',
      rationale: `referências inválidas: ${invalidBlocks.map((i) => i.classification).join(', ')}`,
      recommended_fix: fix,
    };
  }

  if (blob.includes('decision expected accepted got needs_clarification')) {
    const falseClar = input.clarificationItems.filter((c) => c.counts_as_false_clarification);
    if (falseClar.length > 0) {
      fix.clarification_change = 'CM v2: descartar clarificações de ruído sintético e pós-correção';
      return {
        code: 'E',
        layer: 'clarification_manager',
        rationale: `${falseClar.length} clarificação(ões) espúria(s); conteúdo estrutural ok`,
        recommended_fix: fix,
      };
    }
    if (input.compiled.clarificationCandidates.some((c) => c.source === 'compiler')) {
      fix.compiler_change = 'revisar gates de needs_clarification para blocking compiler-only';
      return {
        code: 'A',
        layer: 'compiler',
        rationale: 'compiler escalou needs_clarification',
        recommended_fix: fix,
      };
    }
    fix.prompt_change = 'reduzir clarification_candidates bloqueantes em cenários determinísticos';
    return {
      code: 'D',
      layer: 'extractor',
      rationale: 'LLM emitiu clarificações bloqueantes',
      recommended_fix: fix,
    };
  }

  if (blob.includes('must_have event_kind')) {
    const layer = input.eventAudit?.mismatch_layer ?? 'extractor';
    if (layer === 'compiler') fix.compiler_change = 'não descartar eventos episódicos válidos';
    else fix.prompt_change = 'event_kind canônico meeting/confirmation/document_sent';
    return {
      code: layer === 'compiler' ? 'A' : 'D',
      layer,
      rationale: input.eventAudit?.rationale || blob,
      recommended_fix: fix,
    };
  }

  if (blob.includes('must_have alias_target')) {
    fix.prompt_change = 'aliases[].target_reference para pessoa canônica';
    return {
      code: 'D',
      layer: 'extractor',
      rationale: 'alias target ausente ou não resolvido',
      recommended_fix: fix,
    };
  }

  if (blob.includes('must_have assertion_kind')) {
    const hasOpinion = input.compiled.assertions.some((a) => a.assertionKind === 'opinion');
    if (hasOpinion) {
      fix.fixture_change = 'aceitar fact+opinion ou assertion_kind fact para responsabilidade';
      fix.metric_change = 'static_preferences: min 1 opinion sem exigir decision se CM filtra';
      return {
        code: 'B',
        layer: 'fixture',
        rationale: 'opinion presente mas decision bloqueada por clarificações',
        recommended_fix: fix,
      };
    }
    fix.prompt_change = 'preferências → assertion_kind opinion';
    return {
      code: 'D',
      layer: 'extractor',
      rationale: blob,
      recommended_fix: fix,
    };
  }

  if (blob.includes('must_have task')) {
    fix.prompt_change = 'tasks com status_signal e source_block_reference';
    return {
      code: 'D',
      layer: 'extractor',
      rationale: blob,
      recommended_fix: fix,
    };
  }

  if (blob.includes('min_clarifications')) {
    return {
      code: 'E',
      layer: 'ambiguous',
      rationale: 'ambiguidade material esperada',
      recommended_fix: fix,
    };
  }

  if (input.evaluation_passed) {
    return {
      code: 'A',
      layer: 'compiler',
      rationale: 'saída alinhada ao contrato live',
      recommended_fix: fix,
    };
  }

  if (input.negationAudit && input.negationAudit.improper_positive_associations.length > 0) {
    fix.prompt_change = 'negated_former_references sem eventos/assertions positivos';
    return {
      code: 'D',
      layer: 'extractor',
      rationale: input.negationAudit.improper_positive_associations.join('; '),
      recommended_fix: fix,
    };
  }

  return {
    code: 'D',
    layer: 'extractor',
    rationale: failures.join('; ') || 'falha não classificada',
    recommended_fix: fix,
  };
}

export function recompileCapture(
  capture: LiveV14CaptureFile,
  registry: RegistryEntityFixture[],
): {
  compiled: CompiledMemoryV2;
  recommended: ReturnType<ClarificationManagerV2Service['recommend']>;
  resolverResult: MemoryResolverResult;
} {
  const resolver = new ReferenceResolverService(registry);
  const resolverResult = resolver.resolveReferences(
    collectReferenceTextsFromExtractor(capture.extractor_output),
  );
  const compiled = new MemoryCompilerV2Service().compile({
    extractorOutput: capture.extractor_output,
    effectiveInput: capture.effective_input,
    resolverResult,
  });
  const clarificationManager = new ClarificationManagerV2Service();
  const recommended = clarificationManager.recommend({
    llmCandidates: compiled.clarificationCandidates.filter((c) => c.source === 'llm'),
    compilerCandidates: compiled.clarificationCandidates.filter((c) => c.source !== 'llm'),
    resolverResult,
    flags: compiled.flags,
    extractorOutput: capture.extractor_output,
    compiled: {
      tasks: compiled.tasks,
      assertions: compiled.assertions,
      events: compiled.events,
    },
    effectiveInput: capture.effective_input,
  });
  return { compiled, recommended, resolverResult };
}

export function auditLiveV14Capture(
  capture: LiveV14CaptureFile,
  registry: RegistryEntityFixture[],
): LiveV14AuditRow {
  const expected = resolveExpected(capture.category, capture.repetition_index);
  const { compiled, recommended, resolverResult } = recompileCapture(capture, registry);

  const evaluation = evaluateV2Case(
    `${capture.category}-r${capture.repetition_index}`,
    compiled,
    recommended.length,
    expected,
    { category: capture.category, recommended },
  );

  const entityDetail = auditEntityPrecisionV14(
    expected,
    capture.extractor_output,
    compiled,
    capture.category,
  );

  const sourceIssues = auditSourceBlockReferences(
    capture.extractor_output,
    capture.effective_input,
  );
  const negationCategories = new Set([
    'alias_negation',
    'alias_reassignment',
    'correction_participant',
    'correction_document_sender',
  ]);
  const negation_audit = negationCategories.has(capture.category)
    ? auditNegation(capture.extractor_output)
    : null;

  const eventCategories = new Set([
    'episodic_meeting',
    'episodic_confirmation',
    'correction_participant',
    'correction_document_sender',
  ]);
  const event_audit = eventCategories.has(capture.category)
    ? auditEvents(expected, capture.extractor_output, compiled, capture.category)
    : null;

  const taskCategories = new Set([
    'task_open',
    'task_blocked',
    'task_completed',
    'project_status_update',
    'task_due_date_change',
    'task_assignee_change',
  ]);
  const task_audit = taskCategories.has(capture.category)
    ? auditTasks(capture.extractor_output, compiled)
    : null;

  const clarification_audit = [
    ...compiled.clarificationCandidates.map((c) =>
      classifyClarification(
        {
          target_reference: c.targetReference,
          issue_type: c.issueType,
          blocking_scope: c.blockingScope,
          priority: c.priority,
          question: c.question,
          reason: c.reason,
          source: c.source,
        },
        capture.extractor_output,
        compiled,
        expected,
        resolverResult,
      ),
    ),
  ];

  const expectedKinds = expected.must_have?.event_kinds ?? [];
  const event_kind_match =
    expectedKinds.length === 0
      ? null
      : expectedKinds.every((k) => compiled.events.some((e) => e.eventKind === k));

  const negation_error =
    negation_audit == null
      ? null
      : negation_audit.improper_positive_associations.length > 0 ||
        (evaluation.failures.some((f) => f.includes('alias')) &&
          !compiled.aliases.some((a) =>
            (expected.must_have?.alias_targets ?? []).some((t) =>
              a.targetReference.includes(t),
            ),
          ));

  const false_clarification =
    expected.decision === 'accepted'
      ? clarification_audit.some((c) => c.counts_as_false_clarification)
      : null;

  const { code, layer, rationale, recommended_fix } = classifyRun({
    category: capture.category,
    evaluation_passed: evaluation.passed,
    evaluation_failures: evaluation.failures,
    entityDetail,
    sourceIssues,
    clarificationItems: clarification_audit,
    eventAudit: event_audit,
    negationAudit: negation_audit,
    compiled,
    expected,
  });

  return {
    scenario_id: capture.scenario_id,
    category: capture.category,
    repetition: capture.repetition_index,
    observed: {
      extractor_output: capture.extractor_output,
      compiled_output: {
        decision: compiled.decision,
        entity_mention_count: compiled.resolvedEntities.length,
        alias_count: compiled.aliases.length,
        event_count: compiled.events.length,
        assertion_count: compiled.assertions.length,
        task_count: compiled.tasks.length,
        task_operations: compiled.tasks.map((t) => t.operation),
        dropped_artifacts: compiled.droppedArtifacts,
        compiler_notes: compiled.compilerNotes,
      },
      clarification_output: {
        llm_count: compiled.clarificationCandidates.filter((c) => c.source === 'llm').length,
        compiler_count: compiled.clarificationCandidates.filter((c) => c.source === 'compiler').length,
        recommended_count: recommended.length,
        recommended: recommended.map((c) => ({
          issue_type: c.issueType,
          target_reference: c.targetReference,
          blocking_scope: c.blockingScope,
          source: c.source,
        })),
      },
      expected,
      evaluation_failures: evaluation.failures,
      evaluation_passed: evaluation.passed,
    },
    metrics: {
      entity_precision: entityDetail.precision,
      entity_precision_detail: entityDetail,
      event_kind_match,
      negation_error,
      false_clarification,
      source_block_reference_valid:
        sourceIssues.length === 0
          ? true
          : sourceIssues.every(
              (s) =>
                s.classification === 'null_legitimate' ||
                (s.value != null && listSourceBlockIds(capture.effective_input).includes(s.value)),
            ),
      source_block_issues: sourceIssues,
    },
    negation_audit,
    event_audit,
    task_audit,
    clarification_audit,
    classification: { code, layer, rationale },
    recommended_fix,
  };
}

export function aggregateCorrectedMetrics(rows: LiveV14AuditRow[]): CorrectedGlobalMetrics {
  let entityTp = 0;
  let entityEval = 0;
  let entityRuns = 0;
  let eventMatch = 0;
  let eventRuns = 0;
  let negErrors = 0;
  let negRuns = 0;
  let aliasAsEntity = 0;
  let falseClar = 0;
  let clarDenom = 0;
  let falseClarLegacy = 0;
  let legacyDenom = 0;
  let sbValid = 0;
  let sbTotal = 0;
  let aliasExpected = 0;
  let aliasFound = 0;
  let taskExpected = 0;
  let taskFound = 0;
  let projectExpected = 0;
  let projectFound = 0;

  for (const row of rows) {
    const d = row.metrics.entity_precision_detail;
    if (d.applicable && d.precision != null) {
      entityRuns += 1;
      entityTp += d.true_positives.length;
      entityEval += d.true_positives.length + d.false_positives.length;
    }
    aliasAsEntity += d.alias_labels_as_entities.length;

    if (row.metrics.event_kind_match != null) {
      eventRuns += 1;
      if (row.metrics.event_kind_match) eventMatch += 1;
    }

    if (row.negation_audit) {
      negRuns += 1;
      if (row.metrics.negation_error) negErrors += 1;
    }

    const exp = row.observed.expected;
    for (const t of exp.must_have?.alias_targets ?? []) {
      aliasExpected += 1;
      if (
        row.observed.compiled_output.alias_count > 0 &&
        row.observed.extractor_output.aliases.some((a) => a.target_reference.includes(t))
      ) {
        aliasFound += 1;
      }
    }

    if (exp.must_have?.task_operations?.length) {
      taskExpected += 1;
      const ops = exp.must_have.task_operations;
      if (
        ops.every((op) => row.observed.compiled_output.task_operations.includes(op))
      ) {
        taskFound += 1;
      }
    }

    if (row.category === 'project_status_update') {
      projectExpected += 1;
      if (
        row.observed.compiled_output.assertion_count > 0 &&
        row.observed.extractor_output.assertions.some((a) => a.assertion_kind === 'status_update')
      ) {
        projectFound += 1;
      }
    }

    for (const c of row.clarification_audit) {
      clarDenom += 1;
      if (c.counts_as_false_clarification) falseClar += 1;
    }

    if (exp.decision === 'accepted') {
      legacyDenom += 1;
      if (row.observed.clarification_output.recommended_count > 0) {
        falseClarLegacy += 1;
      }
    }

    for (const issue of row.metrics.source_block_issues) {
      if (issue.value == null) continue;
      sbTotal += 1;
      const ok = !['invalid_format', 'invented_block', 'wrong_uuid', 'missing_reference'].includes(
        issue.classification,
      );
      if (ok) sbValid += 1;
    }
  }

  const entity_precision_global =
    entityEval === 0 ? 1 : Math.round((entityTp / entityEval) * 1000) / 1000;
  const entity_precision_by_category: Record<string, number> = {};
  for (const row of rows) {
    const d = row.metrics.entity_precision_detail;
    if (!d.applicable || d.precision == null) continue;
    const cat = row.category;
    const prev = entity_precision_by_category[cat];
    entity_precision_by_category[cat] =
      prev == null ? d.precision : Math.round(((prev + d.precision) / 2) * 1000) / 1000;
  }

  return {
    entity_precision: entity_precision_global,
    entity_precision_global,
    entity_precision_applicable_runs: entityRuns,
    entity_precision_by_category,
    event_kind_match: eventRuns === 0 ? 1 : Math.round((eventMatch / eventRuns) * 1000) / 1000,
    event_kind_applicable_runs: eventRuns,
    negation_error_rate: negRuns === 0 ? 0 : Math.round((negErrors / negRuns) * 1000) / 1000,
    negation_applicable_runs: negRuns,
    alias_as_entity_rate:
      rows.length === 0 ? 0 : Math.round((aliasAsEntity / rows.length) * 1000) / 1000,
    false_clarification_rate: clarDenom === 0 ? 0 : Math.round((falseClar / clarDenom) * 1000) / 1000,
    false_clarification_rate_legacy:
      legacyDenom === 0 ? 0 : Math.round((falseClarLegacy / legacyDenom) * 1000) / 1000,
    source_block_reference_validity: sbTotal === 0 ? 1 : Math.round((sbValid / sbTotal) * 1000) / 1000,
    source_block_refs_total: sbTotal,
    alias_target_recall:
      aliasExpected === 0 ? 1 : Math.round((aliasFound / aliasExpected) * 1000) / 1000,
    task_recall: taskExpected === 0 ? 1 : Math.round((taskFound / taskExpected) * 1000) / 1000,
    project_status_update_recall:
      projectExpected === 0 ? 1 : Math.round((projectFound / projectExpected) * 1000) / 1000,
  };
}

export function aggregateByCategory(rows: LiveV14AuditRow[]): Record<
  string,
  {
    total: number;
    evaluation_passed: number;
    by_code: Record<string, number>;
    by_layer: Record<string, number>;
    top_failures: string[];
  }
> {
  const out: Record<
    string,
    {
      total: number;
      evaluation_passed: number;
      by_code: Record<string, number>;
      by_layer: Record<string, number>;
      failure_counts: Record<string, number>;
    }
  > = {};

  for (const row of rows) {
    const b =
      out[row.category] ??
      ({
        total: 0,
        evaluation_passed: 0,
        by_code: {},
        by_layer: {},
        failure_counts: {},
      } as const);
    const bucket = { ...b, by_code: { ...b.by_code }, by_layer: { ...b.by_layer }, failure_counts: { ...b.failure_counts } };
    bucket.total += 1;
    if (row.observed.evaluation_passed) bucket.evaluation_passed += 1;
    bucket.by_code[row.classification.code] = (bucket.by_code[row.classification.code] ?? 0) + 1;
    bucket.by_layer[row.classification.layer] = (bucket.by_layer[row.classification.layer] ?? 0) + 1;
    for (const f of row.observed.evaluation_failures) {
      bucket.failure_counts[f] = (bucket.failure_counts[f] ?? 0) + 1;
    }
    out[row.category] = bucket;
  }

  const result: Record<
    string,
    {
      total: number;
      evaluation_passed: number;
      by_code: Record<string, number>;
      by_layer: Record<string, number>;
      top_failures: string[];
    }
  > = {};

  for (const [cat, data] of Object.entries(out)) {
    const top_failures = Object.entries(data.failure_counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([k, v]) => `${k} (${v})`);
    result[cat] = {
      total: data.total,
      evaluation_passed: data.evaluation_passed,
      by_code: data.by_code,
      by_layer: data.by_layer,
      top_failures,
    };
  }
  return result;
}

export function buildAuditSummaryMarkdown(input: {
  generated_at: string;
  total_runs: number;
  corrected_metrics: CorrectedGlobalMetrics;
  legacy_metrics: Record<string, number> | null;
  by_category: ReturnType<typeof aggregateByCategory>;
  by_code: Record<string, number>;
  by_layer: Record<string, number>;
  top_real_failures: Array<{ scenario_id: string; rationale: string }>;
}): string {
  const catTable = Object.entries(input.by_category)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(
      ([cat, d]) =>
        `| ${cat} | ${d.evaluation_passed}/${d.total} | ${JSON.stringify(d.by_code)} | ${d.top_failures[0] ?? '—'} |`,
    )
    .join('\n');

  const codeLines = Object.entries(input.by_code)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `- **${k}**: ${v}`)
    .join('\n');

  const layerLines = Object.entries(input.by_layer)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `- **${k}**: ${v}`)
    .join('\n');

  const legacyBlock = input.legacy_metrics
    ? `\n## Métricas live originais (runner)\n\n\`\`\`json\n${JSON.stringify(input.legacy_metrics, null, 2)}\n\`\`\`\n`
    : '';

  return `# Auditoria live extractor v1.4

Gerado: ${input.generated_at}
Execuções: ${input.total_runs}

## Métricas corrigidas (auditoria)

| Métrica | Valor | Notas |
|---------|-------|-------|
| entity_precision | ${input.corrected_metrics.entity_precision} | ${input.corrected_metrics.entity_precision_applicable_runs} runs com contrato |
| event_kind_match | ${input.corrected_metrics.event_kind_match} | ${input.corrected_metrics.event_kind_applicable_runs} runs |
| negation_error_rate | ${input.corrected_metrics.negation_error_rate} | ${input.corrected_metrics.negation_applicable_runs} runs negation/correction |
| alias_as_entity_rate | ${input.corrected_metrics.alias_as_entity_rate} | por run |
| false_clarification_rate (auditoria) | ${input.corrected_metrics.false_clarification_rate} | por item recomendado |
| false_clarification_rate (legacy runner) | ${input.corrected_metrics.false_clarification_rate_legacy} | runs accepted com qualquer clarificação |
| source_block_reference_validity | ${input.corrected_metrics.source_block_reference_validity} | ${input.corrected_metrics.source_block_refs_total} refs não-null |
| alias_target_recall | ${input.corrected_metrics.alias_target_recall} | |
| task_recall | ${input.corrected_metrics.task_recall} | |
| project_status_update_recall | ${input.corrected_metrics.project_status_update_recall} | |

${legacyBlock}

## Classificação global (código A–F)

${codeLines}

## Camada responsável

${layerLines}

## Tabela por categoria

| Categoria | Pass | Códigos | Falha principal |
|-----------|------|---------|-----------------|
${catTable}

## Principais falhas reais (amostra)

${input.top_real_failures
  .slice(0, 15)
  .map((r) => `- \`${r.scenario_id}\`: ${r.rationale}`)
  .join('\n')}

## Recomendação mínima próximo bloco

1. Ajustar fixture/métrica must_not_have.entity_mentions (match exato de codinome, não substring).
2. ClarificationManagerV2: filtrar ruído (var N), pós-correction_signal, e clarificações quando assertions materializadas.
3. Prompt v1.4: correções — não manter assertion/evento com sujeito substituído; negation — não entity_mention para label de alias.
4. Re-rodar live após métricas/fixtures; só então avaliar troca de runtime shadow para prod.

Detalhe por execução: extractor-v1.4-live-audit-detail.json
`;
}
