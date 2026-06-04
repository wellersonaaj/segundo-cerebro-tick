const ASSERTION_KIND_LABELS: Record<string, string> = {
  fact: 'Fato',
  hypothesis: 'Hipótese',
  opinion: 'Opinião',
  decision: 'Decisão',
  commitment: 'Compromisso',
  question: 'Pergunta',
  assumption: 'Premissa',
  recommendation: 'Recomendação',
  status_update: 'Status',
  other: 'Outro',
};

export function assertionKindLabel(kind: string): string {
  return ASSERTION_KIND_LABELS[kind] ?? kind;
}
