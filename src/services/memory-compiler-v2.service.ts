import type { ExtractorOutputV14, ExtractedTaskSignal } from '../openai/extractor-v1.4.types.js';
import {
  assertSourceBlockExists,
  listSourceBlockIds,
} from '../utils/source-blocks.js';
import { normalizeText } from '../utils/normalize.js';
import type {
  CompiledAliasV2,
  CompiledAssertionV2,
  CompiledClarificationCandidateV2,
  CompiledEntityReference,
  CompiledEventV2,
  CompiledMemoryV2,
  CompiledReviewHintV2,
  CompiledTaskV2,
  CompilerDecision,
  CompilerFlagsV2,
  DroppedArtifactV2,
  MemoryCompilerV2Input,
} from '../types/memory-compiler-v2.js';
import { MEMORY_COMPILER_V2_VERSION } from '../types/memory-compiler-v2.js';
import type {
  ContextResolutionEvidence,
  TaskSignalContextResolution,
} from '../types/ingestion-context.js';
import type { MemoryResolverResult, ResolvedReference } from './reference-resolver.service.js';
import {
  buildMissingTemporalAnchorResult,
  TemporalNormalizerService,
} from './temporal-normalizer.service.js';
import type { TemporalAnchor } from '../types/memory-compiler-v2.js';
import {
  isMvpAutoRegistryEntityType,
  isMvpBlockedGenericEntityTerm,
  isMvpRegistryEligibleReference,
  genericEntityTermDropNote,
  isReferenceCentralToTaskSignals,
  peripheralAmbiguityNote,
} from '../config/mvp-registry-policy.js';
import { isFirstPersonPronoun } from './first-person-pronoun-resolver.js';
import { isThirdPersonObjectPronoun } from './pronoun-coreference.service.js';
import { shouldSuppressSchedulingClarification } from './scheduling-clarification-policy.js';
import { getBestFactForReference } from './external-knowledge-enrichment.service.js';
import type { ExternalKnowledgeEnrichmentResult } from '../types/external-knowledge-enrichment.js';
import {
  extractTemporalLiteralsFromExcerpt,
  excerptHasRelativeTemporalHint,
  shouldAutoApplyEnrichmentToEvent,
} from './enrichment-eligibility.js';
import type { ExtractedEvent } from '../openai/extractor-v1.4.types.js';

const EPISODIC_MIN_CONFIDENCE = 0.45;
const STATIC_INPUT =
  /\b(panorama|prefere\s+reuni|prefere reuni|cuida do|lidera|aliases?\s+frequentes)\b/i;

const CODENAME_LIKE = /^(codinome|apelido)\s+/i;

const GENERIC_FORNECEDOR_QUESTION = 'Qual fornecedor deve ser cobrado?';

export class MemoryCompilerV2Service {
  private readonly temporalNormalizer = new TemporalNormalizerService();

