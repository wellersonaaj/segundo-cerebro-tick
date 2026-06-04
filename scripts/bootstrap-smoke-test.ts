/**
 * Smoke bootstrap — requer importação prévia do arquivo 01-identidade-e-pessoas.md.
 *
 *   ALLOW_TEST_DATA_RESET=true npm run reset:test-data
 *   ALLOW_BOOTSTRAP_IMPORT=true npm run import:bootstrap -- data/bootstrap/01-identidade-e-pessoas.md
 *   npm run dev   (em outro terminal, se validar REST)
 *   npm run test:bootstrap:smoke
 */

import { loadDotEnv } from '../src/config/load-dotenv.js';
import { createClient } from '@supabase/supabase-js';
import { loadEnv } from '../src/config/env.js';
import { EntitiesRepository } from '../src/repositories/entities.repository.js';
import { selectBootstrapPrimaryEvent } from '../src/services/bootstrap-primary-event.js';
import { getEntityDetails } from '../src/mcp/tools/get-entity-details.tool.js';
import { searchEntities } from '../src/mcp/tools/search-entities.tool.js';
import { MemorySearchService } from '../src/services/memory-search.service.js';
import { AssertionsRepository } from '../src/repositories/assertions.repository.js';
import { EventsRepository } from '../src/repositories/events.repository.js';
import { TasksRepository } from '../src/repositories/tasks.repository.js';
import { EntityResolutionRepository } from '../src/repositories/entity-resolution.repository.js';
import { InboxItemEntitiesRepository } from '../src/repositories/inbox-item-entities.repository.js';
import { normalizeText } from '../src/utils/normalize.js';
import { fail, ok, requireEnv } from './lib/homolog-helpers.js';

loadDotEnv();
requireEnv(['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']);

const env = loadEnv();
const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const entitiesRepo = new EntitiesRepository(supabase);

const EXPECTED_ENTITY_COUNT = 16;
const EXPECTED_ALIAS_COUNT = 11;

const ALIAS_RESOLUTIONS: Array<{ alias: string; canonical: string }> = [
  { alias: 'Tick', canonical: 'Wellerson Assumpção' },
  { alias: 'Lari', canonical: 'Larisse do Carmo Peixoto' },
  { alias: 'Tchelo', canonical: 'Marcelo Oliveira' },
  { alias: 'Nicolas', canonical: 'Nicolas Alexandre de Souza Faleiro' },
  { alias: 'Bruno', canonical: 'Bruno Brant Gotschalg' },
  { alias: 'Brant', canonical: 'Bruno Brant Gotschalg' },
  { alias: 'Shell', canonical: 'Helcio Shell' },
  { alias: 'Guerra', canonical: 'Gabriel Guerra' },
];

const FORBIDDEN_STANDALONE_ALIASES = ['Tick', 'Lari', 'Tchelo'];

async function findLatestBootstrapInbox() {
  const { data, error } = await supabase
    .from('inbox_items')
    .select(
      'id, processing_status, processed_at, processing_error, extractor_version, source_channel, active_extraction_run_id, latest_extraction_run_id',
    )
    .eq('source_channel', 'bootstrap')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) fail(`inbox_items lookup: ${error.message}`);
  if (!data) {
    fail(
      'Nenhum inbox_item bootstrap encontrado. Rode ALLOW_BOOTSTRAP_IMPORT=true npm run import:bootstrap -- data/bootstrap/01-identidade-e-pessoas.md',
    );
  }
  return data;
}

