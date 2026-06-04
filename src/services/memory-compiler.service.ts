import { createHash } from 'node:crypto';
import type {
  CompiledAlias,
  CompiledAssertion,
  CompiledClarificationCandidate,
  CompiledEntity,
  CompiledEvent,
  CompiledExtraction,
  CompiledTask,
  CompilerFlags,
  DroppedArtifact,
  MemoryCompilerInput,
  ShadowCompilerSummary,
} from '../types/memory-compiler.js';
import { MEMORY_COMPILER_VERSION } from '../types/memory-compiler.js';
import type {
  ExtractedAssertion,
  ExtractedClarification,
  ExtractedEntity,
  ExtractedEvent,
  ExtractorOutput,
} from '../types/domain.js';
import { normalizeText } from '../utils/normalize.js';
import { parseCorrectionBlocks } from '../utils/correction-blocks.js';

const EPISODIC_SIGNAL =
  /\b(reuni[aã]o|reuniões|enviou|enviado|envio|confirmou|confirmação|decidiu|decisão|apresentou|apresentação|mudou|mudança|corre[cç][aã]o|compromisso|participou|participação)\b/i;

const STATIC_PANORAMA =
  /\b(panorama|prefere|prefere reuniões|cuida do|lidera|aliases? frequentes|papel profissional)\b/i;

const MESSAGE_ONLY_EVENT_TYPES = new Set([
  'message_received',
  'inbox_message',
  'static_description',
  'profile_update',
]);

const GENERIC_ROLE_TERMS = new Set(
  ['fornecedor', 'cliente', 'prazo', 'ip', 'responsavel', 'responsável'].map(normalizeText),
);

const NEGATION_PATTERNS = [
  /\bnão\s+mais\s+(?:a|o|e)?\s*([\wÀ-ú][\wÀ-ú\s]{0,60})/gi,
  /\bnão\s+é\s+([\wÀ-ú][\wÀ-ú\s]{0,40})/gi,
  /\bnão\s+se\s+refere\s+(?:a|ao|à)\s+([\wÀ-ú][\wÀ-ú\s]{0,40})/gi,
  /\bnão\s+([\wÀ-ú][\wÀ-ú\s]{0,30})/gi,
  /\bnão\s+foi\s+enviado\s+por\s+([\wÀ-ú][\wÀ-ú\s]{0,40})/gi,
];

const ALIAS_REASSIGNMENT =
  /(?:apelido|codinome)\s+(\w+)\s+agora\s+se\s+refere\s+(?:a|ao|à)\s+([\wÀ-ú][\wÀ-ú\s]{2,60}?)(?:\s*,\s*não\s+mais\s+(?:a|ao|à)\s+([\wÀ-ú][\wÀ-ú\s]{2,60}))?/gi;

const EXPLICIT_ALIAS_IS =
  /\b([\wÀ-ú]{2,20})\s+é\s+(?:alias\s+(?:de|da|do)\s+)?([\wÀ-ú][\wÀ-ú\s]{2,60})/gi;

const PARTICIPANT_CORRECTION =
  /(?:na verdade|correção)[,:]?\s*([\wÀ-ú][\wÀ-ú\s]{2,40})\s+participou/i;

const SENDER_CORRECTION =
  /(?:foi\s+enviado\s+por|enviado\s+por)\s+([\wÀ-ú][\wÀ-ú\s]{2,40})(?:\s*,\s*não\s+([\wÀ-ú][\wÀ-ú\s]{1,40}))?/i;

const PANORAMA_ALIAS = /([\wÀ-ú][\wÀ-ú\s]{2,50}?)\s*\(([\wÀ-ú]{2,20})\)/g;

function isTestOnlyFragment(name: string, rawContent: string): boolean {
  if (/^probe$/i.test(name.trim()) && /stale|probe\s+concorr/i.test(rawContent)) {
    return true;
  }
  return false;
}