  compile(input: MemoryCompilerV2Input): CompiledMemoryV2 {
    const { extractorOutput, effectiveInput, resolverResult } = input;
    const presentBlocks = new Set(listSourceBlockIds(effectiveInput));
    const dropped: DroppedArtifactV2[] = [];
    const compilerNotes: string[] = [];
    const clarificationCandidates: CompiledClarificationCandidateV2[] = [];
    const negatedRefs = new Set<string>();
    const supersededRefs = new Set<string>();

    this.validateSourceBlocks(extractorOutput, presentBlocks, dropped, compilerNotes);

    for (const a of extractorOutput.aliases) {
      for (const n of a.negated_former_references) {
        negatedRefs.add(normalizeText(n));
      }
    }

    this.applyCorrectionSignals(
      extractorOutput,
      resolverResult,
      presentBlocks,
      supersededRefs,
      negatedRefs,
      dropped,
      compilerNotes,
    );

    const aliasLabels = new Set(
      extractorOutput.aliases.map((a) => normalizeText(a.alias)),
    );

    const aliases = this.compileAliases(
      extractorOutput,
      resolverResult,
      negatedRefs,
      clarificationCandidates,
      dropped,
      compilerNotes,
    );

    const resolvedEntities = this.compileEntityMentions(
      extractorOutput,
      resolverResult,
      aliasLabels,
      supersededRefs,
      clarificationCandidates,
      dropped,
      compilerNotes,
    );

    const isStaticContext = STATIC_INPUT.test(effectiveInput);

    const events = this.compileEvents(
      extractorOutput,
      resolverResult,
      presentBlocks,
      isStaticContext,
      supersededRefs,
      clarificationCandidates,
      dropped,
      compilerNotes,
      input.temporalAnchor,
    );

    const assertions = this.compileAssertions(
      extractorOutput,
      resolverResult,
      presentBlocks,
      supersededRefs,
      negatedRefs,
      clarificationCandidates,
      dropped,
      compilerNotes,
    );

    const taskSignalResolutions = input.taskSignalResolutions ?? [];
    const resolutionByIndex = new Map(
      taskSignalResolutions.map((r) => [r.taskSignalIndex, r]),
    );

    const { tasks, evidence, contextResolved, contextAmbiguous } = this.compileTaskSignals(
      extractorOutput,
      resolverResult,
      presentBlocks,
      supersededRefs,
      clarificationCandidates,
      dropped,
      compilerNotes,
      resolutionByIndex,
      input.temporalAnchor,
    );

    this.appendGenericFornecedorTargetClarifications(tasks, clarificationCandidates);

    const reviewHints: CompiledReviewHintV2[] = extractorOutput.review_hints.map((h) => ({
      issueType: h.issue_type,
      targetReference: h.target_reference,
      reason: h.reason,
      sourceExcerpt: h.source_excerpt,
      confidence: h.confidence,
    }));

    for (const c of extractorOutput.clarification_candidates) {
      if (
        c.issue_type === 'ambiguous_identity' &&
        isThirdPersonObjectPronoun(c.target_reference)
      ) {
        const pronounHit =
          resolverResult.byReferenceText.get(c.target_reference) ??
          resolverResult.byReferenceText.get(normalizeText(c.target_reference));
        if (pronounHit?.status === 'resolved' && pronounHit.entity_id) {
          compilerNotes.push(`pronoun_resolved: ${c.target_reference}`);
          continue;
        }
      }
      if (
        c.issue_type === 'ambiguous_identity' &&
        isFirstPersonPronoun(c.target_reference)
      ) {
        const euResolved =
          resolverResult.byReferenceText.get('eu') ??
          resolverResult.byReferenceText.get(normalizeText('eu'));
        if (euResolved?.status === 'resolved') {
          compilerNotes.push(`first_person_resolved: ${c.target_reference}`);
          continue;
        }
      }
      if (shouldSuppressSchedulingClarification(extractorOutput, c)) {
        compilerNotes.push(`scheduling_clarification_suppressed: ${c.target_reference}`);
        continue;
      }
      if (
        (c.issue_type === 'ambiguous_identity' || c.issue_type === 'ambiguous_entity_type') &&
        !isMvpRegistryEligibleReference(c.target_reference, extractorOutput) &&
        !(
          c.blocking_scope === 'knowledge_confirmation' &&
          isReferenceCentralToTaskSignals(c.target_reference, extractorOutput.task_signals)
        )
      ) {
        compilerNotes.push(peripheralAmbiguityNote(c.target_reference));
        continue;
      }
      clarificationCandidates.push({
        targetType: c.target_type,
        targetReference: c.target_reference,
        issueType: c.issue_type,
        question: c.question,
        reason: c.reason,
        priority: c.priority,
        blockingScope: c.blocking_scope,
        suggestedAnswers: c.suggested_answers,
        sourceExcerpt: c.source_excerpt,
        source: 'llm',
      });
    }

    const flags: CompilerFlagsV2 = {
      negatedReferences: [...negatedRefs],
      supersededReferences: [...supersededRefs],
      presentSourceBlocks: [...presentBlocks],
      contextResolvedTasks: contextResolved,
      contextAmbiguousTasks: contextAmbiguous,
    };

    const decision = this.computeDecision(
      clarificationCandidates,
      dropped,
      reviewHints,
      compilerNotes,
      extractorOutput,
    );

    this.applyExternalEnrichment(
      events,
      clarificationCandidates,
      compilerNotes,
      input.externalEnrichment,
      input.enrichmentAutoApplyConfidence ?? 0.9,
      input.enrichmentSuggestConfidence ?? 0.6,
    );

    return {
      compilerVersion: MEMORY_COMPILER_V2_VERSION,
      resolvedEntities,
      aliases,
      events,
      assertions,
      tasks,
      clarificationCandidates,
      reviewHints,
      droppedArtifacts: dropped,
      compilerNotes,
      decision,
      flags,
      taskSignalResolutions,
      contextResolutionEvidence: evidence,
      enrichmentEvidence: input.externalEnrichment,
    };
  }

