/**
 * S3.1 — Bateria curta de classificação external_action (extractor v1.4 live).
 *
 *   ALLOW_EXTERNAL_ACTION_CALIBRATION=true npm run test:external-action:classification
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadDotEnv } from '../src/config/load-dotenv.js';
import { resetEnvCache } from '../src/config/env.js';
import { createOpenAiExtractorV14 } from '../src/openai/extractor-v1.4.service.js';
import {
  detectExternalActionSignals,
  type ExternalActionDetectionOutcome,
} from '../src/calibration/external-action-s31/detect-external-action.js';

loadDotEnv();
resetEnvCache();

const CASES_PATH = join(process.cwd(), 'data/calibration/external-action-s31/cases.json');
const REPORT_PATH = join(
  process.cwd(),
  'artifacts/calibration/external-action-s31-report.json',
);

interface CaseRow {
  id: string;
  raw_content: string;
  expected: string;
}

interface CasesFile {
  defaults: {
    source_channel: string;
    source_mode: string;
    received_at: string;
    timezone: string;
  };
  cases: CaseRow[];
}

function fail(msg: string): never {
  console.error(`\n✗ ${msg}`);
  process.exit(1);
}

function classifyResult(
  expected: string,
  outcome: ExternalActionDetectionOutcome,
  detected: boolean,
): 'true_positive' | 'false_negative' | 'false_positive' | 'ambiguous' {
  if (expected === 'external_action') {
    if (detected) return 'true_positive';
    if (outcome === 'ambiguous_task_only') return 'ambiguous';
    return 'false_negative';
  }
  if (detected) return 'false_positive';
  return 'true_positive';
}

async function main(): Promise<void> {
  if (process.env.ALLOW_EXTERNAL_ACTION_CALIBRATION !== 'true') {
    fail('Defina ALLOW_EXTERNAL_ACTION_CALIBRATION=true');
  }
  if (!process.env.OPENAI_API_KEY) {
    fail('OPENAI_API_KEY ausente');
  }

  const file = JSON.parse(readFileSync(CASES_PATH, 'utf8')) as CasesFile;
  const extract = createOpenAiExtractorV14();

  console.log('\n=== S3.1 — External action classification ===\n');

  const results = [];
  let truePositives = 0;
  let falseNegatives = 0;
  let falsePositives = 0;
  let ambiguous = 0;

  for (const testCase of file.cases) {
    console.log(`--- ${testCase.id} ---`);
    const output = await extract({
      effective_input: testCase.raw_content,
      source_channel: file.defaults.source_channel,
      source_mode: file.defaults.source_mode,
      received_at: file.defaults.received_at,
      timezone: file.defaults.timezone,
    });

    const detection = detectExternalActionSignals(output);
    const label = classifyResult(testCase.expected, detection.outcome, detection.detected);

    switch (label) {
      case 'true_positive':
        truePositives++;
        break;
      case 'false_negative':
        falseNegatives++;
        break;
      case 'false_positive':
        falsePositives++;
        break;
      case 'ambiguous':
        ambiguous++;
        break;
    }

    console.log(`  raw: ${testCase.raw_content}`);
    console.log(`  outcome: ${detection.outcome} | label: ${label}`);
    if (detection.signals.length) {
      console.log(`  signals: ${detection.signals.join('; ')}`);
    }

    results.push({
      id: testCase.id,
      raw_content: testCase.raw_content,
      expected: testCase.expected,
      detection,
      label,
      clarification_count: output.clarification_candidates.length,
      task_signals: output.task_signals.map((t) => ({
        operation: t.operation,
        title: t.title,
        task_kind: t.task_kind,
      })),
    });
  }

  const total = file.cases.length;
  const detectionRate = total > 0 ? truePositives / total : 0;

  const summary = {
    total,
    true_positives: truePositives,
    false_negatives: falseNegatives,
    false_positives: falsePositives,
    ambiguous,
    detection_rate: Number(detectionRate.toFixed(3)),
    limitation:
      detectionRate < 1
        ? 'Detecção end-to-end inconsistente — execução externa permanece proibida no uso assistido.'
        : 'Detecção end-to-end OK nesta bateria — guardrail operacional ainda vigente até validação ampliada.',
  };

  mkdirSync(join(process.cwd(), 'artifacts/calibration'), { recursive: true });
  writeFileSync(
    REPORT_PATH,
    JSON.stringify({ generated_at: new Date().toISOString(), summary, results }, null, 2),
  );

  console.log('\n--- Resumo ---');
  console.log(`  taxa de detecção: ${(detectionRate * 100).toFixed(1)}% (${truePositives}/${total})`);
  console.log(`  falsos negativos: ${falseNegatives}`);
  console.log(`  falsos positivos: ${falsePositives}`);
  console.log(`  ambíguos: ${ambiguous}`);
  console.log(`  relatório: ${REPORT_PATH}`);
  console.log(`\n  ${summary.limitation}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