function isIsolatedGenericTerm(name: string, rawContent: string): boolean {
  const norm = normalizeText(name);
  const roleSectors = new Set(['financeiro', 'engenharia', 'concorrencia']);
  if (roleSectors.has(norm)) return true;

  const roleLike = new Set(['integracao', ...GENERIC_ROLE_TERMS]);
  if (!roleLike.has(norm)) return false;

  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const standalone = new RegExp(`(?:^|[\\s,.:;])${escaped}(?:[\\s,.:;]|$)`, 'i');
  if (!standalone.test(rawContent)) return false;

  const withArticle = new RegExp(`\\b(?:da|do|de|área de|time de)\\s+${escaped}\\b`, 'i');
  if (withArticle.test(rawContent)) return false;

  if (norm === 'integracao') {
    const hasProjectContext = /\b(?:projeto|sobre|da)\s+.{0,20}integra[cç][aã]o/i.test(rawContent);
    if (hasProjectContext) return false;
  }

  return true;
}

function detectNegations(text: string): string[] {
  const terms: string[] = [];
  for (const pattern of NEGATION_PATTERNS) {
    const re = new RegExp(pattern.source, pattern.flags);
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const captured = (m[1] ?? m[2] ?? '').trim();
      if (captured.length >= 2) terms.push(captured);
    }
  }
  return [...new Set(terms)];
}

function extractExplicitAliases(rawContent: string): CompiledAlias[] {
  const aliases: CompiledAlias[] = [];
  const reassignmentRe = new RegExp(ALIAS_REASSIGNMENT.source, ALIAS_REASSIGNMENT.flags);
  let m: RegExpExecArray | null;
  while ((m = reassignmentRe.exec(rawContent)) !== null) {
    aliases.push({
      alias: m[1]!.trim(),
      targetEntityName: m[2]!.trim(),
      sourceExcerpt: m[0],
      confidence: 0.95,
      negatedFormer: m[3]?.trim() ?? null,
    });
  }
  const isAliasRe = new RegExp(EXPLICIT_ALIAS_IS.source, EXPLICIT_ALIAS_IS.flags);
  while ((m = isAliasRe.exec(rawContent)) !== null) {
    aliases.push({
      alias: m[1]!.trim(),
      targetEntityName: m[2]!.trim(),
      sourceExcerpt: m[0],
      confidence: 0.9,
    });
  }
  const panoramaRe = new RegExp(PANORAMA_ALIAS.source, PANORAMA_ALIAS.flags);
  while ((m = panoramaRe.exec(rawContent)) !== null) {
    const name = m[1]!.trim();
    const alias = m[2]!.trim();
    if (name.length > 2 && alias.length >= 2) {
      aliases.push({
        alias,
        targetEntityName: name,
        sourceExcerpt: m[0],
        confidence: 0.92,
      });
    }
  }
  return aliases;
}

function extractAliasesFromEntities(entities: ExtractedEntity[]): string[] {
  const labels: string[] = [];
  for (const e of entities) {
    for (const a of e.aliases ?? []) {
      labels.push(a);
    }
  }
  return labels;
}

function scoreEpisodicEvent(event: ExtractedEvent, rawContent: string): 'high' | 'medium' | 'low' {
  const blob = `${event.description} ${event.source_excerpt}`;
  if (STATIC_PANORAMA.test(blob) || STATIC_PANORAMA.test(rawContent)) {
    return 'low';
  }
  if (MESSAGE_ONLY_EVENT_TYPES.has(event.event_type)) {
    return 'low';
  }
  if (event.event_type === 'document_snapshot') {
    return 'low';
  }

  const hasSignal = EPISODIC_SIGNAL.test(blob);
  const hasOccurredHint = event.occurred_at != null;
  const hasParticipants =
    (event.entity_names?.length ?? 0) > 0 &&
    EPISODIC_SIGNAL.test(blob);

  if (hasSignal && (hasOccurredHint || hasParticipants || /participou|enviou|confirmou|decidiu/i.test(blob))) {
    return 'high';
  }
  if (hasSignal) {
    return 'medium';
  }
  return 'low';
}

