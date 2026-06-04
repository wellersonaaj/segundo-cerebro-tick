import type { SupabaseClient } from '@supabase/supabase-js';
import type { EntityType } from '../types/domain.js';
import type { CompiledMemoryV2 } from '../types/memory-compiler-v2.js';
import type {
  ContextResolutionEvidence,
  TaskSignalContextResolution,
} from '../types/ingestion-context.js';
import type { MemoryResolverResult } from '../services/reference-resolver.service.js';
import type { ClarificationManagerV2Result } from '../types/clarification-types.js';
import { isMvpAutoRegistryEntityType, isMvpBlockedGenericEntityTerm } from '../config/mvp-registry-policy.js';
import type { PersistenceV2Result } from '../types/domain-v2.js';
import { normalizeText } from '../utils/normalize.js';
import { EntitiesRepository } from '../repositories/entities.repository.js';
import { ExtractionRunRpcV2Repository, type PersistExtractionCandidatesV2Input } from '../repositories/v2/extraction-run-rpc-v2.repository.js';
import { dueAtColumnsFromTemporal } from '../types/domain-v2.js';

export interface PersistCompiledMemoryV2Input {
  inboxItemId: string;
  extractionRunId: string;
  compiled: CompiledMemoryV2;
  clarifications: ClarificationManagerV2Result;
  resolverResult: MemoryResolverResult;
  taskSignalResolutions?: TaskSignalContextResolution[];
  contextResolutionEvidence?: ContextResolutionEvidence[];
  correctionId?: string;
}

const ENTITY_TYPES = new Set<EntityType>([
  'person',
  'company',
  'project',
  'product',
  'topic',
  'document',
  'location',
  'other',
]);

function asEntityType(value: string): EntityType {
  return ENTITY_TYPES.has(value as EntityType) ? (value as EntityType) : 'other';
}

function isRegistryEntityId(value: string | null | undefined): value is string {
  return typeof value === 'string' && /^[0-9a-f-]{36}$/i.test(value);
}

/** RPC casts occurred_at to timestamptz — literals como "segunda-feira" devem ir como null. */
function occurredAtForRpc(value: string | null | undefined): string | null {
  if (!value?.trim()) return null;
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) return null;
  return new Date(ms).toISOString();
}

export class PersistenceV2Service {
  private readonly rpc: ExtractionRunRpcV2Repository;
  private readonly entitiesRepo: EntitiesRepository;

  constructor(db: SupabaseClient) {
    this.rpc = new ExtractionRunRpcV2Repository(db);
    this.entitiesRepo = new EntitiesRepository(db);
  }

  private async resolveRegistryEntityId(
    key: string,
    entityIds: Map<string, string>,
    directId: string | null | undefined,
  ): Promise<string | null> {
    if (directId) return directId;
    const fromResolver = entityIds.get(key);
    if (isRegistryEntityId(fromResolver)) return fromResolver;
    const aliasOwner = await this.entitiesRepo.findAliasOwnerAny(key);
    return aliasOwner?.entityId ?? null;
  }