  private applyExternalEnrichment(
    events: CompiledEventV2[],
    clarifications: CompiledClarificationCandidateV2[],
    notes: string[],
    enrichment: ExternalKnowledgeEnrichmentResult | undefined,
    autoApplyConfidence: number,
    suggestConfidence: number,
  ): void {
    if (!enrichment || enrichment.status !== 'resolved' || !enrichment.facts.length) {
      return;
    }

    for (const event of events) {
      if (!shouldAutoApplyEnrichmentToEvent(event)) continue;

      const fact =
        getBestFactForReference(enrichment.facts, event.title) ??
        enrichment.facts.find((f) => f.field === 'occurred_at');
      if (!fact || fact.field === 'entity_disambiguation') continue;

      if (
        fact.field === 'occurred_at' &&
        fact.occurredAtIso &&
        fact.confidence >= autoApplyConfidence &&
        !event.occurredAt
      ) {
        event.occurredAt = fact.occurredAtIso;
        notes.push(`external_enrichment_applied: ${fact.matchedReference}`);
      }
    }

    for (const fact of enrichment.facts) {
      if (fact.confidence < suggestConfidence) continue;
      if (fact.field === 'occurred_at') {
        const existing = clarifications.find(
          (c) => normalizeText(c.targetReference) === normalizeText(fact.matchedReference),
        );
        if (!existing) continue;
        const suggestion = fact.occurredAtIso
          ? `${fact.occurredAtIso.replace('/', ' a ')} (fonte: ${fact.sourceUrl ?? fact.sourceLabel})`
          : `${fact.claim} (fonte: ${fact.sourceUrl ?? fact.sourceLabel})`;
        this.appendEnrichmentSuggestion(existing, suggestion, fact.matchedReference, notes);
        continue;
      }
      if (fact.field === 'entity_disambiguation' || fact.field === 'description') {
        const existing = clarifications.find(
          (c) => normalizeText(c.targetReference) === normalizeText(fact.matchedReference),
        );
        if (!existing) continue;
        const suggestion = `${fact.claim} (fonte: ${fact.sourceUrl ?? fact.sourceLabel})`;
        this.appendEnrichmentSuggestion(
          existing,
          suggestion,
          fact.matchedReference,
          notes,
          'external_enrichment_suggested_clarification',
        );
      }
    }
  }

  private appendEnrichmentSuggestion(
    clarification: CompiledClarificationCandidateV2,
    suggestion: string,
    matchedReference: string,
    notes: string[],
    notePrefix = 'external_enrichment_suggested',
  ): void {
    if (!clarification.suggestedAnswers.includes(suggestion)) {
      clarification.suggestedAnswers = [...clarification.suggestedAnswers, suggestion];
      notes.push(`${notePrefix}: ${matchedReference}`);
    }
  }

  private lookup(resolver: MemoryResolverResult, ref: string): ResolvedReference {
    return (
      resolver.byReferenceText.get(ref) ??
      resolver.byReferenceText.get(normalizeText(ref)) ?? {
        reference_text: ref,
        status: 'unresolved',
        entity_id: null,
        canonical_name: null,
        candidates: [],
        confidence: 0,
      }
    );
  }

  private validateSourceBlocks(
    output: ExtractorOutputV14,
    present: Set<string>,
    dropped: DroppedArtifactV2[],
    notes: string[],
  ): void {
    const check = (ref: string | null, field: string, refLabel: string): void => {
      if (!ref) return;
      try {
        assertSourceBlockExists(ref, present, field);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        notes.push(msg);
      }
    };

    for (const c of output.correction_signals) {
      check(c.source_block_reference, 'correction_signals', c.source_excerpt);
    }
    for (const a of output.assertions) {
      check(a.source_block_reference, 'assertions', a.subject_reference);
    }
    for (const t of output.task_signals ?? []) {
      check(
        t.source_block_reference,
        'task_signals',
        t.title ?? t.task_reference ?? t.operation,
      );
    }
  }

  private compileAliases(
    output: ExtractorOutputV14,
    resolver: MemoryResolverResult,
    negated: Set<string>,
    clarifications: CompiledClarificationCandidateV2[],
    _dropped: DroppedArtifactV2[],
    notes: string[],
  ): CompiledAliasV2[] {
    const compiled: CompiledAliasV2[] = [];

    for (const a of output.aliases) {
      const target = this.lookup(resolver, a.target_reference);
      if (target.status === 'ambiguous') {
        this.pushRegistryEntityAmbiguityClarification(output, clarifications, notes, {
          targetType: 'entity',
          targetReference: a.target_reference,
          issueType: 'ambiguous_entity_identity',
          question: `A referência "${a.target_reference}" é ambígua para o alias "${a.alias}".`,
          reason: 'alias_target_ambiguous',
          priority: 'high',
          blockingScope: 'knowledge_confirmation',
          suggestedAnswers: target.candidates.map((c) => c.canonical_name),
          sourceExcerpt: a.source_excerpt,
          source: 'compiler',
        });
      }

      compiled.push({
        alias: a.alias,
        targetReference: a.target_reference,
        targetEntityId: target.entity_id,
        targetCanonicalName: target.canonical_name,
        negatedFormerReferences: a.negated_former_references,
        sourceExcerpt: a.source_excerpt,
        confidence: a.confidence,
        sourceBlockReference: null,
      });

      for (const former of a.negated_former_references) {
        negated.add(normalizeText(former));
      }
    }

    return compiled;
  }

  private pushRegistryEntityAmbiguityClarification(
    output: ExtractorOutputV14,
    clarifications: CompiledClarificationCandidateV2[],
    notes: string[],
    candidate: CompiledClarificationCandidateV2,
  ): void {
    if (!isMvpRegistryEligibleReference(candidate.targetReference, output)) {
      notes.push(peripheralAmbiguityNote(candidate.targetReference));
      return;
    }
    clarifications.push(candidate);
  }

