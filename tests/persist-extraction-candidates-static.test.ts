import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const PERSIST_SQL = readFileSync(
  join(process.cwd(), 'supabase/migrations/20260604130000_persist_entity_upsert_do_nothing.sql'),
  'utf8',
);

const BASELINE_SQL = readFileSync(
  join(process.cwd(), 'supabase/migrations/20260602100000_greenfield_baseline.sql'),
  'utf8',
);

describe('persist_extraction_candidates static validation', () => {
  it('alias insert uses global normalized_alias conflict target', () => {
    expect(BASELINE_SQL).toContain('idx_entity_aliases_normalized_active_candidate');
    expect(PERSIST_SQL).toMatch(
      /on conflict \(normalized_alias\) where registry_status in \('active', 'candidate'\)/i,
    );
    expect(PERSIST_SQL).not.toMatch(
      /on conflict \(entity_id, normalized_alias\) where registry_status in \('active', 'candidate'\)/i,
    );
  });

  it('resolves alias id by normalized_alias after insert', () => {
    expect(PERSIST_SQL).toMatch(
      /select id into v_alias_id[\s\S]*where normalized_alias = normalize_text\(v_alia\.alias\)/,
    );
  });

  it('entity upsert uses normalized_name partial unique', () => {
    expect(PERSIST_SQL).toMatch(
      /on conflict \(normalized_name\) where registry_status in \('active', 'candidate'\)/i,
    );
    expect(PERSIST_SQL).toMatch(
      /on conflict \(normalized_name\) where registry_status in \('active', 'candidate'\)\s+do nothing/i,
    );
  });

  it('clarifications normalize nullable target_reference', () => {
    expect(PERSIST_SQL).toContain("normalize_text(coalesce(v_cl.target_reference, ''))");
  });

  it('due_at_instant uses ISO date prefix guard like occurred_at', () => {
    expect(PERSIST_SQL).toMatch(
      /v_tm\.due_at_instant ~ '\^\[0-9\]\{4\}-\[0-9\]\{2\}-\[0-9\]\{2\}'/,
    );
  });

  it('entity_id map resolves names from aliases and related payloads', () => {
    expect(PERSIST_SQL).toMatch(/normalize_text\(x\.target_entity_name\)/);
    expect(PERSIST_SQL).toMatch(/e\.registry_status in \('active', 'candidate'\)/);
  });
});
