import { EntitiesRepository } from '../repositories/entities.repository.js';
import { EntityResolutionRepository } from '../repositories/entity-resolution.repository.js';
import type {
  EntityResolutionResult,
  ExtractedClarification,
  ExtractedEntity,
} from '../types/domain.js';
import { normalizeText } from '../utils/normalize.js';
import { filterClarificationsAfterResolution } from './extraction-sanitizer.service.js';

const GENERIC_TERMS = new Set(
  ['fornecedor', 'cliente', 'prazo', 'ip', 'responsavel', 'responsável'].map(normalizeText),
);

export interface ResolvedEntityMap {
  /** extracted name (normalized key) -> entity id */
  byExtractedName: Map<string, string>;
  resolutions: EntityResolutionResult[];
}

export class MemoryResolverService {
  constructor(
    private readonly entitiesRepo: EntitiesRepository,
    private readonly resolutionRepo: EntityResolutionRepository,
  ) {}

  async resolveEntities(
    inboxItemId: string,
    entities: ExtractedEntity[],
    rawContent: string,
    extractionRunId?: string | null,
  ): Promise<ResolvedEntityMap> {
    const byExtractedName = new Map<string, string>();
    const resolutions: EntityResolutionResult[] = [];

    for (const entity of entities) {
      const normalized = normalizeText(entity.name);
      if (GENERIC_TERMS.has(normalized)) {
        const result: EntityResolutionResult = {
          extractedName: entity.name,
          status: 'unresolved',
          resolvedEntityId: null,
          resolvedEntityName: null,
          method: 'skipped_generic_term',
          confidence: 0,
          evidence: { reason: 'generic_term' },
          candidates: [],
        };
        resolutions.push(result);
        await this.resolutionRepo.log(inboxItemId, result, extractionRunId);
        continue;
      }

      const result = await this.resolveOne(entity.name, rawContent);
      resolutions.push(result);
      await this.resolutionRepo.log(inboxItemId, result, extractionRunId);

      if (result.status === 'resolved' && result.resolvedEntityId) {
        byExtractedName.set(normalized, result.resolvedEntityId);
        byExtractedName.set(normalizeText(entity.name), result.resolvedEntityId);
      }
    }

    return { byExtractedName, resolutions };
  }

  private async resolveOne(name: string, rawContent: string): Promise<EntityResolutionResult> {
    const normalized = normalizeText(name);
    const candidates: EntityResolutionResult['candidates'] = [];

    const exact = await this.entitiesRepo.findByNormalizedName(normalized);
    if (exact) {
      candidates.push({ entity_id: exact.id, name: exact.name, match_type: 'exact_name' });
    }

    const aliasExact = await this.entitiesRepo.findByAlias(normalized);
    if (aliasExact && !candidates.some((c) => c.entity_id === aliasExact.id)) {
      candidates.push({ entity_id: aliasExact.id, name: aliasExact.name, match_type: 'exact_alias' });
    }

    if (candidates.length === 1) {
      const c = candidates[0]!;
      return {
        extractedName: name,
        status: 'resolved',
        resolvedEntityId: c.entity_id,
        resolvedEntityName: c.name,
        method: c.match_type,
        confidence: c.match_type === 'exact_alias' ? 0.95 : 0.98,
        evidence: { match_type: c.match_type },
        candidates,
      };
    }

    if (candidates.length > 1) {
      return {
        extractedName: name,
        status: 'ambiguous_multiple_matches',
        resolvedEntityId: null,
        resolvedEntityName: null,
        method: 'multiple_exact',
        confidence: 0.5,
        evidence: { candidates },
        candidates,
      };
    }

    const partialName = await this.entitiesRepo.searchPartial(normalized, 5);
    for (const e of partialName) {
      candidates.push({ entity_id: e.id, name: e.name, match_type: 'partial_name' });
    }

    const partialAlias = await this.entitiesRepo.searchByAliasPartial(normalized, 5);
    for (const e of partialAlias) {
      if (!candidates.some((c) => c.entity_id === e.id)) {
        candidates.push({ entity_id: e.id, name: e.name, match_type: 'partial_alias' });
      }
    }

    const recent = await this.resolutionRepo.searchRecentMentions(name, 90, 5);
    const contextMentions = recent.filter(
      (r) =>
        normalizeText(r.description).includes(normalized) ||
        normalizeText(r.source_excerpt).includes(normalized),
    );

    if (candidates.length === 1) {
      const c = candidates[0]!;
      return {
        extractedName: name,
        status: 'resolved',
        resolvedEntityId: c.entity_id,
        resolvedEntityName: c.name,
        method: c.match_type,
        confidence: 0.75,
        evidence: { match_type: c.match_type, recent_mentions: contextMentions.length },
        candidates,
      };
    }

    if (candidates.length > 1) {
      const unique = new Map(candidates.map((c) => [c.entity_id, c]));
      const uniqList = [...unique.values()];
      if (uniqList.length === 1) {
        const c = uniqList[0]!;
        return {
          extractedName: name,
          status: 'resolved',
          resolvedEntityId: c.entity_id,
          resolvedEntityName: c.name,
          method: c.match_type,
          confidence: 0.8,
          evidence: { deduped: true },
          candidates: uniqList,
        };
      }
      return {
        extractedName: name,
        status: 'ambiguous_multiple_matches',
        resolvedEntityId: null,
        resolvedEntityName: null,
        method: 'partial_multiple',
        confidence: 0.45,
        evidence: { candidates: uniqList, recent_mentions: contextMentions.length },
        candidates: uniqList,
      };
    }

    void rawContent;
    return {
      extractedName: name,
      status: 'unresolved',
      resolvedEntityId: null,
      resolvedEntityName: null,
      method: null,
      confidence: 0,
      evidence: { recent_mentions: contextMentions.length },
      candidates: [],
    };
  }

  filterClarifications(
    clarifications: ExtractedClarification[],
    resolvedMap: ResolvedEntityMap,
    resolutions: EntityResolutionResult[],
  ): {
    remaining: ExtractedClarification[];
    autoResolvedIndices: number[];
  } {
    return filterClarificationsAfterResolution(clarifications, resolvedMap, resolutions);
  }
}