  private compileEntityMentions(
    output: ExtractorOutputV14,
    resolver: MemoryResolverResult,
    aliasLabels: Set<string>,
    superseded: Set<string>,
    clarifications: CompiledClarificationCandidateV2[],
    dropped: DroppedArtifactV2[],
    notes: string[],
  ): CompiledEntityReference[] {
    const result: CompiledEntityReference[] = [];

    for (const m of output.entity_mentions) {
      const norm = normalizeText(m.mention_text);
      if (superseded.has(norm)) {
        dropped.push({
          kind: 'entity_mention',
          reason: 'correction_superseded',
          originalRef: m.mention_text,
          sourceExcerpt: m.source_excerpt,
        });
        continue;
      }
      if (aliasLabels.has(norm) || CODENAME_LIKE.test(m.mention_text)) {
        dropped.push({
          kind: 'entity_mention',
          reason: 'alias_not_entity',
          originalRef: m.mention_text,
          sourceExcerpt: m.source_excerpt,
        });
        continue;
      }

      if (isMvpBlockedGenericEntityTerm(m.mention_text)) {
        dropped.push({
          kind: 'entity_mention',
          reason: 'generic_term_isolated',
          originalRef: m.mention_text,
          sourceExcerpt: m.source_excerpt,
        });
        notes.push(genericEntityTermDropNote(m.mention_text));
        continue;
      }

      if (!isMvpAutoRegistryEntityType(m.suggested_entity_type)) {
        dropped.push({
          kind: 'entity_mention',
          reason: 'non_registry_entity_type',
          originalRef: m.mention_text,
          sourceExcerpt: m.source_excerpt,
          note: m.suggested_entity_type,
        });
        notes.push(peripheralAmbiguityNote(m.mention_text));
        continue;
      }

      const resolved = this.lookup(resolver, m.mention_text);
      if (resolved.status === 'ambiguous') {
        this.pushRegistryEntityAmbiguityClarification(output, clarifications, notes, {
          targetType: 'entity',
          targetReference: m.mention_text,
          issueType: 'ambiguous_entity_identity',
          question: `Qual entidade corresponde a "${m.mention_text}"?`,
          reason: 'mention_ambiguous',
          priority: 'medium',
          blockingScope: 'knowledge_confirmation',
          suggestedAnswers: resolved.candidates.map((c) => c.canonical_name),
          sourceExcerpt: m.source_excerpt,
          source: 'resolver',
        });
      } else if (resolved.status === 'unresolved' && m.confidence < 0.5) {
        dropped.push({
          kind: 'entity_mention',
          reason: 'weak_reference',
          originalRef: m.mention_text,
          sourceExcerpt: m.source_excerpt,
        });
        continue;
      }

      result.push({
        mentionText: m.mention_text,
        suggestedEntityType: m.suggested_entity_type,
        entityId: resolved.entity_id,
        canonicalName: resolved.canonical_name,
        resolutionStatus: resolved.status,
        sourceExcerpt: m.source_excerpt,
        confidence: m.confidence,
      });
    }

    return result;
  }

  private compileEvents(
    output: ExtractorOutputV14,
    resolver: MemoryResolverResult,
    present: Set<string>,
    isStaticContext: boolean,
    superseded: Set<string>,
    clarifications: CompiledClarificationCandidateV2[],
    dropped: DroppedArtifactV2[],
    notes: string[],
    temporalAnchor?: TemporalAnchor,
  ): CompiledEventV2[] {
    if (isStaticContext && output.events.length > 0) {
      for (const ev of output.events) {
        dropped.push({
          kind: 'event',
          reason: 'static_or_panorama',
          originalRef: ev.event_kind,
          sourceExcerpt: ev.source_excerpt,
        });
      }
      return [];
    }

    const events: CompiledEventV2[] = [];

    for (const ev of output.events) {
      const primarySuperseded = ev.related_entities.some((rel) =>
        superseded.has(normalizeText(rel.entity_reference)),
      );
      if (primarySuperseded) {
        dropped.push({
          kind: 'event',
          reason: 'correction_superseded',
          originalRef: ev.event_kind,
          sourceExcerpt: ev.source_excerpt,
        });
        continue;
      }

      if (ev.episodic_confidence < EPISODIC_MIN_CONFIDENCE) {
        dropped.push({
          kind: 'event',
          reason: 'episodic_gate',
          originalRef: ev.event_kind,
          sourceExcerpt: ev.source_excerpt,
          note: `episodic_confidence=${ev.episodic_confidence}`,
        });
        continue;
      }

      const relatedEntities = ev.related_entities.map((rel) => {
        const r = this.lookup(resolver, rel.entity_reference);
        if (r.status === 'ambiguous') {
          this.pushRegistryEntityAmbiguityClarification(output, clarifications, notes, {
            targetType: 'event',
            targetReference: rel.entity_reference,
            issueType: 'ambiguous_entity_identity',
            question: `Quem é "${rel.entity_reference}" neste evento?`,
            reason: 'event_related_entity_ambiguous',
            priority: 'medium',
            blockingScope: 'knowledge_confirmation',
            suggestedAnswers: r.candidates.map((c) => c.canonical_name),
            sourceExcerpt: ev.source_excerpt,
            source: 'compiler',
          });
        }
        return {
          entityReference: rel.entity_reference,
          entityId: r.entity_id,
          canonicalName: r.canonical_name,
          relationType: rel.relation_type,
          role: rel.role,
          resolutionStatus: r.status,
        };
      });

      events.push({
        eventKind: ev.event_kind,
        title: ev.title,
        occurredAt: this.resolveEventOccurredAt(ev, temporalAnchor, notes),
        episodicConfidence: ev.episodic_confidence,
        sourceExcerpt: ev.source_excerpt,
        confidence: ev.episodic_confidence,
        relatedEntities,
        sourceBlockReference: null,
      });
    }

    return events;
  }

