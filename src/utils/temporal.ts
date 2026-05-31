/** Resolve relative temporal references using received_at and timezone. */
export function resolveDueAt(
  temporalReference: string | null | undefined,
  dueAtFromExtractor: string | null | undefined,
  receivedAtIso: string,
  timezone: string,
): string | null {
  if (dueAtFromExtractor) {
    return dueAtFromExtractor.includes('T')
      ? dueAtFromExtractor
      : `${dueAtFromExtractor}T12:00:00`;
  }
  if (!temporalReference) return null;

  const ref = temporalReference.toLowerCase().trim();
  const received = new Date(receivedAtIso);

  const addDays = (days: number): string => {
    const d = new Date(received);
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
  };

  if (ref === 'hoje' || ref === 'today') return addDays(0).slice(0, 10);
  if (ref === 'ontem' || ref === 'yesterday') return addDays(-1).slice(0, 10);
  if (ref === 'amanhã' || ref === 'amanha' || ref === 'tomorrow') return addDays(1).slice(0, 10);

  void timezone;
  return null;
}