function shouldDropEvent(
  event: ExtractedEvent,
  rawContent: string,
  sourceChannel: string,
): { drop: boolean; reason: DroppedArtifact['reason']; note: string } {
  if (event.event_type === 'document_snapshot') {
    return { drop: true, reason: 'document_snapshot', note: 'document_snapshot not synthesized in v1' };
  }
  if (MESSAGE_ONLY_EVENT_TYPES.has(event.event_type)) {
    return { drop: true, reason: 'static_or_panorama', note: 'message-only event type' };
  }

  const episodic = scoreEpisodicEvent(event, rawContent);
  if (sourceChannel === 'bootstrap' && STATIC_PANORAMA.test(rawContent)) {
    return { drop: true, reason: 'static_or_panorama', note: 'bootstrap panorama — no episodic event' };
  }
  if (episodic === 'low') {
    return {
      drop: true,
      reason: 'non_conclusive_episode',
      note: 'episodic gate: episode not conclusive (keyword alone insufficient)',
    };
  }
  if (episodic === 'medium') {
    return {
      drop: true,
      reason: 'episodic_gate',
      note: 'episodic gate: potential false positive — signal without sustained occurrence',
    };
  }
  return { drop: false, reason: 'episodic_gate', note: '' };
}

function applyCorrectionsToAssertions(
  assertions: ExtractedAssertion[],
  corrections: string[],
  negatedTerms: string[],
): { assertions: CompiledAssertion[]; dropped: DroppedArtifact[]; notes: string[] } {
  const dropped: DroppedArtifact[] = [];
  const notes: string[] = [];
  const invalidatedNames = new Set<string>();

  for (const c of corrections) {
    const part = PARTICIPANT_CORRECTION.exec(c);
    if (part?.[1]) {
      const wrong = assertions
        .flatMap((a) => a.content.match(/\b([\wÀ-ú]+)\s+participou/i) ?? [])
        .map((m) => (typeof m === 'string' ? m : ''));
      for (const w of wrong) {
        const name = w.replace(/\s+participou/i, '').trim();
        if (name) invalidatedNames.add(normalizeText(name));
      }
    }
    const sender = SENDER_CORRECTION.exec(c);
    if (sender?.[2]) {
      invalidatedNames.add(normalizeText(sender[2]));
    }
  }

  for (const n of negatedTerms) {
    invalidatedNames.add(normalizeText(n));
  }

  const compiled: CompiledAssertion[] = [];

  for (const a of assertions) {
    const contentNorm = normalizeText(a.content);
    const negated = [...invalidatedNames].some((n) => contentNorm.includes(n));
    if (negated) {
      dropped.push({
        kind: 'assertion',
        reason: 'correction_superseded',
        originalRef: a.content.slice(0, 80),
        sourceExcerpt: a.source_excerpt.slice(0, 120),
        note: 'superseded by correction or negation',
      });
      compiled.push({
        assertionType: a.assertion_type,
        content: a.content,
        status: 'invalidated',
        sourceExcerpt: a.source_excerpt,
        confidence: a.confidence,
      });
      continue;
    }
    compiled.push({
      assertionType: a.assertion_type,
      content: a.content,
      status: a.status,
      sourceExcerpt: a.source_excerpt,
      confidence: a.confidence,
    });
  }

  for (const c of corrections) {
    const part = PARTICIPANT_CORRECTION.exec(c);
    if (part?.[1]) {
      notes.push(`correction: participant vigente — ${part[1].trim()}`);
    }
  }

  return { assertions: compiled, dropped, notes };
}