  private resolveEventOccurredAt(
    ev: ExtractedEvent,
    temporalAnchor: TemporalAnchor | undefined,
    notes: string[],
  ): string | null {
    if (ev.occurred_at?.trim()) return ev.occurred_at;
    if (!temporalAnchor?.receivedAt?.trim()) return null;
    if (!excerptHasRelativeTemporalHint(ev.source_excerpt)) return null;

    const literals = extractTemporalLiteralsFromExcerpt(ev.source_excerpt);
    for (const literal of literals) {
      const normalized = this.temporalNormalizer.normalize({
        literal,
        receivedAt: temporalAnchor.receivedAt,
        timezone: temporalAnchor.timezone,
      });
      if (normalized.status === 'resolved' && normalized.localDate) {
        notes.push(`event_temporal_normalized: ${literal}`);
        return normalized.instant ?? normalized.localDate;
      }
    }
    return null;
  }

  private applyCorrectionSignals(
    output: ExtractorOutputV14,
    resolver: MemoryResolverResult,
    present: Set<string>,
    superseded: Set<string>,
    negated: Set<string>,
    dropped: DroppedArtifactV2[],
    notes: string[],
  ): void {
    for (const c of output.correction_signals) {
      if (c.source_block_reference) {
        try {
          assertSourceBlockExists(c.source_block_reference, present, 'correction_signals');
        } catch {
          dropped.push({
            kind: 'assertion',
            reason: 'invalid_source_block',
            originalRef: c.correction_type,
            sourceExcerpt: c.source_excerpt,
          });
          continue;
        }
      }

      if (c.previous_reference) {
        superseded.add(normalizeText(c.previous_reference));
        negated.add(normalizeText(c.previous_reference));
      }

      if (c.correction_type === 'invalidate_alias' && c.previous_reference) {
        negated.add(normalizeText(c.previous_reference));
      }

      if (c.current_reference) {
        const cur = this.lookup(resolver, c.current_reference);
        if (cur.status === 'ambiguous') {
          notes.push(`correction current_reference ambiguous: ${c.current_reference}`);
        }
      }

      notes.push(
        `correction:${c.correction_type} ${c.previous_reference ?? '—'} → ${c.current_reference ?? '—'}`,
      );
    }
  }

