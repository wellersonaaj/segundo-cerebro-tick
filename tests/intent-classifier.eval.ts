import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadDotEnv } from '../src/config/load-dotenv.js';
import { resetEnvCache } from '../src/config/env.js';
import { createIntentClassifierService } from '../src/services/intent-classifier.service.js';

const fixturePath = join(dirname(fileURLToPath(import.meta.url)), 'fixtures/intent-eval.jsonl');

export interface IntentEvalRow {
  text: string;
  expected: 'save' | 'update' | 'query' | 'command';
  note: string;
}

export function loadIntentEvalFixture(): IntentEvalRow[] {
  const raw = readFileSync(fixturePath, 'utf8').trim();
  return raw
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as IntentEvalRow);
}

export async function runIntentClassifierEval(minHitRate = 0.85): Promise<{
  total: number;
  hits: number;
  hitRate: number;
  failures: Array<{ text: string; expected: string; got: string; note: string }>;
  passed: boolean;
}> {
  loadDotEnv();
  resetEnvCache();

  const classifier = createIntentClassifierService();
  const rows = loadIntentEvalFixture();
  const failures: Array<{ text: string; expected: string; got: string; note: string }> = [];
  let hits = 0;

  for (const row of rows) {
    const result = await classifier.classify(row.text);
    if (result.intent === row.expected) {
      hits += 1;
    } else {
      failures.push({
        text: row.text,
        expected: row.expected,
        got: result.intent,
        note: row.note,
      });
    }
  }

  const hitRate = rows.length ? hits / rows.length : 0;
  return {
    total: rows.length,
    hits,
    hitRate,
    failures,
    passed: hitRate >= minHitRate,
  };
}

async function main(): Promise<void> {
  const report = await runIntentClassifierEval(0.85);
  console.log(`\nIntent eval: ${report.hits}/${report.total} (${(report.hitRate * 100).toFixed(1)}%)`);
  if (report.failures.length) {
    console.log('\nFailures:');
    for (const f of report.failures) {
      console.log(`- [${f.expected} != ${f.got}] ${f.text} (${f.note})`);
    }
  }
  process.exit(report.passed ? 0 : 1);
}

const isMain = process.argv[1]?.includes('intent-classifier.eval.ts');
if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
