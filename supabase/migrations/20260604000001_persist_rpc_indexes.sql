-- Indexes required by persist_extraction_candidates RPC ON CONFLICT clauses

-- entities: partial unique por normalized_name ativo/candidato
CREATE UNIQUE INDEX IF NOT EXISTS idx_entities_normalized_name_active
  ON entities (normalized_name)
  WHERE registry_status IN ('active', 'candidate');

-- inbox_item_entities: unique por run + entity + relation
CREATE UNIQUE INDEX IF NOT EXISTS idx_inbox_item_entities_run_entity_relation
  ON inbox_item_entities (extraction_run_id, entity_id, relation_type);

-- entity_aliases: partial unique por entity + alias ativo/candidato
CREATE UNIQUE INDEX IF NOT EXISTS idx_entity_aliases_entity_normalized_active
  ON entity_aliases (entity_id, normalized_alias)
  WHERE registry_status IN ('active', 'candidate');

-- entity_alias_evidences: unique por alias + run + excerpt
CREATE UNIQUE INDEX IF NOT EXISTS idx_entity_alias_evidences_alias_run_excerpt
  ON entity_alias_evidences (entity_alias_id, extraction_run_id, source_excerpt);

-- task_mutations: expression index para ON CONFLICT com coalesce
CREATE UNIQUE INDEX IF NOT EXISTS idx_task_mutations_run_op_ref_title_candidate
  ON task_mutations (
    extraction_run_id,
    operation,
    coalesce(task_reference, ''),
    coalesce(title, '')
  )
  WHERE record_status = 'candidate';

-- event_entities: named constraint para ON CONFLICT ON CONSTRAINT
ALTER TABLE event_entities
  DROP CONSTRAINT IF EXISTS uq_event_entities_event_relation_ref;

ALTER TABLE event_entities
  ADD CONSTRAINT uq_event_entities_event_relation_ref
  UNIQUE (event_id, relation_type, entity_reference);
