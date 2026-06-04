import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ExtractV14Fn } from '../../src/openai/extractor-v1.4.service.js';
import type { ExtractorOutputV14 } from '../../src/openai/extractor-v1.4.types.js';

const FIXTURE_PATH = join(process.cwd(), 'tests/fixtures/extractor-v1.4-valid-minimal.json');

export function loadExtractorV14Fixture(): ExtractorOutputV14 {
  return JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as ExtractorOutputV14;
}

export function createMockExtractV14(
  output: ExtractorOutputV14 = loadExtractorV14Fixture(),
): ExtractV14Fn {
  return async () => output;
}