  private compileAssertions(
    output: ExtractorOutputV14,
    resolver: MemoryResolverResult,
    present: Set<string>,
    superseded: Set<string>,
    negated: Set<string>,
    clarifications: CompiledClarificationCandidateV2[],
    dropped: DroppedArtifactV2[],
    notes: string[],
  ): CompiledAssertionV2[] {
    const result: CompiledAssertionV2[] = [];

    for (const a of output.assertions) {
      const subjNorm = normalizeText(a.subject_reference);
      const objNorm = a.object_reference ? normalizeText(a.object_reference) : null;
      if (
        superseded.has(subjNorm) ||
        negated.has(subjNorm) ||
        (objNorm != null && (superseded.has(objNorm) || negated.has(objNorm)))
      ) {
        dropped.push({
          kind: 'assertion',
          reason: 'correction_superseded',
          originalRef: a.subject_reference,
          sourceExcerpt: a.source_excerpt,
        });
        continue;
      }

      if (a.source_block_reference) {
        try {
          assertSourceBlockExists(a.source_block_reference, present, 'assertions');
        } catch {
          dropped.push({
            kind: 'assertion',
            reason: 'invalid_source_block',
            originalRef: a.subject_reference,
            sourceExcerpt: a.source_excerpt,
          });
          continue;
        }
      }

      if (a.assertion_kind === 'status_update' && !a.value_text?.trim()) {
        dropped.push({
          kind: 'assertion',
          reason: 'status_update_missing_value',
          originalRef: a.subject_reference,
          sourceExcerpt: a.source_excerpt,
        });
        clarifications.push({
          targetType: 'assertion',
          targetReference: a.subject_reference,
          issueType: 'status_update_missing_value',
          question: `Qual é o novo valor vigente de status para ${a.subject_reference}?`,
          reason: 'status_update_missing_value',
          priority: 'high',
          blockingScope: 'knowledge_confirmation',
          suggestedAnswers: [],
          sourceExcerpt: a.source_excerpt,
          source: 'compiler',
        });
        continue;
      }

      const subject = this.lookup(resolver, a.subject_reference);
      if (subject.status === 'ambiguous') {
        this.pushRegistryEntityAmbiguityClarification(output, clarifications, notes, {
          targetType: 'assertion',
          targetReference: a.subject_reference,
          issueType: 'ambiguous_entity_identity',
          question: `Sujeito ambíguo na afirmação: ${a.subject_reference}`,
          reason: 'assertion_subject_ambiguous',
          priority: 'medium',
          blockingScope: 'knowledge_confirmation',
          suggestedAnswers: subject.candidates.map((c) => c.canonical_name),
          sourceExcerpt: a.source_excerpt,
          source: 'resolver',
        });
      }

      result.push({
        assertionKind: a.assertion_kind,
        subjectReference: a.subject_reference,
        predicate: a.predicate,
        objectReference: a.object_reference,
        valueText: a.value_text,
        relatedEntityReferences: a.related_entity_references,
        sourceExcerpt: a.source_excerpt,
        sourceBlockReference: a.source_block_reference,
        confidence: a.confidence,
        subjectEntityId: subject.entity_id,
      });
    }

    return result;
  }

