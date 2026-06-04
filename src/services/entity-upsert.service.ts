import type { EntitiesRepository } from '../repositories/entities.repository.js';
import type { EntityAliasEvidencesRepository } from '../repositories/entity-alias-evidences.repository.js';
import type {
  EntityType,
  ExtractedClarification,
  ExtractedEntity,
} from '../types/domain.js';
import { normalizeText } from '../utils/normalize.js';

const GENERIC_TERMS = new Set(
  ['fornecedor', 'cliente', 'prazo', 'ip', 'responsavel', 'responsável'].map(normalizeText),
);

export interface AliasConflict {
  alias: string;
  normalizedAlias: string;
  existingEntityId: string;
  existingEntityName: string;
  targetEntityId: string;
  targetEntityName: string;
}

export interface UpsertExtractedEntityInput {
  inboxItemId: string;
  extractionRunId: string;
  extractedEntity: ExtractedEntity;
  resolvedEntityId?: string | null;
}

export type EntityUpsertResolutionStatus =
  | 'created'
  | 'reused_candidate'
  | 'resolved_exact_name'
  | 'reused_from_resolver';

export interface UpsertExtractedEntityResult {
  entityId: string;
  canonicalName: string;
  entityType: EntityType;
  resolutionStatus: EntityUpsertResolutionStatus;
  aliasesPersisted: string[];
  aliasesSkipped: string[];
  conflicts: AliasConflict[];
  aliasClarifications: ExtractedClarification[];
}

export class EntityUpsertService {
  constructor(
    private readonly entitiesRepo: EntitiesRepository,
    private readonly aliasEvidencesRepo: EntityAliasEvidencesRepository,
  ) {}

  async upsert(input: UpsertExtractedEntityInput): Promise<UpsertExtractedEntityResult> {
    const { extractedEntity, resolvedEntityId, extractionRunId, inboxItemId } = input;
    const normalizedName = normalizeText(extractedEntity.name);

    let entityId: string;
    let canonicalName: string;
    let resolutionStatus: EntityUpsertResolutionStatus;

    if (resolvedEntityId) {
      const resolved = await this.entitiesRepo.findById(resolvedEntityId);
      if (!resolved) {
        throw new Error(`EntityUpsertService: resolved entity not found (${resolvedEntityId})`);
      }
      if (resolved.registry_status !== 'active') {
        throw new Error(
          `EntityUpsertService: resolved entity not active in registry (${resolvedEntityId})`,
        );
      }
      entityId = resolved.id;
      canonicalName = resolved.name;
      resolutionStatus = 'reused_from_resolver';
    } else {
      const active = await this.entitiesRepo.findByNormalizedNameActive(normalizedName);
      if (active) {
        entityId = active.id;
        canonicalName = active.name;
        resolutionStatus = 'resolved_exact_name';
      } else {
        const candidate = await this.entitiesRepo.findByNormalizedNameCandidate(normalizedName);
        if (candidate) {
          entityId = candidate.id;
          canonicalName = candidate.name;
          resolutionStatus = 'reused_candidate';
        } else {
          const created = await this.entitiesRepo.createCandidate(
            extractedEntity.name,
            extractedEntity.entity_type,
            extractionRunId,
          );
          entityId = created.id;
          canonicalName = created.name;
          resolutionStatus = 'created';
        }
      }
    }

    const aliasesPersisted: string[] = [];
    const aliasesSkipped: string[] = [];
    const conflicts: AliasConflict[] = [];
    const aliasClarifications: ExtractedClarification[] = [];
    const canonicalNormalized = normalizeText(canonicalName);

    for (const rawAlias of extractedEntity.aliases ?? []) {
      const alias = rawAlias.trim();
      if (!alias) {
        aliasesSkipped.push(rawAlias);
        continue;
      }

      const normalizedAlias = normalizeText(alias);
      if (normalizedAlias === canonicalNormalized) {
        aliasesSkipped.push(alias);
        continue;
      }
      if (GENERIC_TERMS.has(normalizedAlias)) {
        aliasesSkipped.push(alias);
        continue;
      }

      const owner = await this.entitiesRepo.findAliasOwnerAny(normalizedAlias);
      if (owner) {
        if (owner.entityId === entityId) {
          await this.aliasEvidencesRepo.createCandidate({
            entityAliasId: owner.aliasId,
            inboxItemId,
            extractionRunId,
            sourceExcerpt: extractedEntity.source_excerpt,
            confidence: extractedEntity.confidence,
          });
          aliasesSkipped.push(alias);
          continue;
        }
        const conflict: AliasConflict = {
          alias,
          normalizedAlias,
          existingEntityId: owner.entityId,
          existingEntityName: owner.entityName,
          targetEntityId: entityId,
          targetEntityName: canonicalName,
        };
        conflicts.push(conflict);
        aliasClarifications.push(this.buildAliasConflictClarification(conflict, extractedEntity));
        continue;
      }

      const existingForEntity = await this.entitiesRepo.findAliasByEntityAndNormalized(
        entityId,
        normalizedAlias,
      );
      if (existingForEntity) {
        await this.aliasEvidencesRepo.createCandidate({
          entityAliasId: existingForEntity.id,
          inboxItemId,
          extractionRunId,
          sourceExcerpt: extractedEntity.source_excerpt,
          confidence: extractedEntity.confidence,
        });
        aliasesSkipped.push(alias);
        continue;
      }

      const createdAlias = await this.entitiesRepo.createAliasCandidate(
        entityId,
        alias,
        extractionRunId,
      );
      await this.aliasEvidencesRepo.createCandidate({
        entityAliasId: createdAlias.id,
        inboxItemId,
        extractionRunId,
        sourceExcerpt: extractedEntity.source_excerpt,
        confidence: extractedEntity.confidence,
      });
      aliasesPersisted.push(alias);
    }

    return {
      entityId,
      canonicalName,
      entityType: extractedEntity.entity_type,
      resolutionStatus,
      aliasesPersisted,
      aliasesSkipped,
      conflicts,
      aliasClarifications,
    };
  }

  private buildAliasConflictClarification(
    conflict: AliasConflict,
    extractedEntity: ExtractedEntity,
  ): ExtractedClarification {
    return {
      target_type: 'entity',
      target_reference: conflict.targetEntityName,
      issue_type: 'ambiguous_alias_conflict',
      question: `O alias "${conflict.alias}" já está associado a "${conflict.existingEntityName}". Confirma associação com "${conflict.targetEntityName}"?`,
      reason: `Conflito de alias detectado durante persistência da entidade "${extractedEntity.name}".`,
      priority: 'medium',
      blocking_scope: 'knowledge_confirmation',
      suggested_answers: [conflict.existingEntityName, conflict.targetEntityName],
      source_excerpt: extractedEntity.source_excerpt,
    };
  }
}
