import type { AuditTaskRow } from '../repositories/task-audit.repository.js';
import type { ClarificationRequest } from '../types/domain.js';
import type { ExternalKnowledgeEnrichmentResult } from '../types/external-knowledge-enrichment.js';
import { formatClarificationPrompt } from '../telegram/format-clarification-prompt.js';
import type { UncertaintyGap } from './uncertainty-aggregator.js';

export interface ComposeFollowUpInput {
  raw_content: string;
  processing_status: 'completed' | 'failed';
  tasks: AuditTaskRow[];
  clarifications: ClarificationRequest[];
  gaps: UncertaintyGap[];
  enrichment?: ExternalKnowledgeEnrichmentResult | null;
  processing_error?: string | null;
}

function truncate(text: string, max: number): string {
  const t = text.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

function formatTaskLine(task: AuditTaskRow): string {
  const parts = [`• ${task.title}`];
  if (task.status && task.status !== 'open') parts.push(`(${task.status})`);
  if (task.due_at) parts.push(`— prazo ${task.due_at.slice(0, 10)}`);
  if (task.target) parts.push(`— ${task.target}`);
  return parts.join(' ');
}

function pickPrimaryClarification(
  clarifications: ClarificationRequest[],
  gaps: UncertaintyGap[],
): ClarificationRequest | null {
  const gapWithId = gaps.find((g) => g.clarification_id);
  if (gapWithId?.clarification_id) {
    return clarifications.find((c) => c.id === gapWithId.clarification_id) ?? null;
  }
  return clarifications.find((c) => c.status === 'pending') ?? null;
}

export function composeAssistantAck(): string {
  return 'Recebi. Estou organizando isso na sua memória…';
}

export function composeClarificationAck(answerPreview: string): string {
  const preview = truncate(answerPreview, 80);
  return `Entendi (${preview}). Vou atualizar sua memória…`;
}

export function composeFollowUpMessage(input: ComposeFollowUpInput): string {
  if (input.processing_status === 'failed') {
    const detail = input.processing_error?.trim();
    return detail
      ? `Não consegui processar completamente: ${truncate(detail, 200)}. A captura foi salva — tente responder ou enviar "nova:" com mais contexto.`
      : 'Não consegui processar completamente, mas a captura foi salva. Tente de novo em instantes ou envie "nova:" com mais contexto.';
  }

  const lines: string[] = [];
  const excerpt = truncate(input.raw_content, 120);
  lines.push(`Organizei sua captura: "${excerpt}"`);

  if (input.tasks.length) {
    lines.push('');
    lines.push('Registrei:');
    for (const task of input.tasks.slice(0, 5)) {
      lines.push(formatTaskLine(task));
    }
    if (input.tasks.length > 5) {
      lines.push(`… e mais ${input.tasks.length - 5} tarefa(s).`);
    }
  }

  const enrichmentFacts = input.enrichment?.facts?.filter((f) => f.confidence >= 0.5) ?? [];
  if (enrichmentFacts.length) {
    lines.push('');
    lines.push('Contexto externo (sugestão):');
    for (const fact of enrichmentFacts.slice(0, 2)) {
      lines.push(`• ${truncate(fact.claim, 160)}`);
    }
  }

  const primary = pickPrimaryClarification(input.clarifications, input.gaps);
  if (primary) {
    lines.push('');
    lines.push(formatClarificationPrompt(primary));
    return lines.join('\n');
  }

  if (input.gaps.length) {
    lines.push('');
    lines.push('Preciso confirmar:');
    for (const gap of input.gaps.slice(0, 2)) {
      lines.push(`• ${gap.question}`);
      if (gap.suggested_answers.length) {
        gap.suggested_answers.slice(0, 3).forEach((opt, i) => {
          lines.push(`  ${i + 1}. ${truncate(opt, 100)}`);
        });
      }
    }
    lines.push('');
    lines.push('Responda com texto livre ou número. Para nova captura: nova:');
    return lines.join('\n');
  }

  // Honesty fallback: extraction ran but produced no tasks, no clarifications,
  // no gaps, no enrichment. The LLM extracted *something* (events, entities,
  // assertions) but nothing actionable surfaced. Tell the user plainly that
  // we saved the raw note and ask for more context if they want structure.
  const isEmpty =
    input.tasks.length === 0 &&
    input.clarifications.length === 0 &&
    input.gaps.length === 0 &&
    enrichmentFacts.length === 0;
  if (isEmpty) {
    lines.push('');
    lines.push('Salvei a nota, mas não estruturei nada além (sem tarefa, sem entity óbvia).');
    lines.push('Manda de novo com mais contexto se quiser tarefa/lembrete (ex: "criar tarefa ligar pra Breno amanhã").');
    return lines.join('\n');
  }

  lines.push('');
  lines.push('Tudo certo por aqui. Se quiser corrigir algo, responda nesta conversa ou envie uma nova mensagem.');
  return lines.join('\n');
}