  private compileTaskSignals(
    output: ExtractorOutputV14,
    resolver: MemoryResolverResult,
    present: Set<string>,
    superseded: Set<string>,
    clarifications: CompiledClarificationCandidateV2[],
    dropped: DroppedArtifactV2[],
    notes: string[],
    resolutionByIndex: Map<number, TaskSignalContextResolution>,
    temporalAnchor?: TemporalAnchor,
  ): {
    tasks: CompiledTaskV2[];
    evidence: ContextResolutionEvidence[];
    contextResolved: string[];
    contextAmbiguous: string[];
  } {
    const byKey = new Map<string, CompiledTaskV2>();
    const evidence: ContextResolutionEvidence[] = [];
    const contextResolved: string[] = [];
    const contextAmbiguous: string[] = [];

    for (const [signalIndex, signal] of (output.task_signals ?? []).entries()) {
      const dropRef = signal.title ?? signal.task_reference ?? signal.operation;
      const ctxRes = resolutionByIndex.get(signalIndex);

      if (
        signal.assignee_reference &&
        superseded.has(normalizeText(signal.assignee_reference))
      ) {
        dropped.push({
          kind: 'task',
          reason: 'correction_superseded',
          originalRef: dropRef,
          sourceExcerpt: signal.source_excerpt,
        });
        continue;
      }

      let effectiveSignal = signal;
      if (ctxRes?.outcome.status === 'resolved' && ctxRes.outcome.canonicalReference) {
        effectiveSignal = {
          ...signal,
          task_reference: ctxRes.outcome.canonicalReference,
        };
        notes.push(
          `context_resolved_task[${signalIndex}]: ${ctxRes.outcome.canonicalReference} (${ctxRes.outcome.resolutionReason})`,
        );
        if (ctxRes.outcome.resolutionSource && ctxRes.outcome.taskId) {
          evidence.push({
            taskSignalIndex: signalIndex,
            taskId: ctxRes.outcome.taskId,
            resolutionSource: ctxRes.outcome.resolutionSource,
            bestScore: ctxRes.outcome.bestScore,
            secondBestScore: ctxRes.outcome.secondBestScore,
            scoreMargin: ctxRes.outcome.scoreMargin,
            candidateCountBeforeTruncation: ctxRes.outcome.candidateCountBeforeTruncation,
            resolutionReason: ctxRes.outcome.resolutionReason,
          });
          contextResolved.push(ctxRes.outcome.canonicalReference);
        }
      } else if (ctxRes?.outcome.status === 'ambiguous') {
        contextAmbiguous.push(dropRef);
        clarifications.push({
          targetType: 'task',
          targetReference: dropRef,
          issueType: 'ambiguous_task_reference',
          question: `Qual tarefa corresponde a "${dropRef}"?`,
          reason: 'context_ambiguous_task_match',
          priority: 'high',
          blockingScope: 'task_execution',
          suggestedAnswers: (ctxRes.outcome.candidates ?? []).map((c) => c.reference),
          sourceExcerpt: signal.source_excerpt,
          source: 'compiler',
        });
      }

      const invalidReason = this.validateTaskSignalMaterial(effectiveSignal);
      if (invalidReason) {
        dropped.push({
          kind: 'task',
          reason: 'weak_reference',
          originalRef: dropRef,
          sourceExcerpt: signal.source_excerpt,
          note: invalidReason,
        });
        notes.push(invalidReason);
        if (effectiveSignal.operation !== 'create' && !effectiveSignal.task_reference?.trim()) {
          clarifications.push({
            targetType: 'task',
            targetReference: dropRef,
            issueType: 'missing_task_reference',
            question: `Qual tarefa corresponde à operação ${effectiveSignal.operation}?`,
            reason: 'task_reference_missing_for_update',
            priority: 'high',
            blockingScope: 'task_execution',
            suggestedAnswers: [],
            sourceExcerpt: effectiveSignal.source_excerpt,
            source: 'compiler',
          });
        }
        continue;
      }

      if (effectiveSignal.source_block_reference) {
        try {
          assertSourceBlockExists(effectiveSignal.source_block_reference, present, 'task_signals');
        } catch {
          dropped.push({
            kind: 'task',
            reason: 'invalid_source_block',
            originalRef: dropRef,
            sourceExcerpt: effectiveSignal.source_excerpt,
          });
          continue;
        }
      }

      const assignee = effectiveSignal.assignee_reference
        ? this.lookup(resolver, effectiveSignal.assignee_reference)
        : null;
      const project = effectiveSignal.project_reference
        ? this.lookup(resolver, effectiveSignal.project_reference)
        : null;

      if (assignee?.status === 'ambiguous') {
        clarifications.push({
          targetType: 'task',
          targetReference:
            effectiveSignal.title ?? effectiveSignal.task_reference ?? dropRef,
          issueType: 'ambiguous_entity_identity',
          question: `Responsável ambíguo: ${effectiveSignal.assignee_reference}`,
          reason: 'task_assignee_ambiguous',
          priority: 'medium',
          blockingScope: 'task_execution',
          suggestedAnswers: assignee.candidates.map((c) => c.canonical_name),
          sourceExcerpt: effectiveSignal.source_excerpt,
          source: 'compiler',
        });
      }

      const { statusSignal, note } = this.resolveTaskStatusSignal(effectiveSignal);
      if (note) notes.push(note);

      const dueAt = effectiveSignal.due_at;
      const dueAtTemporal = this.resolveDueAtTemporal(dueAt, temporalAnchor);

      const compiled: CompiledTaskV2 = {
        operation: effectiveSignal.operation,
        taskReference: effectiveSignal.task_reference,
        title: effectiveSignal.title ?? effectiveSignal.task_reference ?? '(sem título)',
        taskKind: effectiveSignal.task_kind ?? 'other',
        statusSignal,
        assigneeReference: effectiveSignal.assignee_reference,
        targetReference: effectiveSignal.target_reference,
        projectReference: effectiveSignal.project_reference,
        assigneeEntityId: assignee?.entity_id ?? null,
        projectEntityId: project?.entity_id ?? null,
        dueAt,
        dueAtTemporal,
        blockedReason: effectiveSignal.blocked_reason,
        sourceExcerpt: effectiveSignal.source_excerpt,
        sourceBlockReference: effectiveSignal.source_block_reference,
        confidence: effectiveSignal.confidence,
      };

      const key = `${effectiveSignal.operation}:${normalizeText(effectiveSignal.task_reference ?? effectiveSignal.title ?? dropRef)}`;
      const existing = byKey.get(key);
      if (!existing || effectiveSignal.confidence > existing.confidence) {
        byKey.set(key, compiled);
      }
    }

    return {
      tasks: [...byKey.values()],
      evidence,
      contextResolved,
      contextAmbiguous,
    };
  }

  private resolveDueAtTemporal(
    dueAt: string | null | undefined,
    temporalAnchor?: TemporalAnchor,
  ) {
    if (dueAt == null || !String(dueAt).trim()) {
      return null;
    }
    const literal = dueAt;
    if (!temporalAnchor?.receivedAt?.trim()) {
      return buildMissingTemporalAnchorResult(literal);
    }
    return this.temporalNormalizer.normalize({
      literal,
      receivedAt: temporalAnchor.receivedAt,
      timezone: temporalAnchor.timezone,
    });
  }

