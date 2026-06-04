import type { ClarificationRequest } from '../types/domain.js';

const MAX_OPTIONS = 5;
const MAX_OPTION_CHARS = 180;

function truncate(text: string, max: number): string {
  const t = text.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

export function formatClarificationPrompt(clarification: ClarificationRequest): string {
  const label = clarification.target_reference.trim() || 'confirmação';
  const lines = [`Confirmação (${label}):`, clarification.question.trim(), ''];

  const options = (clarification.suggested_answers ?? []).slice(0, MAX_OPTIONS);
  if (options.length) {
    options.forEach((opt, i) => {
      lines.push(`${i + 1}. ${truncate(opt, MAX_OPTION_CHARS)}`);
    });
    lines.push('');
    lines.push('Responda com o número ou texto livre.');
  } else {
    lines.push('Responda com texto livre.');
  }

  lines.push('Para nova captura enquanto houver pergunta pendente, comece com: nova:');
  return lines.join('\n');
}
