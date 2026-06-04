import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FIXED_EXTRACTOR_FIXTURES } from '../src/calibration/extractor-v1.4/fixed-extractor-fixtures.js';
import { FIXED_CALIBRATION_EXPECTATIONS } from '../src/calibration/extractor-v1.4/fixed-calibration-expectations.js';
import { runV14ContextPipeline } from '../src/calibration/extractor-v1.4/run-v14-context-pipeline.js';
import { buildEffectiveInputWithSourceBlocks } from '../src/utils/source-blocks.js';

const registry = JSON.parse(
  readFileSync('data/calibration/extractor-v1.4/registry-fixture.json', 'utf8'),
);
const sid = 'v14-ctx-due-date-unique';
const caseWithBlock = JSON.parse(
  readFileSync(join('data/calibration/extractor-v1.4/cases', `${sid}.json`), 'utf8'),
);
const plainBody = 'O prazo da revisão mudou para sexta.';
const casePlain = { ...caseWithBlock, raw_content: plainBody };
const caseLiveFixed = {
  ...caseWithBlock,
  raw_content: buildEffectiveInputWithSourceBlocks({ raw_content: plainBody }),
};
const output = FIXED_EXTRACTOR_FIXTURES[sid]!;
const expected = FIXED_CALIBRATION_EXPECTATIONS[sid]!;

let failed = false;

for (const [label, caseFile] of [
  ['WITH [SOURCE_BLOCK:raw] in caseFile.raw_content', caseWithBlock],
  ['PLAIN raw_content (broken live runner)', casePlain],
  ['Live runner corrected (buildEffectiveInputWithSourceBlocks)', caseLiveFixed],
] as const) {
  const r = runV14ContextPipeline({
    scenarioId: sid,
    extractorOutput: output,
    expected,
    caseFile,
    registryEntities: registry.entities,
  });
  console.log(label);
  console.log('  decision:', r.compiled.decision.status);
  console.log('  tasks:', r.compiled.tasks.length);
  console.log('  evidence:', r.compiled.contextResolutionEvidence.length);
  console.log(
    '  invalid_source_block drops:',
    r.compiled.droppedArtifacts.filter((d) => d.reason === 'invalid_source_block').length,
  );
  console.log('  passed:', r.evaluation.passed, r.evaluation.failures);

  if (label.includes('corrected') || label.startsWith('WITH')) {
    if (r.compiled.decision.status !== 'accepted' || r.compiled.tasks.length !== 1) {
      failed = true;
    }
  }
  if (label.includes('broken')) {
    if (r.compiled.tasks.length !== 0) {
      failed = true;
    }
  }
}

if (failed) {
  console.error('\nProve script FAILED expectations');
  process.exit(1);
}
console.log('\nProve script OK');