  private validateTaskSignalMaterial(signal: ExtractedTaskSignal): string | null {
    switch (signal.operation) {
      case 'create':
        return signal.title?.trim() ? null : 'create missing title';
      case 'update_status':
        if (!signal.task_reference?.trim()) return 'update_status missing task_reference';
        return signal.status_signal ? null : 'update_status missing status_signal';
      case 'update_due_date':
        if (!signal.task_reference?.trim()) return 'update_due_date missing task_reference';
        return signal.due_at?.trim() ? null : 'update_due_date missing due_at';
      case 'update_assignee':
        if (!signal.task_reference?.trim()) return 'update_assignee missing task_reference';
        return signal.assignee_reference?.trim() ? null : 'update_assignee missing assignee_reference';
      case 'update_blocker':
        if (!signal.task_reference?.trim()) return 'update_blocker missing task_reference';
        return signal.blocked_reason?.trim() ? null : 'update_blocker missing blocked_reason';
      case 'complete':
        if (!signal.task_reference?.trim()) return 'complete missing task_reference';
        if (signal.status_signal != null && signal.status_signal !== 'completed') {
          return 'complete conflicting status_signal';
        }
        return null;
      case 'cancel':
        if (!signal.task_reference?.trim()) return 'cancel missing task_reference';
        if (signal.status_signal != null && signal.status_signal !== 'cancelled') {
          return 'cancel conflicting status_signal';
        }
        return null;
      default:
        return null;
    }
  }

  private resolveTaskStatusSignal(signal: ExtractedTaskSignal): { statusSignal: string; note?: string } {
    if (signal.operation === 'complete') {
      if (signal.status_signal == null) {
        return { statusSignal: 'completed', note: `coerced status completed for ${signal.task_reference}` };
      }
      return { statusSignal: 'completed' };
    }
    if (signal.operation === 'cancel') {
      if (signal.status_signal == null) {
        return { statusSignal: 'cancelled', note: `coerced status cancelled for ${signal.task_reference}` };
      }
      return { statusSignal: 'cancelled' };
    }
    if (signal.operation === 'update_blocker') {
      return { statusSignal: signal.status_signal ?? 'blocked' };
    }
    if (signal.operation === 'create') {
      return { statusSignal: signal.status_signal ?? 'open' };
    }
    return { statusSignal: signal.status_signal ?? 'unknown' };
  }

  private computeDecision(
    clarifications: CompiledClarificationCandidateV2[],
    dropped: DroppedArtifactV2[],
    reviewHints: CompiledReviewHintV2[],
    notes: string[],
    extractorOutput: ExtractorOutputV14,
  ): CompilerDecision {
    const blocking = clarifications.filter(
      (c) => c.blockingScope !== 'none' && c.priority !== 'low',
    );

    if (
      blocking.some(
        (c) =>
          c.issueType === 'ambiguous_entity_identity' &&
          isMvpRegistryEligibleReference(c.targetReference, extractorOutput),
      )
    ) {
      return {
        status: 'needs_clarification',
        reasons: ['ambiguous_identity_material'],
        confidence: 0.7,
      };
    }

    if (blocking.length > 0) {
      return {
        status: 'needs_clarification',
        reasons: blocking.map((c) => c.reason),
        confidence: 0.75,
      };
    }

    if (
      reviewHints.some((h) => h.issueType === 'possible_contradiction') &&
      reviewHints[0]!.confidence >= 0.8
    ) {
      return {
        status: 'needs_llm_review',
        reasons: ['possible_contradiction_hint'],
        confidence: 0.6,
      };
    }

    if (notes.length > 5) {
      return {
        status: 'needs_llm_review',
        reasons: ['high_compiler_note_volume'],
        confidence: 0.55,
      };
    }

    return {
      status: 'accepted',
      reasons: ['compiled_without_blocking_issues'],
      confidence: 0.9,
    };
  }

  private appendGenericFornecedorTargetClarifications(
    tasks: CompiledTaskV2[],
    clarifications: CompiledClarificationCandidateV2[],
  ): void {
    for (const task of tasks) {
      if (!this.isGenericFornecedorCreateTask(task)) continue;
      const targetReference = task.title.trim();
      const already = clarifications.some(
        (c) =>
          c.issueType === 'missing_task_target' &&
          normalizeText(c.targetReference) === normalizeText(targetReference),
      );
      if (already) continue;
      clarifications.push({
        targetType: 'task',
        targetReference,
        issueType: 'missing_task_target',
        question: GENERIC_FORNECEDOR_QUESTION,
        reason: 'A tarefa não identifica qual fornecedor deve ser cobrado.',
        priority: 'medium',
        blockingScope: 'task_execution',
        suggestedAnswers: [],
        sourceExcerpt: task.sourceExcerpt,
        source: 'compiler',
      });
    }
  }

  private isGenericFornecedorCreateTask(task: CompiledTaskV2): boolean {
    if (task.operation !== 'create') return false;
    const blob = `${task.title} ${task.sourceExcerpt}`;
    if (!/\bfornecedor\b/i.test(blob)) return false;
    if (!this.isUnspecifiedFornecedorTarget(task.targetReference)) return false;
    if (/\bfornecedor\s+(?:da|do|de|d')\s+[\wÀ-ú]/i.test(blob)) return false;
    return true;
  }

  private isUnspecifiedFornecedorTarget(targetReference: string | null | undefined): boolean {
    if (!targetReference?.trim()) return true;
    const norm = normalizeText(targetReference);
    return norm === 'fornecedor' || norm === 'o fornecedor' || norm === 'fornecedores';
  }
}
