import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  EMPTY_INGESTION_CONTEXT,
  type IngestionContext,
} from '../../types/ingestion-context.js';
import {
  mergeSourceMetadata,
  normalizeCaseSourceMetadata,
} from '../../services/ingestion-context-metadata.js';

export { mergeSourceMetadata, normalizeCaseSourceMetadata };

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