async function main(): Promise<void> {
  console.log('\n=== Bootstrap smoke ===\n');

  const inbox = await findLatestBootstrapInbox();
  ok(`inbox_item bootstrap encontrado: ${inbox.id}`);

  if (inbox.processing_status !== 'completed') {
    fail(`processing_status esperado completed, obtido ${inbox.processing_status}`);
  }
  ok('processing_status = completed');

  if (!inbox.processed_at) {
    fail('processed_at está null — esperado timestamp de conclusão');
  }
  ok(`processed_at preenchido (${inbox.processed_at})`);

  if (inbox.processing_error) {
    fail(`processing_error deveria ser null, obtido: ${inbox.processing_error}`);
  }
  ok('processing_error = null');

  if (inbox.extractor_version !== 'extractor-v1.3') {
    fail(`extractor_version esperado extractor-v1.3, obtido ${inbox.extractor_version}`);
  }
  ok('extractor_version = extractor-v1.3');

  if (!inbox.active_extraction_run_id) {
    fail('active_extraction_run_id está null — esperado run promovido');
  }
  ok(`active_extraction_run_id = ${inbox.active_extraction_run_id}`);

  if (!inbox.latest_extraction_run_id) {
    fail('latest_extraction_run_id está null');
  }
  ok(`latest_extraction_run_id = ${inbox.latest_extraction_run_id}`);

  const { count: entityCount, error: entityCountErr } = await supabase
    .from('entities')
    .select('id', { count: 'exact', head: true })
    .eq('registry_status', 'active');

  if (entityCountErr) fail(`entities count: ${entityCountErr.message}`);
  if ((entityCount ?? 0) !== EXPECTED_ENTITY_COUNT) {
    fail(`esperado ${EXPECTED_ENTITY_COUNT} entities ativas, obtido ${entityCount}`);
  }
  ok(`entities = ${EXPECTED_ENTITY_COUNT}`);

  const { count: aliasCount, error: aliasCountErr } = await supabase
    .from('entity_aliases')
    .select('id', { count: 'exact', head: true });

  if (aliasCountErr) fail(`entity_aliases count: ${aliasCountErr.message}`);
  if ((aliasCount ?? 0) !== EXPECTED_ALIAS_COUNT) {
    fail(`esperado ${EXPECTED_ALIAS_COUNT} entity_aliases, obtido ${aliasCount}`);
  }
  ok(`entity_aliases = ${EXPECTED_ALIAS_COUNT}`);

  for (const { alias, canonical } of ALIAS_RESOLUTIONS) {
    const matches = await entitiesRepo.searchEntitiesQuery(alias, [], 5);
    const hit = matches.find((m) => m.name === canonical);
    if (!hit) {
      fail(
        `search_entities("${alias}") não resolveu ${canonical}. Matches: ${JSON.stringify(matches.map((m) => m.name))}`,
      );
    }
    ok(`search_entities("${alias}") → ${canonical}`);
  }

  for (const alias of FORBIDDEN_STANDALONE_ALIASES) {
    const byName = await entitiesRepo.findByNormalizedName(normalizeText(alias));
    if (byName) {
      fail(`entity separada indevida para alias "${alias}": ${byName.name} (${byName.id})`);
    }
    ok(`não existe entity separada "${alias}"`);
  }

  const { count: iieCount, error: iieErr } = await supabase
    .from('inbox_item_entities')
    .select('id', { count: 'exact', head: true })
    .eq('inbox_item_id', inbox.id)
    .eq('record_status', 'active');

  if (iieErr) fail(`inbox_item_entities count: ${iieErr.message}`);
  if ((iieCount ?? 0) !== EXPECTED_ENTITY_COUNT) {
    fail(`inbox_item_entities active = ${iieCount}, esperado ${EXPECTED_ENTITY_COUNT}`);
  }
  ok(`inbox_item_entities active = ${EXPECTED_ENTITY_COUNT}`);

  const { data: inboxEvents, error: inboxEventsErr } = await supabase
    .from('events')
    .select('id, event_kind, confidence, created_at')
    .eq('inbox_item_id', inbox.id)
    .eq('record_status', 'active')
    .order('created_at', { ascending: true });

  if (inboxEventsErr) fail(`events lookup: ${inboxEventsErr.message}`);

  if (inboxEvents?.length) {
    const eventTypes = inboxEvents.map((e) => e.event_kind as string).join(', ');
    ok(`eventos do inbox bootstrap: ${eventTypes}`);

    const primarySelection = selectBootstrapPrimaryEvent(
      inboxEvents.map((e, index) => ({
        id: e.id as string,
        event_type: e.event_kind as string,
        confidence: Number(e.confidence ?? 0),
        index,
      })),
    );

    if (primarySelection) {
      ok(
        `evento principal bootstrap: ${primarySelection.eventType} (${primarySelection.eventId}, strategy=${primarySelection.strategy})`,
      );
    }
  } else {
    ok('events active = 0 (proveniência via inbox_item_entities)');
  }

  const { count: tasksCount, error: tasksErr } = await supabase
    .from('task_mutations')
    .select('id', { count: 'exact', head: true })
    .eq('inbox_item_id', inbox.id)
    .eq('record_status', 'active');

  if (tasksErr) fail(`task_mutations lookup: ${tasksErr.message}`);
  if ((tasksCount ?? 0) !== 0) fail(`esperado 0 task_mutations, obtido ${tasksCount}`);
  ok('task_mutations = 0');

  const { count: clarCount, error: clarErr } = await supabase
    .from('clarification_requests')
    .select('id', { count: 'exact', head: true })
    .eq('inbox_item_id', inbox.id)
    .eq('status', 'pending');

  if (clarErr) fail(`clarifications lookup: ${clarErr.message}`);
  if ((clarCount ?? 0) !== 0) fail(`esperado 0 clarifications pendentes, obtido ${clarCount}`);
  ok('clarifications = 0');

  const searchService = new MemorySearchService(
    entitiesRepo,
    new EventsRepository(supabase),
    new AssertionsRepository(supabase),
    new TasksRepository(supabase),
    new EntityResolutionRepository(supabase),
    new InboxItemEntitiesRepository(supabase),
  );

  const tickSearch = await searchService.search('Tick', 5);
  const tickHit = tickSearch.entities.find((e) => e.name === 'Wellerson Assumpção');
  if (!tickHit) {
    fail(`GET /memory/search?q=Tick não resolveu Wellerson Assumpção`);
  }
  if (!tickHit.aliases.includes('Tick')) {
    fail(`aliases em memory/search não incluem Tick: ${JSON.stringify(tickHit.aliases)}`);
  }
  ok('GET /memory/search?q=Tick → Wellerson Assumpção com aliases');

  const wellerson = await entitiesRepo.findByNormalizedName(normalizeText('Wellerson Assumpção'));
  if (!wellerson) fail('Wellerson Assumpção não encontrado');

  const entityDetails = await searchService.getEntityDetails(wellerson.id);
  if (!entityDetails?.aliases.includes('Wellerson') || !entityDetails.aliases.includes('Tick')) {
    fail(
      `GET /entities/:id aliases esperados Wellerson e Tick, obtido: ${JSON.stringify(entityDetails?.aliases)}`,
    );
  }
  ok('GET /entities/:id → aliases inclui Wellerson e Tick');

  const mcpSearch = await searchEntities(searchService, { query: 'Tick', entity_types: [], limit: 5 });
  const mcpHit = mcpSearch.matches.find((m) => m.name === 'Wellerson Assumpção');
  if (!mcpHit || mcpHit.match_type !== 'exact_alias') {
    fail(`MCP search_entities("Tick") falhou: ${JSON.stringify(mcpSearch)}`);
  }
  ok('MCP search_entities("Tick") → exact_alias');

  const mcpDetails = await getEntityDetails(searchService, { entity_id: wellerson.id });
  if ('error' in mcpDetails) fail(`MCP get_entity_details erro: ${mcpDetails.error}`);
  if (!mcpDetails.aliases.includes('Tick')) {
    fail(`MCP get_entity_details aliases sem Tick: ${JSON.stringify(mcpDetails.aliases)}`);
  }
  ok('MCP get_entity_details → aliases inclui Tick');

  console.log('\nBootstrap smoke OK.\n');
}

main().catch((err) => {
  fail(err instanceof Error ? err.message : String(err));
});
