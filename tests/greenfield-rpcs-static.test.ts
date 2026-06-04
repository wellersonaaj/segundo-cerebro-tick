import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const RPCS_SQL = readFileSync(
  join(process.cwd(), 'supabase/migrations/20260602100001_greenfield_rpcs.sql'),
  'utf8',
);

const S1_SQL = readFileSync(
  join(process.cwd(), 'supabase/migrations/20260603120000_s1_simplify_promote_blocking_scope.sql'),
  'utf8',
);

const S2_SQL = readFileSync(
  join(process.cwd(), 'supabase/migrations/20260603130000_s2_external_action_no_promote_block.sql'),
  'utf8',
);

describe('greenfield RPCs static validation (Bloco 6F + S1.1 + S2)', () => {
  it('apply_task_mutations raises TASK_MUTATION_TARGET_REQUIRED', () => {
    expect(RPCS_SQL).toContain('TASK_MUTATION_TARGET_REQUIRED');
  });

  it('apply_task_mutations raises TASK_MUTATION_TARGET_NOT_FOUND', () => {
    expect(RPCS_SQL).toContain('TASK_MUTATION_TARGET_NOT_FOUND');
  });

  it('fail_extraction_run rejects registry entity candidates', () => {
    expect(RPCS_SQL).toMatch(
      /update entities set registry_status = 'rejected'[\s\S]*created_by_extraction_run_id = p_run_id/,
    );
  });

  it('fail_extraction_run rejects registry alias candidates', () => {
    expect(RPCS_SQL).toMatch(
      /update entity_aliases set registry_status = 'rejected'[\s\S]*created_by_extraction_run_id = p_run_id/,
    );
  });

  it('promote calls apply_task_mutations before activate', () => {
    const applyIdx = RPCS_SQL.indexOf('perform public.apply_task_mutations_for_run');
    const activateIdx = RPCS_SQL.indexOf(
      "update inbox_item_entities set record_status = 'active'",
    );
    expect(applyIdx).toBeGreaterThan(-1);
    expect(activateIdx).toBeGreaterThan(applyIdx);
  });

  it('historical promote blocks knowledge_confirmation and external_action', () => {
    expect(RPCS_SQL).toContain(
      "blocking_scope in ('knowledge_confirmation', 'external_action')",
    );
    expect(RPCS_SQL).toContain('BLOCKING_CLARIFICATIONS');
  });

  it('S1 incremental promote blocks only external_action', () => {
    expect(S1_SQL).toContain("blocking_scope in ('external_action')");
    expect(S1_SQL).not.toContain(
      "blocking_scope in ('knowledge_confirmation', 'external_action')",
    );
    expect(S1_SQL).toContain('BLOCKING_CLARIFICATIONS');
  });

  it('S2 incremental promote removes external_action gate', () => {
    expect(S2_SQL).toContain(
      'S2: external_action bloqueia execução futura, não ingestão ou promoção da memória',
    );
    expect(S2_SQL).not.toContain("blocking_scope in ('external_action')");
    expect(S2_SQL).not.toContain('BLOCKING_CLARIFICATIONS');
    expect(S2_SQL).toContain('create or replace function promote_extraction_run');
  });
});
