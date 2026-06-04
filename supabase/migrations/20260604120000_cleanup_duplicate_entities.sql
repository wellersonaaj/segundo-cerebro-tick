-- 20260604120000_cleanup_duplicate_entities.sql
--
-- Limpa duplicatas inertes deixadas por runs concorrentes durante smoke tests.
-- As duplicatas em "ela" (1 active + 1 rejected) e "genius" (2 rejected) não
-- violam o índice UNIQUE parcial idx_entities_normalized_name_active porque
-- ele só cobre registry_status IN ('active','candidate'). São resíduo
-- histórico sem valor semântico.
--
-- Decisão: marcar como superseded (não deletar) para preservar trilha de
-- auditoria. Se preferir delete puro, trocar UPDATE por DELETE.
--
-- Idempotente: se as entidades já estiverem superseded, no-op.

UPDATE entities
SET registry_status = 'superseded', updated_at = now()
WHERE id = '2f2a6508-385a-4cfb-82e0-0445b1bb6c7b'::uuid
  AND registry_status = 'rejected';

UPDATE entities
SET registry_status = 'superseded', updated_at = now()
WHERE id = '2641939e-a638-414b-8dfb-f0f0955992ae'::uuid
  AND registry_status = 'rejected';