  async persistCandidates(input: PersistCompiledMemoryV2Input): Promise<PersistenceV2Result> {
    const {
      inboxItemId,
      extractionRunId,
      compiled,
      clarifications,
      resolverResult,
      correctionId,
    } = input;

    // Entity ID resolution (read-only)
    const entityIds = new Map<string, string>();

    for (const ref of resolverResult.references) {
      if (ref.status === 'resolved' && ref.entity_id) {
        entityIds.set(normalizeText(ref.reference_text), ref.entity_id);
      }
    }

    // RPC payload: collect new entities
    const rpcEntities: PersistExtractionCandidatesV2Input['entities'] = [];
    const resolvedEntityNames = new Set<string>();

    for (const mention of compiled.resolvedEntities) {
      if (!isMvpAutoRegistryEntityType(mention.suggestedEntityType)) continue;
      if (isMvpBlockedGenericEntityTerm(mention.mentionText)) continue;

      const key = normalizeText(mention.mentionText);
      let entityId = await this.resolveRegistryEntityId(key, entityIds, mention.entityId);

      if (!entityId) {
        const entityType = asEntityType(mention.suggestedEntityType);
        rpcEntities.push({
          name: mention.mentionText,
          entity_type: entityType,
          normalized_name: key,
        });
      } else {
        entityIds.set(key, entityId);
      }

      resolvedEntityNames.add(mention.mentionText);
    }

    // RPC payload: inbox_item_entities
    const rpcInboxItemEntities: PersistExtractionCandidatesV2Input['inboxItemEntities'] = [];
    for (const mention of compiled.resolvedEntities) {
      if (!isMvpAutoRegistryEntityType(mention.suggestedEntityType)) continue;
      if (isMvpBlockedGenericEntityTerm(mention.mentionText)) continue;

      const key = normalizeText(mention.mentionText);
      const entityId = await this.resolveRegistryEntityId(key, entityIds, mention.entityId);
      if (entityId) entityIds.set(key, entityId);

      rpcInboxItemEntities.push({
        entity_name: mention.mentionText,
        relation_type: 'mentioned',
        source_excerpt: mention.sourceExcerpt,
        confidence: mention.confidence,
      });
    }

    // RPC payload: aliases
    const rpcAliases: PersistExtractionCandidatesV2Input['aliases'] = [];
    for (const alias of compiled.aliases) {
      const targetKey = normalizeText(alias.targetReference);
      let targetEntityId =
        (await this.resolveRegistryEntityId(targetKey, entityIds, alias.targetEntityId)) ??
        (await this.resolveRegistryEntityId(normalizeText(alias.alias), entityIds, null));

      if (!targetEntityId) {
        rpcEntities.push({
          name: alias.targetReference,
          entity_type: 'person',
          normalized_name: targetKey,
        });
      } else {
        entityIds.set(targetKey, targetEntityId);
        entityIds.set(normalizeText(alias.alias), targetEntityId);
      }

      rpcAliases.push({
        target_entity_name: alias.targetReference,
        alias: alias.alias,
        source_excerpt: alias.sourceExcerpt,
        source_block_ref: alias.sourceBlockReference,
        confidence: alias.confidence,
      });
    }

    // RPC payload: events
    const rpcEvents: PersistExtractionCandidatesV2Input['events'] = [];
    for (const event of compiled.events) {
      const relatedEntities: PersistExtractionCandidatesV2Input['events'][0]['related_entities'] = [];
      for (const link of event.relatedEntities) {
        relatedEntities.push({
          entity_name: link.entityReference,
          relation_type: link.relationType,
          role: link.role,
          resolution_status: link.resolutionStatus,
        });
        resolvedEntityNames.add(link.entityReference);
      }

      rpcEvents.push({
        event_kind: event.eventKind,
        title: event.title,
        occurred_at: occurredAtForRpc(event.occurredAt),
        episodic_confidence: event.episodicConfidence,
        source_excerpt: event.sourceExcerpt,
        source_block_ref: event.sourceBlockReference,
        confidence: event.confidence,
        related_entities: relatedEntities,
      });
    }

    // RPC payload: assertions
    const rpcAssertions: PersistExtractionCandidatesV2Input['assertions'] = [];
    for (const assertion of compiled.assertions) {
      rpcAssertions.push({
        assertion_kind: assertion.assertionKind,
        subject_ref: assertion.subjectReference,
        subject_entity_name: assertion.subjectEntityId ? assertion.subjectReference : null,
        predicate: assertion.predicate,
        object_ref: assertion.objectReference,
        value_text: assertion.valueText,
        source_excerpt: assertion.sourceExcerpt,
        source_block_ref: assertion.sourceBlockReference,
        confidence: assertion.confidence,
        related_entity_refs: assertion.relatedEntityReferences,
      });
      resolvedEntityNames.add(assertion.subjectReference);
      for (const ref of assertion.relatedEntityReferences) {
        resolvedEntityNames.add(ref);
      }
    }

    // RPC payload: task_mutations
    const evidenceByIndex = new Map(
      (input.contextResolutionEvidence ?? []).map((e) => [e.taskSignalIndex, e]),
    );
    const resolutionByIndex = new Map(
      (input.taskSignalResolutions ?? []).map((r) => [r.taskSignalIndex, r]),
    );

    const rpcTaskMutations: PersistExtractionCandidatesV2Input['taskMutations'] = [];

    for (let i = 0; i < compiled.tasks.length; i++) {
      const task = compiled.tasks[i]!;
      const resolution = resolutionByIndex.get(i);
      const evidence = evidenceByIndex.get(i) ?? null;
      const taskId =
        task.operation === 'create'
          ? null
          : resolution?.outcome.taskId ?? null;

      const due = dueAtColumnsFromTemporal(task.dueAtTemporal, task.dueAt);

      rpcTaskMutations.push({
        operation: task.operation,
        task_ref: task.taskReference,
        title: task.title,
        task_kind: task.taskKind,
        status_signal: task.statusSignal,
        assignee_entity_name: task.assigneeReference ?? (task.assigneeEntityId ? task.assigneeReference : null),
        project_entity_name: task.projectReference ?? (task.projectEntityId ? task.projectReference : null),
        blocked_reason: task.blockedReason,
        source_excerpt: task.sourceExcerpt,
        source_block_ref: task.sourceBlockReference,
        confidence: task.confidence,
        task_id: taskId,
        context_resolution_evidence: evidence as Record<string, unknown> | null | undefined ?? null,
        due_at_literal: due.due_at_literal,
        due_at_local_date: due.due_at_local_date,
        due_at_local_time: due.due_at_local_time,
        due_at_instant: due.due_at_instant,
        due_at_timezone: due.due_at_timezone,
        due_at_precision: due.due_at_precision,
        due_at_status: due.due_at_status,
        due_at_reason_code: due.due_at_reason_code,
        due_at_normalizer_version: due.due_at_normalizer_version,
        due_at_implicit_year: due.due_at_implicit_year,
        due_at_implicit_month: due.due_at_implicit_month,
      });

      if (task.assigneeReference) resolvedEntityNames.add(task.assigneeReference);
      if (task.projectReference) resolvedEntityNames.add(task.projectReference);
    }

    // RPC payload: clarifications
    const rpcClarifications: PersistExtractionCandidatesV2Input['clarifications'] = [];
    const allClarifications = [
      ...clarifications.blocking,
      ...clarifications.nonBlocking,
    ];
    for (const c of allClarifications) {
      rpcClarifications.push({
        target_type: c.targetType,
        target_reference: c.targetReference,
        issue_type: c.issueType,
        question: c.question,
        reason: c.reason,
        priority: c.priority,
        blocking_scope: c.blockingScope,
        materiality: c.materiality,
        suggested_answers: c.suggestedAnswers,
        source_excerpt: c.sourceExcerpt,
        source: c.source,
      });
    }

    // Resolve registry IDs for event/task references (do not mint type=other entities by default).
    for (const name of resolvedEntityNames) {
      const key = normalizeText(name);
      const resolvedId = await this.resolveRegistryEntityId(key, entityIds, entityIds.get(key));
      if (resolvedId) entityIds.set(key, resolvedId);
    }

    // Deduplicate entities by normalized_name
    const seenEntityNames = new Set<string>();
    const dedupedEntities = rpcEntities.filter((e) => {
      if (seenEntityNames.has(e.normalized_name)) return false;
      seenEntityNames.add(e.normalized_name);
      return true;
    });

    await this.rpc.persistCandidates({
      inboxItemId,
      extractionRunId,
      correctionId: correctionId ?? null,
      entities: dedupedEntities,
      inboxItemEntities: rpcInboxItemEntities,
      aliases: rpcAliases,
      events: rpcEvents,
      assertions: rpcAssertions,
      taskMutations: rpcTaskMutations,
      clarifications: rpcClarifications,
    });

    return {
      entityIds: new Map(entityIds),
      eventIds: compiled.events.map(() => ''),
      assertionIds: compiled.assertions.map(() => ''),
      taskMutationIds: compiled.tasks.map(() => ''),
      clarificationIds: allClarifications.map(() => ''),
      aliasEvidenceIds: compiled.aliases.map(() => ''),
    };
  }
}
