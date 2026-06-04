import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { ExtractorOutputV14 } from '../src/openai/extractor-v1.4.types.js';
import { runV14ContextPipeline } from '../src/calibration/extractor-v1.4/run-v14-context-pipeline.js';
import { filterV14VariationsByCategories } from '../src/calibration/extractor-v1.4/live-variations.js';

const registry = JSON.parse(
  readFileSync('data/calibration/extractor-v1.4/registry-fixture.json', 'utf8'),
);
const dir = join('artifacts/calibration/extractor-v1.4-live-captures');

for (const f of readdirSync(dir).sort()) {
  const cap = JSON.parse(readFileSync(join(dir, f), 'utf8')) as {
    scenario_id: string;
    category: string;
    repetition: number;
    effective_input_for_extractor: string;
    ingestion_context_id: string;
    source_metadata: Record<string, unknown>;
    task_signals: ExtractorOutputV14['task_signals'];
    llm_clarification_candidates: ExtractorOutputV14['clarification_candidates'];
    expected: Parameters<typeof runV14ContextPipeline>[0]['expected'];
  };
  const variation = filterV14VariationsByCategories([cap.category])[0]!;
  const caseFixed = {
    scenario_id: cap.scenario_id,
    raw_content: cap.effective_input_for_extractor,
    regime: variation.regime,
    ingestion_context_id: cap.ingestion_context_id,
    source_metadata: cap.source_metadata,
  };
  const output: ExtractorOutputV14 = {
    entity_mentions: [],
    aliases: [],
    events: [],
    assertions: [],
    task_signals: cap.task_signals,
    correction_signals: [],
    clarification_candidates: cap.llm_clarification_candidates,
    review_hints: [],
  };
  const r = runV14ContextPipeline({
    scenarioId: cap.scenario_id,
    extractorOutput: output,
    expected: cap.expected,
    caseFile: caseFixed,
    registryEntities: registry.entities,
  });
  console.log(
    r.evaluation.passed ? 'PASS' : 'FAIL',
    cap.category,
    `r${cap.repetition}`,
    r.compiled.decision.status,
    r.evaluation.failures.join('; ') || '-',
    `tasks=${r.compiled.tasks.length}`,
    `evidence=${r.compiled.contextResolutionEvidence.length}`,
  );
}
