import type { EntityResolutionResult, ExtractedEntity } from '../../types/domain.js';
import { normalizeText } from '../../utils/normalize.js';
import type { ResolvedEntityMap } from '../../services/memory-resolver.service.js';

export interface RegistryFixtureEntity {
  id: string;
  name: string;
  normalized_name: string;
  entity_type: string;
  aliases: string[];
}

export interface RegistryFixture {
  entities: RegistryFixtureEntity[];
}

const GENERIC_TERMS = new Set(
  ['fornecedor', 'cliente', 'prazo', 'ip', 'responsavel', 'responsável'].map(normalizeText),
);

export class FixtureMemoryResolver {
  constructor(private readonly registry: RegistryFixture) {}

  resolveEntities(
    _inboxItemId: string,
    entities: ExtractedEntity[],
    _rawContent: string,
  ): ResolvedEntityMap {
    const byExtractedName = new Map<string, string>();
    const resolutions: EntityResolutionResult[] = [];

    for (const entity of entities) {
      const normalized = normalizeText(entity.name);
      if (GENERIC_TERMS.has(normalized)) {
        resolutions.push({
          extractedName: entity.name,
          status: 'unresolved',
          resolvedEntityId: null,
          resolvedEntityName: null,
          method: 'skipped_generic_term',
          confidence: 0,
          evidence: { reason: 'generic_term' },
          candidates: [],
        });
        continue;
      }

      const result = this.resolveOne(entity.name);
      resolutions.push(result);
      if (result.status === 'resolved' && result.resolvedEntityId) {
        byExtractedName.set(normalized, result.resolvedEntityId);
      }
    }

    return { byExtractedName, resolutions };
  }

  private resolveOne(name: string): EntityResolutionResult {
    const normalized = normalizeText(name);
    const candidates: EntityResolutionResult['candidates'] = [];

    for (const e of this.registry.entities) {
      if (e.normalized_name === normalized) {
        candidates.push({ entity_id: e.id, name: e.name, match_type: 'exact_name' });
      }
      for (const alias of e.aliases) {
        if (normalizeText(alias) === normalized) {
          candidates.push({ entity_id: e.id, name: e.name, match_type: 'exact_alias' });
        }
      }
    }

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
        confidence: c.match_type === 'exact_alias' ? 0.95 : 0.98,
        evidence: {},
        candidates: uniqList,
      };
    }

    if (uniqList.length > 1) {
      return {
        extractedName: name,
        status: 'ambiguous_multiple_matches',
        resolvedEntityId: null,
        resolvedEntityName: null,
        method: 'multiple_exact',
        confidence: 0.5,
        evidence: { candidates: uniqList },
        candidates: uniqList,
      };
    }

    return {
      extractedName: name,
      status: 'unresolved',
      resolvedEntityId: null,
      resolvedEntityName: null,
      method: null,
      confidence: 0,
      evidence: {},
      candidates: [],
    };
  }
}
