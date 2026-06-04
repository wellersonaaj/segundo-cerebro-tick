/**
 * Read-only audit of 160 extractor-v1.4 live captures.
 *
 *   npm run audit:extractor:v1.4:live
 */

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  aggregateByCategory,
  aggregateCorrectedMetrics,
  auditLiveV14Capture,
  buildAuditSummaryMarkdown,
  type LiveV14AuditRow,
  type LiveV14CaptureFile,
} from '../src/calibration/extractor-v1.4/live-audit-detail.js';
import type { RegistryEntityFixture } from '../src/services/reference-resolver.service.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const capturesDir = join(root, 'artifacts/calibration/extractor-v1.4-live-captures');
const artifactsDir = join(root, 'artifacts/calibration');
const categoriesArg = process.argv.find((a) => a.startsWith('--categories='));
const categoriesFilter = categoriesArg
  ? categoriesArg.split('=')[1]!.split(',').map((s) => s.trim())
  : [];

function loadCaptures(): LiveV14CaptureFile[] {
  const files = readdirSync(capturesDir)
    .filter((f) => f.endsWith('.json'))
    .sort();
  const captures = files.map(
    (f) => JSON.parse(readFileSync(join(capturesDir, f), 'utf8')) as LiveV14CaptureFile,
  );
  if (categoriesFilter.length === 0) return captures;
  const set = new Set(categoriesFilter);
  return captures.filter((c) => set.has(c.category));
}

function main(): void {
  const captures = loadCaptures();
  if (captures.length === 0) {
    console.error(`Nenhuma captura em ${capturesDir}`);
    process.exit(1);
  }

  const registry = JSON.parse(
    readFileSync(join(root, 'data/calibration/extractor-v1.4/registry-fixture.json'), 'utf8'),
  ) as { entities: RegistryEntityFixture[] };

  const rows: LiveV14AuditRow[] = captures.map((c) => auditLiveV14Capture(c, registry.entities));

  const corrected_metrics = aggregateCorrectedMetrics(rows);
  const by_category = aggregateByCategory(rows);

  const by_code: Record<string, number> = {};
  const by_layer: Record<string, number> = {};
  for (const row of rows) {
    by_code[row.classification.code] = (by_code[row.classification.code] ?? 0) + 1;
    by_layer[row.classification.layer] = (by_layer[row.classification.layer] ?? 0) + 1;
  }

  let legacy_metrics: Record<string, number> | null = null;
  const reportPath = join(artifactsDir, 'extractor-v1.4-live-report.json');
  try {
    const prior = JSON.parse(readFileSync(reportPath, 'utf8')) as { metrics?: Record<string, number> };
    legacy_metrics = prior.metrics ?? null;
  } catch {
    legacy_metrics = null;
  }

  const top_real_failures = rows
    .filter((r) => !r.observed.evaluation_passed && r.classification.layer !== 'metric')
    .map((r) => ({
      scenario_id: r.scenario_id,
      rationale: r.classification.rationale,
      code: r.classification.code,
      layer: r.classification.layer,
    }));

  const generated_at = new Date().toISOString();
  mkdirSync(artifactsDir, { recursive: true });

  const detail = {
    generated_at,
    total_runs: rows.length,
    corrected_metrics,
    legacy_metrics,
    by_code,
    by_layer,
    by_category,
    executions: rows,
  };

  writeFileSync(
    join(artifactsDir, 'extractor-v1.4-live-audit-detail.json'),
    JSON.stringify(detail, null, 2),
  );

  const summary = buildAuditSummaryMarkdown({
    generated_at,
    total_runs: rows.length,
    corrected_metrics,
    legacy_metrics,
    by_category,
    by_code,
    by_layer,
    top_real_failures,
  });

  writeFileSync(join(artifactsDir, 'extractor-v1.4-live-audit-summary.md'), summary);

  console.log(`Audited ${rows.length} captures`);
  console.log('Corrected metrics:', corrected_metrics);
  console.log('By code:', by_code);
  console.log('By layer:', by_layer);
  console.log('Wrote:', join(artifactsDir, 'extractor-v1.4-live-audit-detail.json'));
  console.log('Wrote:', join(artifactsDir, 'extractor-v1.4-live-audit-summary.md'));
}

main();
