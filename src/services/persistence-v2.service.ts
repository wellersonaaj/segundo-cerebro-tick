import type { SupabaseClient } from '@supabase/supabase-js';
import type { EntityType } from '../types/domain.js';
import type { CompiledMemoryV2 } from '../types/memory-compiler-v2.js';
import type {
  ContextResolutionEvidence,
  TaskSignalContextResolution,
} from '../types/ingestion-context.js';
import type { MemoryResolverResult } from '../services/reference-resolver.service.js';
import type { ClarificationManagerV2Result } from '../services/clarification-manager-v2.service.js';
import { isMvpAutoRegistryEntityType, isMvpBlockedGenericEntityTerm } from '../config/mvp-registry-policy.js';
import type { PersistenceV2Result } from '../types/domain-v2.js';
import { normalizeText } from '../utils/normalize.js';
import { EntitiesV2Repository } from '../repositories/v2/entities-v2.repository.js';
import { EventsV2Repository } from '../repositories/v2/events-v2.repository.js';
import { AssertionsV2Repository } from '../repositories/v2/assertions-v2.repository.js';
import { TaskMutationsV2Repository } from '../repositories/v2/task-mutations-v2.repository.js';
import { ClarificationsV2Repository } from '../repositories/v2/clarifications-v2.repository.js';
import { InboxItemEntitiesV2Repository } from '../repositories/v2/inbox-item-entities-v2.repository.js';
import { EntityAliasEvidencesV2Repository } from '../repositories/v2/entity-alias-evidences-v2.repository.js';

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

export class PersistenceV2Service {
  private readonly entitiesRepo: EntitiesV2Repository;
  private readonly eventsRepo: EventsV2Repository;
  private readonly assertionsRepo: AssertionsV2Repository;
  private readonly taskMutationsRepo: TaskMutationsV2Repository;
  private readonly clarificationsRepo: ClarificationsV2Repository;
  private readonly inboxItemEntitiesRepo: InboxItemEntitiesV2Repository;
  private readonly aliasEvidencesRepo: EntityAliasEvidencesV2Repository;

