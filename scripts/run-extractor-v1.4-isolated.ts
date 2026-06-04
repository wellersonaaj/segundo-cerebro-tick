/**
 * Chamada isolada ao extractor-v1.4 — não persiste, não usa pipeline v1.3.
 *
 *   ALLOW_EXTRACTOR_V14_ISOLATED=true npm run extractor:v1.4:isolated
 *   ALLOW_EXTRACTOR_V14_ISOLATED=true npm run extractor:v1.4:isolated -- v14-meeting
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadDotEnv } from '../src/config/load-dotenv.js';
import { resetEnvCache } from '../src/config/env.js';
import { createOpenAiExtractorV14 } from '../src/openai/extractor-v1.4.service.js';

loadDotEnv();
resetEnvCache();

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const casesDir = join(root, 'data/calibration/extractor-v1.4/cases');

function fail(msg: string): never {
  console.error(`\n✗ ${msg}`);
  process.exit(1);
}

async function main(): Promise<void> {
  if (process.env.ALLOW_EXTRACTOR_V14_ISOLATED !== 'true') {
    fail('Set ALLOW_EXTRACTOR_V14_ISOLATED=true');
  }

  const scenarioArg = process.argv[2];
  const file = scenarioArg
    ? readdirSync(casesDir).find((f) => f.includes(scenarioArg))
    : 'v14-meeting.json';

  if (!file) {
    fail(`Case not found for: ${scenarioArg ?? 'default'}`);
  }

  const testCase = JSON.parse(readFileSync(join(casesDir, file), 'utf8')) as {
    scenario_id: string;
    raw_content: string;
    source_channel: string;
    source_mode: string;
  };

  console.log('=== extractor-v1.4 isolated ===');
  console.log('scenario:', testCase.scenario_id);
  console.log('input length:', testCase.raw_content.length);

  const extract = createOpenAiExtractorV14();
  const output = await extract({
    effective_input: testCase.raw_content,
    source_channel: testCase.source_channel,
    source_mode: testCase.source_mode,
    received_at: '2026-06-01T12:00:00-03:00',
    timezone: 'America/Sao_Paulo',
  });

  console.log('\n--- summary ---');
  console.log('schema_version:', output.schema_version);
  console.log('entity_mentions:', output.entity_mentions.length);
  console.log('aliases:', output.aliases.length);
  console.log('events:', output.events.map((e) => e.event_kind));
  console.log('correction_signals:', output.correction_signals.length);
  console.log('task_signals:', output.task_signals.length);
  console.log('review_hints:', output.review_hints.length);

  console.log('\n--- full output ---');
  console.log(JSON.stringify(output, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
