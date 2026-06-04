/**
 * Read-only audit of 80 live captures (extractor-v1.3).
 * Emits JSON + generated spec draft. Does NOT overwrite docs/extractor-v1.4-spec.md.
 *
 *   npx tsx scripts/audit-live-variability-detail.ts
 */

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { LiveCaptureRecord } from '../src/calibration/compiler-v1/live-capture.js';
import {
  aggregateByCategory,
  aggregateClassifications,
  auditLiveCapture,
  type LiveCaptureAuditRow,
} from '../src/calibration/extractor-v1.4/audit-detail.js';
import { FixtureMemoryResolver } from '../src/calibration/compiler-v1/fixture-memory-resolver.js';
import type { RegistryFixture } from '../src/calibration/compiler-v1/types.js';
import { MemoryCompilerService } from '../src/services/memory-compiler.service.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const capturesDir = join(root, 'artifacts/calibration/live-captures');
const outDir = join(root, 'artifacts/calibration');

function loadCaptures(): LiveCaptureRecord[] {
  const files = readdirSync(capturesDir)
    .filter((f) => f.endsWith('.json'))
    .sort();
  return files.map((f) => {
    const raw = readFileSync(join(capturesDir, f), 'utf8');
    return JSON.parse(raw) as LiveCaptureRecord;
  });
}

function formatClassificationTable(counts: Record<string, number>): string {
  const order = [
    'A_compiler_deterministic',
    'B_fixture_incomplete',
    'C_schema_signal_gap',
    'D_extractor_prompt',
    'E_legitimate_ambiguity',
    'F_metric_or_label_error',
  ];
  return order
    .map((k) => `| ${k} | ${counts[k] ?? 0} |`)
    .join('\n');
}

function buildGeneratedSpec(rows: LiveCaptureAuditRow[]): string {
  const generatedAt = new Date().toISOString();
  const classCounts = aggregateClassifications(rows);
  const byCategory = aggregateByCategory(rows);

  const categorySections = Object.entries(byCategory)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([category, data]) => {
      const examples = rows
        .filter((r) => r.category === category)
        .slice(0, 3)
        .map(
          (r) =>
            `- \`${r.scenario_id}\` rep=${r.repetition} **${r.classification}**: ${r.root_cause}`,
        )
        .join('\n');
      return `### ${category}

- Execuções: ${data.count}
- Classificações: ${JSON.stringify(data.classifications)}

${examples}
`;
    })
    .join('\n');

  const sampleRows = rows
    .slice(0, 5)
    .map(
      (r) =>
        `| ${r.scenario_id} | ${r.repetition} | ${r.classification} | ${r.evaluation_passed} | ${r.missing_v14_fields.slice(0, 2).join(', ')} |`,
    )
    .join('\n');

  return `# Extractor v1.4 — spec gerada (automática)

> **Não é documento canônico.** Revisar e consolidar em [\`docs/extractor-v1.4-spec.md\`](../docs/extractor-v1.4-spec.md).

Gerado em: ${generatedAt}  
Fonte: ${rows.length} capturas em \`artifacts/calibration/live-captures/\`

## Contagem A–F (revisada)

| Classificação | Qtd |
|---------------|-----|
${formatClassificationTable(classCounts)}

**Total:** ${rows.length}

## Por categoria

${categorySections}

## Amostra (5 primeiras linhas)

| scenario_id | rep | class | pass | missing v14 |
|-------------|-----|-------|------|-------------|
${sampleRows}

## Próximo passo

Curadoria manual → \`docs/extractor-v1.4-spec.md\`
`;
}

function main(): void {
  const registry = JSON.parse(
    readFileSync(join(root, 'data/calibration/compiler-v1/registry-fixture.json'), 'utf8'),
  ) as RegistryFixture;
  const resolver = new FixtureMemoryResolver(registry);
  const compiler = new MemoryCompilerService();

  const captures = loadCaptures();
  if (captures.length === 0) {
    console.error('No captures found in', capturesDir);
    process.exit(1);
  }

  const rows: LiveCaptureAuditRow[] = [];

  for (const cap of captures) {
    const resolvedMap = resolver.resolveEntities(
      'audit',
      cap.extractor_output.entities,
      cap.raw_content,
    );
    const compiled = compiler.compile({
      rawContent: cap.raw_content,
      sourceChannel: cap.source_channel,
      sourceMode: cap.source_mode,
      extractorOutput: cap.extractor_output,
      resolvedMap,
    });

    rows.push(
      auditLiveCapture({
        scenario_id: cap.scenario_id,
        category: cap.category,
        repetition_index: cap.repetition_index,
        raw_content: cap.raw_content,
        extractor_output: cap.extractor_output,
        expected: cap.expected,
        compiled_v1: compiled,
      }),
    );
  }

  mkdirSync(outDir, { recursive: true });

  const auditPayload = {
    generated_at: new Date().toISOString(),
    source: 'artifacts/calibration/live-captures',
    total_executions: rows.length,
    classification_counts: aggregateClassifications(rows),
    by_category: aggregateByCategory(rows),
    rows,
  };

  const jsonPath = join(outDir, 'compiler-v1-live-audit-detail.json');
  writeFileSync(jsonPath, JSON.stringify(auditPayload, null, 2));

  const generatedPath = join(outDir, 'extractor-v1.4-spec.generated.md');
  writeFileSync(generatedPath, buildGeneratedSpec(rows));

  console.log('Audit complete:', rows.length, 'captures');
  console.log('JSON:', jsonPath);
  console.log('Generated spec:', generatedPath);
  console.log('Classifications:', aggregateClassifications(rows));
}

main();
