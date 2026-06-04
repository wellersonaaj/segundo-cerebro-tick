import type { SourceMetadata } from '../types/ingestion-context.js';

export function normalizeCaseSourceMetadata(
  raw?: Partial<{
    sender_reference?: string;
    recipient_references?: string[];
    thread_reference?: string;
    reply_to_reference?: string;
    subject?: string;
    occurred_at?: string;
  }>,
): SourceMetadata {
  if (!raw) return { entityLike: {}, routing: {} };
  return {
    entityLike: {
      sender_reference: raw.sender_reference,
      recipient_references: raw.recipient_references,
    },
    routing: {
      thread_reference: raw.thread_reference,
      reply_to_reference: raw.reply_to_reference,
      subject: raw.subject,
      occurred_at: raw.occurred_at,
    },
  };
}

export function mergeSourceMetadata(
  base: SourceMetadata,
  overlay: SourceMetadata,
): SourceMetadata {
  return {
    entityLike: { ...base.entityLike, ...overlay.entityLike },
    routing: { ...base.routing, ...overlay.routing },
  };
}

export function sourceMetadataFromInboxMetadata(
  metadata: Record<string, unknown> | null | undefined,
): SourceMetadata {
  if (!metadata || typeof metadata !== 'object') return { entityLike: {}, routing: {} };
  const nested = metadata.source_metadata;
  if (nested && typeof nested === 'object') {
    const sm = nested as Record<string, unknown>;
    const entityLike = sm.entityLike;
    const routing = sm.routing;
    return {
      entityLike:
        entityLike && typeof entityLike === 'object'
          ? (entityLike as SourceMetadata['entityLike'])
          : {},
      routing:
        routing && typeof routing === 'object'
          ? (routing as SourceMetadata['routing'])
          : {},
    };
  }
  return { entityLike: {}, routing: {} };
}