  constructor(db: SupabaseClient) {
    this.entitiesRepo = new EntitiesV2Repository(db);
    this.eventsRepo = new EventsV2Repository(db);
    this.assertionsRepo = new AssertionsV2Repository(db);
    this.taskMutationsRepo = new TaskMutationsV2Repository(db);
    this.clarificationsRepo = new ClarificationsV2Repository(db);
    this.inboxItemEntitiesRepo = new InboxItemEntitiesV2Repository(db);
    this.aliasEvidencesRepo = new EntityAliasEvidencesV2Repository(db);
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

    const entityIds = new Map<string, string>();

    for (const ref of resolverResult.references) {
      if (ref.status === 'resolved' && ref.entity_id) {
        entityIds.set(normalizeText(ref.reference_text), ref.entity_id);
      }
    }

    for (const mention of compiled.resolvedEntities) {
      if (!isMvpAutoRegistryEntityType(mention.suggestedEntityType)) {
        continue;
      }
      if (isMvpBlockedGenericEntityTerm(mention.mentionText)) {
        continue;
      }
      const key = normalizeText(mention.mentionText);
      let entityId = mention.entityId ?? entityIds.get(key) ?? null;

      if (!entityId) {
        const created = await this.entitiesRepo.createCandidate(
          mention.mentionText,
          asEntityType(mention.suggestedEntityType),
          extractionRunId,
        );
        entityId = created.id;
      }

      entityIds.set(key, entityId);

      await this.inboxItemEntitiesRepo.createCandidate({
        inboxItemId,
        extractionRunId,
        entityId,
        sourceExcerpt: mention.sourceExcerpt,
        confidence: mention.confidence,
        correctionId,
      });
    }

    const aliasEvidenceIds: string[] = [];
    for (const alias of compiled.aliases) {
      const targetKey = normalizeText(alias.targetReference);
      let targetEntityId =
        alias.targetEntityId ?? entityIds.get(targetKey) ?? entityIds.get(normalizeText(alias.alias));

      if (!targetEntityId) {
        const created = await this.entitiesRepo.createCandidate(
          alias.targetReference,
          'person',
          extractionRunId,
        );
        targetEntityId = created.id;
      }
      entityIds.set(targetKey, targetEntityId);

      const aliasRow = await this.entitiesRepo.createAliasCandidate(
        targetEntityId,
        alias.alias,
        extractionRunId,
      );
      const evidence = await this.aliasEvidencesRepo.createCandidate({
        entityAliasId: aliasRow.id,
        inboxItemId,
        extractionRunId,
        sourceExcerpt: alias.sourceExcerpt,
        sourceBlockReference: alias.sourceBlockReference,
        confidence: alias.confidence,
      });
      aliasEvidenceIds.push(evidence.id);
    }

    const eventIds: string[] = [];
    for (const event of compiled.events) {
      const created = await this.eventsRepo.createCandidate(
        inboxItemId,
        extractionRunId,
        event,
        correctionId,
      );
      eventIds.push(created.id);

      for (const link of event.relatedEntities) {
        await this.eventsRepo.linkEntity(created.id, {
          entityId: link.entityId,
          entityReference: link.entityReference,
          relationType: link.relationType,
          role: link.role,
          resolutionStatus: link.resolutionStatus,
        });
      }
    }

    const assertionIds: string[] = [];
    for (const assertion of compiled.assertions) {
      const subjectEntityId =
        assertion.subjectEntityId ??
        entityIds.get(normalizeText(assertion.subjectReference)) ??
        null;
      const withSubject = { ...assertion, subjectEntityId };
      const created = await this.assertionsRepo.createCandidate(
        inboxItemId,
        extractionRunId,
        withSubject,
        correctionId,
      );
      assertionIds.push(created.id);

      if (subjectEntityId) {
        await this.assertionsRepo.linkEntity(created.id, {
          entityId: subjectEntityId,
          entityReference: assertion.subjectReference,
          referenceRole: 'subject',
          resolutionStatus: 'resolved',
        });
      }

      for (const ref of assertion.relatedEntityReferences) {
        const eid = entityIds.get(normalizeText(ref)) ?? null;
        await this.assertionsRepo.linkEntity(created.id, {
          entityId: eid,
          entityReference: ref,
          referenceRole: 'related',
          resolutionStatus: eid ? 'resolved' : 'unresolved',
        });
      }
    }

    const evidenceByIndex = new Map(
      (input.contextResolutionEvidence ?? []).map((e) => [e.taskSignalIndex, e]),
    );
    const resolutionByIndex = new Map(
      (input.taskSignalResolutions ?? []).map((r) => [r.taskSignalIndex, r]),
    );

    const taskMutationIds: string[] = [];

    for (let i = 0; i < compiled.tasks.length; i++) {
      const task = compiled.tasks[i]!;
      const resolution = resolutionByIndex.get(i);
      const evidence = evidenceByIndex.get(i) ?? null;
      const taskId =
        task.operation === 'create'
          ? null
          : resolution?.outcome.taskId ?? null;

      const assigneeEntityId =
        task.assigneeEntityId ??
        (task.assigneeReference
          ? (entityIds.get(normalizeText(task.assigneeReference)) ?? null)
          : null);
      const projectEntityId =
        task.projectEntityId ??
        (task.projectReference
          ? (entityIds.get(normalizeText(task.projectReference)) ?? null)
          : null);

      const created = await this.taskMutationsRepo.createCandidate(
        inboxItemId,
        extractionRunId,
        task,
        {
          taskId,
          assigneeEntityId,
          projectEntityId,
          contextResolutionEvidence: evidence,
          correctionId,
        },
      );
      taskMutationIds.push(created.id);
    }

    const toPersist = [
      ...clarifications.blocking,
      ...clarifications.nonBlocking,
    ];
    const savedClarifications = await this.clarificationsRepo.createManyCandidates(
      inboxItemId,
      extractionRunId,
      toPersist,
      correctionId,
    );

    return {
      entityIds,
      eventIds,
      assertionIds,
      taskMutationIds,
      clarificationIds: savedClarifications.map((c) => c.id),
      aliasEvidenceIds,
    };
  }
}
