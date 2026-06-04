import type { SupabaseClient } from '@supabase/supabase-js';
import type { EntityLikeSourceMetadata } from '../types/ingestion-context.js';
import type { SourceMode } from '../types/domain.js';
import {
  buildTrustedEntityReferencesFromMetadata,
  collectReferenceTextsFromExtractor,
  ReferenceResolverService,
  type MemoryResolverResult,
  type RegistryEntityFixture,
} from './reference-resolver.service.js';
import type { ExtractorOutputV14 } from '../openai/extractor-v1.4.types.js';
import { applyFirstPersonPronounToResolverResult } from './first-person-pronoun-resolver.js';
import { applyInTextPronounCoreference, applyThreadPronounCoreference } from './pronoun-coreference.service.js';
import type { ThreadConversationContext } from './thread-conversation-context.service.js';
import { normalizeText } from '../utils/normalize.js';

export class DbReferenceResolverService {
  constructor(private readonly db: SupabaseClient) {}

  async resolveForExtractorOutput(
    output: ExtractorOutputV14,
    entityLike: EntityLikeSourceMetadata = {},
    sourceMode: SourceMode = 'conversational',
    threadContext: ThreadConversationContext | null = null,
  ): Promise<MemoryResolverResult> {
    const registry = await this.loadRegistrySnapshot();
    const resolver = new ReferenceResolverService(registry);
    const refs = collectReferenceTextsFromExtractor(output);
    const trusted = buildTrustedEntityReferencesFromMetadata(entityLike, resolver);
    let result = resolver.resolveReferences(refs, trusted);

    const senderRef = entityLike.sender_reference?.trim();
    const senderResolved =
      senderRef != null
        ? (result.byReferenceText.get(senderRef) ??
          result.byReferenceText.get(normalizeText(senderRef)) ??
          null)
        : null;

    result = applyFirstPersonPronounToResolverResult(result, sourceMode, senderResolved);
    result = applyInTextPronounCoreference(result, output);
    result = applyThreadPronounCoreference(result, sourceMode, threadContext);
    return result;
  }

  private async loadRegistrySnapshot(): Promise<RegistryEntityFixture[]> {
    const { data: entities, error: entErr } = await this.db
      .from('entities')
      .select('id, name, normalized_name, entity_type')
      .in('registry_status', ['active', 'candidate'])
      .limit(500);
    if (entErr) throw new Error(`db-reference-resolver entities: ${entErr.message}`);

    const { data: aliases, error: aliasErr } = await this.db
      .from('entity_aliases')
      .select('entity_id, alias, normalized_alias')
      .in('registry_status', ['active', 'candidate'])
      .limit(2000);
    if (aliasErr) throw new Error(`db-reference-resolver aliases: ${aliasErr.message}`);

    const aliasesByEntity = new Map<string, string[]>();
    for (const row of aliases ?? []) {
      const list = aliasesByEntity.get(row.entity_id as string) ?? [];
      list.push((row.alias as string) ?? (row.normalized_alias as string));
      aliasesByEntity.set(row.entity_id as string, list);
    }

    return (entities ?? []).map((e) => ({
      id: e.id as string,
      name: e.name as string,
      normalized_name: e.normalized_name as string,
      entity_type: e.entity_type as string,
      aliases: aliasesByEntity.get(e.id as string) ?? [],
    }));
  }
}
