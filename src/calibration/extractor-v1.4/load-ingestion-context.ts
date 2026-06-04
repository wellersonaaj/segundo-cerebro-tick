import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  EMPTY_INGESTION_CONTEXT,
  type IngestionContext,
  type SourceMetadata,
} from '../../types/ingestion-context.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');

export interface IngestionContextFixtureFile {
  contexts: Record<string, IngestionContext>;
}

let cached: IngestionContextFixtureFile | null = null;

export function loadIngestionContextFixtures(): IngestionContextFixtureFile {
  if (cached) return cached;
  const path = join(root, 'data/calibration/extractor-v1.4/ingestion-context-fixtures.json');
  cached = JSON.parse(readFileSync(path, 'utf8')) as IngestionContextFixtureFile;
  return cached;
}

export function getIngestionContextById(id: string | undefined): IngestionContext {
  if (!id || id === 'empty') return EMPTY_INGESTION_CONTEXT;
  const fixtures = loadIngestionContextFixtures();
  return fixtures.contexts[id] ?? EMPTY_INGESTION_CONTEXT;
}

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
