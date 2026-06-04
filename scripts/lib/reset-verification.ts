/** Post-reset counts expected in homologation DB (greenfield v2). */

export const FLOW_TABLES = [
  'assertion_entities',
  'entity_alias_evidences',
  'inbox_item_entities',
  'clarification_requests',
  'entity_resolution_logs',
  'event_entities',
  'task_mutations',
  'assertions',
  'events',
  'inbox_extraction_runs',
  'corrections',
  'inbox_items',
] as const;

export type FlowTable = (typeof FLOW_TABLES)[number];

export interface ResetVerificationResult {
  ok: boolean;
  counts: Record<string, number>;
  failures: string[];
}

export interface CountRow {
  table: string;
  count: number;
}

export function evaluateResetCounts(
  counts: CountRow[],
  options: { geniusSeedExpected?: boolean } = {},
): ResetVerificationResult {
  const byTable = new Map(counts.map((c) => [c.table, c.count]));
  const failures: string[] = [];

  for (const table of FLOW_TABLES) {
    const n = byTable.get(table) ?? -1;
    if (n !== 0) {
      failures.push(`${table}: expected 0, got ${n}`);
    }
  }

  const entities = byTable.get('entities') ?? -1;
  const aliases = byTable.get('entity_aliases') ?? -1;
  const tasks = byTable.get('tasks') ?? -1;

  if (options.geniusSeedExpected) {
    if (entities !== 1) failures.push(`entities: expected 1 (Genius seed), got ${entities}`);
    if (aliases !== 1) failures.push(`entity_aliases: expected 1 (Genius seed), got ${aliases}`);
  } else {
    if (entities !== 0) failures.push(`entities: expected 0, got ${entities}`);
    if (aliases !== 0) failures.push(`entity_aliases: expected 0, got ${aliases}`);
  }

  if (tasks !== 0) {
    failures.push(`tasks: expected 0 (projection global cleared), got ${tasks}`);
  }

  return { ok: failures.length === 0, counts: Object.fromEntries(byTable), failures };
}

export function isBlockedProductionTarget(supabaseUrl: string, nodeEnv: string): string | null {
  if (nodeEnv === 'production') {
    return 'NODE_ENV=production — reset bloqueado';
  }
  const url = supabaseUrl.toLowerCase();
  const blocked = ['prod.', 'production.', '-prod.', '.prod.'];
  for (const token of blocked) {
    if (url.includes(token)) return `URL contém "${token}" — reset bloqueado`;
  }
  if (process.env.BLOCK_TEST_DATA_RESET === 'true') {
    return 'BLOCK_TEST_DATA_RESET=true — reset bloqueado';
  }
  return null;
}
