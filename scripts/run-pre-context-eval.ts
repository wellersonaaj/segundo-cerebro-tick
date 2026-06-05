/**
 * Compara extração com/sem pre-context injection.
 * Salva artifacts/pre-context-eval.json
 *
 * Uso: npx tsx scripts/run-pre-context-eval.ts
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadDotEnv } from '../src/config/load-dotenv.js';
import { resetEnvCache } from '../src/config/env.js';
import type { ExtractV14Fn } from '../src/openai/extractor-v1.4.service.js';
import type { ExtractorOutputV14 } from '../src/openai/extractor-v1.4.types.js';
import { ExtractorV14CompileService } from '../src/services/extractor-v14-compile.service.js';
import { formatRetrievalAsContextBlock } from '../src/services/pre-context.service.js';
import type { RetrieveResult } from '../src/services/retrieval.service.js';
import type { InboxItem } from '../src/types/domain.js';
import { loadExtractorV14Fixture } from '../tests/helpers/mock-extractor-v14.js';
import { createEmptySupabaseMock } from '../tests/helpers/mock-supabase.js';

loadDotEnv();
resetEnvCache();

const SAMPLES: Array<{ text: string; retrieval: RetrieveResult }> = [
  {
    text: 'reunião com Breno amanhã cedo',
    retrieval: {
      inbox: [
        {
          id: '1',
          content: 'marquei consulta com Breno quinta 14h',
          source_channel: 'telegram',
          occurred_at: '2026-06-01',
          score: 0.9,
        },
      ],
      assertions: [],
      latencyMs: 12,
    },
  },
  {
    text: 'status do projeto ESX',
    retrieval: {
      inbox: [
        {
          id: '2',
          content: 'almocei com a Lari, falei do ESX',
          source_channel: 'telegram',
          occurred_at: '2026-06-02',
          score: 0.88,
        },
      ],
      assertions: [
        {
          id: '3',
          content: 'Projeto ESX status em risco',
          source_channel: 'memory',
          occurred_at: '2026-06-03',
          score: 0.85,
        },
      ],
      latencyMs: 18,
    },
  },
  {
    text: 'lembrete pagar internet',
    retrieval: { inbox: [], assertions: [], latencyMs: 5 },
  },
];

function createContextAwareExtract(): ExtractV14Fn {
  return async (params) => {
    const base = structuredClone(loadExtractorV14Fixture());
    if (params.context_block?.includes('Breno')) {
      base.entity_mentions.push({
        mention_text: 'Breno',
        suggested_entity_type: 'person',
        source_excerpt: params.effective_input.slice(0, 80),
        source_block_reference: null,
      });
    }
    if (params.context_block?.includes('ESX')) {
      base.entity_mentions.push({
        mention_text: 'ESX',
        suggested_entity_type: 'project',
        source_excerpt: params.effective_input.slice(0, 80),
        source_block_reference: null,
      });
    }
    return base as ExtractorOutputV14;
  };
}

function entityMentionCount(output: ExtractorOutputV14): number {
  return output.entity_mentions.length;
}

async function runSample(
  sample: (typeof SAMPLES)[number],
  withPreContext: boolean,
  extractV14: ExtractV14Fn,
): Promise<{ entity_mentions: number; context_injected: boolean }> {
  const inboxItem: InboxItem = {
    id: 'f0000000-0000-4000-8000-000000000001',
    raw_content: sample.text,
    source_channel: 'telegram',
    source_mode: 'conversational',
    received_at: '2026-06-05T10:00:00-03:00',
    timezone: 'America/Sao_Paulo',
    processing_status: 'pending',
    extractor_version: null,
    processing_error: null,
    processed_at: null,
    active_extraction_run_id: null,
    latest_extraction_run_id: null,
    created_at: '2026-06-05T10:00:00Z',
  };

  const preContextBlock = withPreContext
    ? formatRetrievalAsContextBlock(sample.retrieval) || undefined
    : undefined;

  const compileService = new ExtractorV14CompileService(
    createEmptySupabaseMock() as never,
    extractV14,
  );
  const result = await compileService.compileFromInbox(inboxItem, { preContextBlock });

  return {
    entity_mentions: entityMentionCount(result.output),
    context_injected: Boolean(preContextBlock),
  };
}

async function main(): Promise<void> {
  const extractV14 = createContextAwareExtract();
  const baselineRows = [];
  const withContextRows = [];

  for (const sample of SAMPLES) {
    baselineRows.push({ text: sample.text, ...(await runSample(sample, false, extractV14)) });
    withContextRows.push({ text: sample.text, ...(await runSample(sample, true, extractV14)) });
  }

  const baselineEntities = baselineRows.reduce((s, r) => s + r.entity_mentions, 0);
  const withContextEntities = withContextRows.reduce((s, r) => s + r.entity_mentions, 0);

  const report = {
    generated_at: new Date().toISOString(),
    samples: SAMPLES.length,
    baseline: {
      entity_mentions_total: baselineEntities,
      rows: baselineRows,
    },
    with_pre_context: {
      entity_mentions_total: withContextEntities,
      rows: withContextRows,
    },
    delta: {
      entity_mentions: withContextEntities - baselineEntities,
      recall_at_least_baseline: withContextEntities >= baselineEntities,
    },
  };

  const outDir = join(process.cwd(), 'artifacts');
  await mkdir(outDir, { recursive: true });
  const outPath = join(outDir, 'pre-context-eval.json');
  await writeFile(outPath, JSON.stringify(report, null, 2) + '\n', 'utf8');

  console.log(JSON.stringify(report, null, 2));
  console.log(`\nSaved: ${outPath}`);
  if (!report.delta.recall_at_least_baseline) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