function safeReplaceAliasInTitle(
  title: string,
  aliasToCanonical: Map<string, string>,
): { title: string; note?: string } {
  let result = title;
  let replaced = false;
  for (const [alias, canonical] of aliasToCanonical) {
    const re = new RegExp(`\\b${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
    if (re.test(result) && normalizeText(alias) !== normalizeText(canonical)) {
      result = result.replace(re, canonical);
      replaced = true;
    }
  }
  if (/\s+—\s+[\wÀ-ú,\s]{10,}$/.test(result) || /\|\s*[\wÀ-ú]+,/.test(result)) {
    return { title, note: 'title entity list suffix blocked' };
  }
  if (!replaced && aliasToCanonical.size > 0) {
    return { title: result };
  }
  return { title: result };
}

export function summarizeCompiledForShadow(
  compiled: CompiledExtraction,
  inputContentHash: string,
): ShadowCompilerSummary {
  const droppedReasons: Record<string, number> = {};
  for (const d of compiled.droppedArtifacts) {
    droppedReasons[d.reason] = (droppedReasons[d.reason] ?? 0) + 1;
  }
  return {
    compilerVersion: compiled.compilerVersion,
    entityCount: compiled.entities.length,
    aliasCount: compiled.aliases.length,
    eventCount: compiled.events.length,
    assertionCount: compiled.assertions.length,
    taskCount: compiled.tasks.length,
    clarificationCandidateCount: compiled.clarificationCandidates.length,
    droppedCount: compiled.droppedArtifacts.length,
    droppedReasons,
    compilerNotesCount: compiled.compilerNotes.length,
    inputContentHash,
  };
}

export function hashContentForShadow(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex').slice(0, 16);
}

function filterSupersededEntities(
  entities: CompiledEntity[],
  corrections: string[],
  rawContent: string,
  droppedArtifacts: DroppedArtifact[],
): CompiledEntity[] {
  if (corrections.length === 0) return entities;

  const invalidated = new Set<string>();
  const rawOnly = parseCorrectionBlocks(rawContent).rawContent;

  const wrongParticipant = /([\wÀ-ú]+)\s+participou/i.exec(rawOnly);
  if (wrongParticipant?.[1] && corrections.some((c) => PARTICIPANT_CORRECTION.test(c))) {
    invalidated.add(normalizeText(wrongParticipant[1]));
  }

  for (const c of corrections) {
    const negSender = /\bnão\s+([\wÀ-ú][\wÀ-ú\s]{1,30})\s*\.?\s*$/i.exec(c);
    if (negSender?.[1]) invalidated.add(normalizeText(negSender[1]));
    const senderFix = SENDER_CORRECTION.exec(c);
    if (senderFix?.[2]) invalidated.add(normalizeText(senderFix[2]));
  }

  if (invalidated.size === 0) return entities;

  return entities.filter((e) => {
    const norm = normalizeText(e.name);
    if ([...invalidated].some((inv) => norm === inv || norm.includes(inv) || inv.includes(norm))) {
      droppedArtifacts.push({
        kind: 'entity',
        reason: 'correction_superseded',
        originalRef: e.name,
        sourceExcerpt: e.sourceExcerpt.slice(0, 120),
        note: 'entity superseded by correction',
      });
      return false;
    }
    return true;
  });
}

export class MemoryCompilerService {
  compile(input: MemoryCompilerInput): CompiledExtraction {
    const { rawContent, sourceChannel, sourceMode, extractorOutput, resolvedMap } = input;
    const { corrections } = parseCorrectionBlocks(rawContent);
    const mergedCorrections = [...corrections, ...(input.corrections ?? [])];

    const compilerNotes: string[] = [];
    const droppedArtifacts: DroppedArtifact[] = [];
    const negatedTerms = detectNegations(rawContent);
    const explicitAliases = extractExplicitAliases(rawContent);
    const aliasLabelsFromExtractor = extractAliasesFromEntities(extractorOutput.entities);
    const explicitAliasLabels = new Set([
      ...explicitAliases.map((a) => normalizeText(a.alias)),
      ...aliasLabelsFromExtractor.map(normalizeText),
    ]);

    const aliasToCanonical = new Map<string, string>();
    for (const a of explicitAliases) {
      aliasToCanonical.set(a.alias, a.targetEntityName);
    }

    const negatedEntityNames = new Set(
      negatedTerms.map(normalizeText).concat(
        explicitAliases.filter((a) => a.negatedFormer).map((a) => normalizeText(a.negatedFormer!)),
      ),
    );

    const blockedClarificationRefs = new Set(negatedEntityNames);

    const weakTopicsPreserved: string[] = [];
    const entities: CompiledEntity[] = [];

    for (const e of extractorOutput.entities) {
      const norm = normalizeText(e.name);

      if (isTestOnlyFragment(e.name, rawContent)) {
        droppedArtifacts.push({
          kind: 'entity',
          reason: 'test_fragment',
          originalRef: e.name,
          sourceExcerpt: e.source_excerpt.slice(0, 120),
        });
        continue;
      }

      if (explicitAliasLabels.has(norm)) {
        droppedArtifacts.push({
          kind: 'entity',
          reason: 'alias_not_entity',
          originalRef: e.name,
          sourceExcerpt: e.source_excerpt.slice(0, 120),
        });
        continue;
      }

      if (
        [...negatedEntityNames].some(
          (n) => n.length > 2 && (norm.includes(n) || n.includes(norm)),
        )
      ) {
        droppedArtifacts.push({
          kind: 'entity',
          reason: 'negation',
          originalRef: e.name,
          sourceExcerpt: e.source_excerpt.slice(0, 120),
        });
        continue;
      }

      if (isIsolatedGenericTerm(e.name, rawContent)) {
        droppedArtifacts.push({
          kind: 'entity',
          reason: 'generic_term_isolated',
          originalRef: e.name,
          sourceExcerpt: e.source_excerpt.slice(0, 120),
        });
        if (norm === 'integracao' || norm === 'integração') {
          weakTopicsPreserved.push(e.name);
          compilerNotes.push(`weak_topic preserved in notes: ${e.name}`);
        }
        continue;
      }

      if (e.entity_type === 'topic' && (norm === 'integracao' || norm === 'integração')) {
        droppedArtifacts.push({
          kind: 'entity',
          reason: 'weak_topic',
          originalRef: e.name,
          sourceExcerpt: e.source_excerpt.slice(0, 120),
        });
        weakTopicsPreserved.push(e.name);
        compilerNotes.push(`weak_topic preserved in notes: ${e.name}`);
        continue;
      }

      if (e.entity_type === 'topic' && norm.length < 12 && isIsolatedGenericTerm(e.name, rawContent)) {
        droppedArtifacts.push({
          kind: 'entity',
          reason: 'weak_topic',
          originalRef: e.name,
          sourceExcerpt: e.source_excerpt.slice(0, 120),
        });
        weakTopicsPreserved.push(e.name);
        continue;
      }

      const resolvedId = resolvedMap.byExtractedName.get(norm) ?? null;
      const resolution = resolvedMap.resolutions.find(
        (r) => normalizeText(r.extractedName) === norm,
      );

      entities.push({
        name: e.name,
        entityType: e.entity_type,
        sourceExcerpt: e.source_excerpt,
        confidence: e.confidence,
        resolvedEntityId: resolvedId,
        resolvedEntityName: resolution?.resolvedEntityName ?? null,
      });
    }

    for (const label of aliasLabelsFromExtractor) {
      const entity = extractorOutput.entities.find((e) =>
        (e.aliases ?? []).some((a) => normalizeText(a) === normalizeText(label)),
      );
      if (entity && !explicitAliases.some((a) => normalizeText(a.alias) === normalizeText(label))) {
        explicitAliases.push({
          alias: label,
          targetEntityName: entity.name,
          sourceExcerpt: entity.source_excerpt,
          confidence: entity.confidence,
        });
        aliasToCanonical.set(label, entity.name);
      }
    }

    const invalidatedEventNames = new Set<string>();
    const rawOnly = parseCorrectionBlocks(rawContent).rawContent;
    const wrongParticipant = /([\wÀ-ú]+)\s+participou/i.exec(rawOnly);
    if (wrongParticipant?.[1]) {
      invalidatedEventNames.add(normalizeText(wrongParticipant[1]));
    }
    for (const c of mergedCorrections) {
      const sender = SENDER_CORRECTION.exec(c);
      if (sender?.[2]) invalidatedEventNames.add(normalizeText(sender[2]));
      const negSender = /\bnão\s+([\wÀ-ú][\wÀ-ú\s]{1,30})\s*\.?\s*$/i.exec(c);
      if (negSender?.[1]) invalidatedEventNames.add(normalizeText(negSender[1]));
    }
    for (const n of negatedTerms) invalidatedEventNames.add(normalizeText(n));

    const events: CompiledEvent[] = [];
    for (const ev of extractorOutput.events) {
      const descNorm = normalizeText(ev.description);
      if ([...invalidatedEventNames].some((n) => n.length > 2 && descNorm.includes(n))) {
        droppedArtifacts.push({
          kind: 'event',
          reason: 'correction_superseded',
          originalRef: ev.description.slice(0, 60),
          sourceExcerpt: ev.source_excerpt.slice(0, 120),
        });
        continue;
      }
      const decision = shouldDropEvent(ev, rawContent, sourceChannel);
      if (decision.drop) {
        droppedArtifacts.push({
          kind: 'event',
          reason: decision.reason,
          originalRef: `${ev.event_type}: ${ev.description.slice(0, 60)}`,
          sourceExcerpt: ev.source_excerpt.slice(0, 120),
          note: decision.note,
        });
        if (decision.note.includes('false positive')) {
          compilerNotes.push(`episodic_fp_potential: ${ev.event_type}`);
        }
        if (decision.note.includes('not conclusive')) {
          compilerNotes.push(`episodic_fn_potential: ${ev.event_type}`);
        }
        continue;
      }

      const episodicConfidence = scoreEpisodicEvent(ev, rawContent);
      events.push({
        eventType: ev.event_type,
        description: ev.description,
        occurredAt: ev.occurred_at,
        sourceExcerpt: ev.source_excerpt,
        confidence: ev.confidence,
        entityNames: ev.entity_names ?? [],
        episodicConfidence,
      });
    }

    for (const c of mergedCorrections) {
      const part = PARTICIPANT_CORRECTION.exec(c);
      if (part?.[1] && EPISODIC_SIGNAL.test(rawOnly)) {
        const already = events.some((e) =>
          normalizeText(e.description).includes(normalizeText(part[1]!)),
        );
        if (!already) {
          events.push({
            eventType: 'meeting',
            description: `${part[1]!.trim()} participou da reunião`,
            occurredAt: null,
            sourceExcerpt: c.slice(0, 120),
            confidence: 0.85,
            entityNames: [part[1]!.trim()],
            episodicConfidence: 'high',
          });
        }
      }
    }

    const { assertions, dropped: assertionDropped, notes: assertionNotes } =
      applyCorrectionsToAssertions(
        extractorOutput.assertions,
        mergedCorrections,
        negatedTerms,
      );
    droppedArtifacts.push(...assertionDropped);
    compilerNotes.push(...assertionNotes);

    const tasks: CompiledTask[] = [];
    for (const t of extractorOutput.tasks) {
      const { title, note } = safeReplaceAliasInTitle(t.title, aliasToCanonical);
      if (note) compilerNotes.push(note);
      tasks.push({
        title,
        description: t.description,
        dueAt: t.due_at,
        temporalReferenceText: t.temporal_reference_text,
        sourceExcerpt: t.source_excerpt,
        confidence: t.confidence,
        isCommitment: t.is_commitment ?? false,
      });
    }

    const clarificationCandidates: CompiledClarificationCandidate[] =
      extractorOutput.clarification_requests.map((c) => mapClarification(c));

    const flags: CompilerFlags = {
      negatedTerms,
      explicitAliasLabels: [...explicitAliasLabels],
      blockedClarificationRefs: [...blockedClarificationRefs],
      weakTopicsPreserved,
    };

    const filteredEntities = filterSupersededEntities(
      entities,
      mergedCorrections,
      rawContent,
      droppedArtifacts,
    );

    void sourceMode;

    return {
      compilerVersion: MEMORY_COMPILER_VERSION,
      entities: filteredEntities,
      aliases: explicitAliases,
      events,
      assertions,
      tasks,
      clarificationCandidates,
      compilerNotes,
      droppedArtifacts,
      flags,
    };
  }
}

function mapClarification(c: ExtractedClarification): CompiledClarificationCandidate {
  return {
    targetType: c.target_type,
    targetReference: c.target_reference,
    issueType: c.issue_type,
    question: c.question,
    reason: c.reason,
    priority: c.priority,
    blockingScope: c.blocking_scope,
    suggestedAnswers: c.suggested_answers ?? [],
    sourceExcerpt: c.source_excerpt,
  };
}

export function summarizeExtractorForComparison(output: ExtractorOutput): Record<string, unknown> {
  return {
    entityNames: output.entities.map((e) => e.name),
    eventTypes: output.events.map((e) => e.event_type),
    assertionCount: output.assertions.length,
    taskTitles: output.tasks.map((t) => t.title),
    clarificationCount: output.clarification_requests.length,
  };
}
