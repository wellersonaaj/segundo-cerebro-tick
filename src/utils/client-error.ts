/** Sanitized client-facing error body — never expose stack traces or internal details. */
export function sanitizeProcessingError(): { ok: false; error: 'processing_failed' } {
  return { ok: false, error: 'processing_failed' };
}
