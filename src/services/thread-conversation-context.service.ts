import type { SupabaseClient } from '@supabase/supabase-js';
import type { ExtractorOutputV14 } from '../openai/extractor-v1.4.types.js';
import type { InboxItem } from '../types/domain.js';
import { InboxItemsRepository, type InboxItemRow } from '../repositories/inbox-items.repository.js';
import { normalizeText } from '../utils/normalize.js';
import { ExtractionRunsV2Repository } from '../repositories/v2/extraction-runs-v2.repository.js';
import { resolveThreadIdFromInbox } from './assistant-session.service.js';

export interface ThreadSalientEntity {
  reference: string;
  canonicalName: string | null;
  entityType: string | null;
  inboxItemId: string;
}

export interface ThreadConversationContext {
  threadId: string;
  recentMessages: Array<{ inboxItemId: string; rawContent: string; createdAt: string }>;
  salientEntities: ThreadSalientEntity[];
}

const MAX_RECENT_MESSAGES = 3;

function collectPersonReferencesFromOutput(
  output: ExtractorOutputV14,
  inboxItemId: string,
): ThreadSalientEntity[] {
  const found: ThreadSalientEntity[] = [];
  const seen = new Set<string>();

  for (const mention of output.entity_mentions ?? []) {
    if (mention.suggested_entity_type !== 'person') continue;
    const ref = mention.mention_text.trim();
    if (!ref) continue;
    const key = normalizeText(ref);
    if (seen.has(key)) continue;
    seen.add(key);
    found.push({
      reference: ref,
      canonicalName: null,
      entityType: 'person',
      inboxItemId,
    });
  }

  for (const ev of output.events ?? []) {
    for (const rel of ev.related_entities ?? []) {
      const ref = rel.entity_reference.trim();
      if (!ref || normalizeText(ref) === 'eu') continue;
      const key = normalizeText(ref);
      if (seen.has(key)) continue;
      seen.add(key);
      found.push({
        reference: ref,
        canonicalName: null,
        entityType: 'person',
        inboxItemId,
      });
    }
  }

  return found;
}

function collectFromCompiledResolved(
  compiled: Record<string, unknown> | null | undefined,
  inboxItemId: string,
): ThreadSalientEntity[] {
  if (!compiled) return [];
  const resolved = compiled.resolvedEntities as
    | Array<{
        mentionText?: string;
        canonicalName?: string | null;
        suggestedEntityType?: string;
      }>
    | undefined;
  if (!Array.isArray(resolved)) return [];

  return resolved
    .filter((r) => r.suggestedEntityType === 'person' && r.mentionText?.trim())
    .map((r) => ({
      reference: r.mentionText!.trim(),
      canonicalName: r.canonicalName ?? null,
      entityType: 'person',
      inboxItemId,
    }));
}

export function formatThreadContextForExtractor(context: ThreadConversationContext | null): string {
  if (!context || !context.recentMessages.length) return '';

  const lines = ['[CONTEXTO_DA_CONVERSA]'];
  for (const msg of context.recentMessages) {
    lines.push(`Mensagem anterior: "${msg.rawContent.trim()}"`);
  }
  if (context.salientEntities.length) {
    const entityLine = context.salientEntities
      .slice(0, 5)
      .map((e) =>
        e.canonicalName && e.canonicalName !== e.reference
          ? `${e.reference} (${e.canonicalName})`
          : e.reference,
      )
      .join(', ');
    lines.push(`Pessoas mencionadas recentemente: ${entityLine}`);
    lines.push(
      'Pronomes como "ela", "ele", "dela" e "dele" referem-se preferencialmente a essas pessoas quando coerente.',
    );
  }
  lines.push('[/CONTEXTO_DA_CONVERSA]');
  return lines.join('\n');
}

export function prependThreadContextToEffectiveInput(
  effectiveInput: string,
  context: ThreadConversationContext | null,
): string {
  const block = formatThreadContextForExtractor(context);
  if (!block) return effectiveInput;
  return `${block}\n\n${effectiveInput}`;
}

export function resolveThreadSalientPerson(
  context: ThreadConversationContext | null,
): ThreadSalientEntity | null {
  if (!context?.salientEntities.length) return null;
  const persons = context.salientEntities.filter((e) => e.entityType === 'person');
  if (!persons.length) return null;
  return persons[persons.length - 1] ?? null;
}

export class ThreadConversationContextService {
  private readonly inboxRepo: InboxItemsRepository;
  private readonly runsRepo: ExtractionRunsV2Repository;

  constructor(db: SupabaseClient) {
    this.inboxRepo = new InboxItemsRepository(db);
    this.runsRepo = new ExtractionRunsV2Repository(db);
  }

  async findLatestInboxInThread(threadId: string): Promise<InboxItemRow | null> {
    const recent = await this.inboxRepo.listRecent({ limit: 100 });
    return recent.find((row) => resolveThreadIdFromInbox(row) === threadId) ?? null;
  }

  async buildForThread(threadId: string): Promise<ThreadConversationContext | null> {
    const latest = await this.findLatestInboxInThread(threadId);
    if (!latest) return null;
    return this.buildForInbox(latest);
  }

  async buildForInbox(inboxItem: InboxItem | InboxItemRow): Promise<ThreadConversationContext | null> {
    const threadId = resolveThreadIdFromInbox(inboxItem);
    if (!threadId) return null;

    const recent = await this.inboxRepo.listRecent({ limit: 100 });
    const threadInboxes = recent
      .filter((row) => resolveThreadIdFromInbox(row) === threadId && row.id !== inboxItem.id)
      .slice(0, MAX_RECENT_MESSAGES);

    if (!threadInboxes.length) {
      return { threadId, recentMessages: [], salientEntities: [] };
    }

    const recentMessages = threadInboxes.map((row) => ({
      inboxItemId: row.id,
      rawContent: row.raw_content,
      createdAt: row.created_at,
    }));

    const salientEntities: ThreadSalientEntity[] = [];
    const seen = new Set<string>();

    for (const row of threadInboxes) {
      const runId = row.active_extraction_run_id ?? row.latest_extraction_run_id;
      if (!runId) continue;
      const run = await this.runsRepo.findById(runId);
      const parsed = run?.parsed_output as ExtractorOutputV14 | null | undefined;
      const compiled = run?.compiled_output as Record<string, unknown> | null | undefined;

      const fromParsed = parsed ? collectPersonReferencesFromOutput(parsed, row.id) : [];
      const fromCompiled = collectFromCompiledResolved(compiled, row.id);
      for (const entity of [...fromParsed, ...fromCompiled]) {
        const key = normalizeText(entity.reference);
        if (seen.has(key)) continue;
        seen.add(key);
        salientEntities.push(entity);
      }
    }

    return { threadId, recentMessages, salientEntities };
  }
}
