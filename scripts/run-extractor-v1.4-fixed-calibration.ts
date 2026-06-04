/**
 * Fixed calibration: fixture extractor v1.4 → context → resolver → compiler v2 → clarification v2.
 * No OpenAI. No database.
 *
 *   npm run test:extractor:v1.4:fixed
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FIXED_CALIBRATION_EXPECTATIONS } from '../src/calibration/extractor-v1.4/fixed-calibration-expectations.js';
import { FIXED_EXTRACTOR_FIXTURES } from '../src/calibration/extractor-v1.4/fixed-extractor-fixtures.js';
import {
  runV14ContextPipeline,
  type V14ContextCaseFile,
} from '../src/calibration/extractor-v1.4/run-v14-context-pipeline.js';
import type { RegistryEntityFixture } from '../src/services/reference-resolver.service.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const casesDir = join(root, 'data/calibration/extractor-v1.4/cases');

const CONTEXT_ONLY = new Set([
  'v14-fc-task-new',
  'v14-fc-project-new',
  'v14-fc-status-new',
  'v14-fc-blocked-new',
  'v14-ctx-due-date-unique',
  'v14-ctx-assignee-unique',
  'v14-ctx-complete-unique',
  'v14-ctx-due-date-ambiguous',
]);

function main(): void {
  const registry = JSON.parse(
    readFileSync(join(root, 'data/calibration/extractor-v1.4/registry-fixture.json'), 'utf8'),
  ) as { entities: RegistryEntityFixture[] };

  const files = readdirSync(casesDir).filter((f) => f.endsWith('.json'));
  let passed = 0;
  let total = 0;
  const failures: string[] = [];

  for (const file of files) {
    const caseFile = JSON.parse(
      readFileSync(join(casesDir, file), 'utf8'),
    ) as V14ContextCaseFile;
    if (CONTEXT_ONLY.has(caseFile.scenario_id)) continue;

    total += 1;
    const extractorOutput = FIXED_EXTRACTOR_FIXTURES[caseFile.scenario_id];
    const expected = FIXED_CALIBRATION_EXPECTATIONS[caseFile.scenario_id];

    if (!extractorOutput || !expected) {
      failures.push(`${caseFile.scenario_id}: missing fixture or expectations`);
      continue;
    }

    const result = runV14ContextPipeline({
      scenarioId: caseFile.scenario_id,
      extractorOutput,
      expected,
      caseFile,
      registryEntities: registry.entities,
    });

    if (result.evaluation.passed) {
      passed += 1;
      console.log(`✓ ${caseFile.scenario_id}`);
    } else {
      failures.push(`${caseFile.scenario_id}: ${result.evaluation.failures.join('; ')}`);
      console.log(`✗ ${caseFile.scenario_id}: ${result.evaluation.failures.join('; ')}`);
    }
  }

  console.log(`\n=== Fixed calibration v1.4: ${passed}/${total} passed ===`);
  if (failures.length > 0) {
    process.exit(1);
  }
}

main();
