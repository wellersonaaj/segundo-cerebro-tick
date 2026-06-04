/** Allowed SOURCE_BLOCK identifiers (EffectiveInputBuilder assigns these). */
export const SOURCE_BLOCK_RAW = '[SOURCE_BLOCK:raw]';

const CORRECTION_BLOCK_RE =
  /^\[SOURCE_BLOCK:correction:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\]$/i;

const CLARIFICATION_BLOCK_RE =
  /^\[SOURCE_BLOCK:clarification:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\]$/i;

export function isAllowedSourceBlockReference(value: string | null | undefined): boolean {
  if (value == null) return true;
  const trimmed = value.trim();
  if (trimmed.length === 0) return true;
  if (trimmed === SOURCE_BLOCK_RAW) return true;
  return CORRECTION_BLOCK_RE.test(trimmed) || CLARIFICATION_BLOCK_RE.test(trimmed);
}

export function assertAllowedSourceBlockReference(
  value: string | null | undefined,
  field: string,
): void {
  if (!isAllowedSourceBlockReference(value)) {
    throw new Error(
      `${field}: invalid source_block_reference "${value ?? ''}" — use ${SOURCE_BLOCK_RAW} or [SOURCE_BLOCK:correction:<uuid>]`,
    );
  }
}
