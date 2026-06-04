import { createHash } from 'node:crypto';
import type { ExtractorOutputV14 } from '../../openai/extractor-v1.4.types.js';
import type { CalibrationRegime } from '../../types/ingestion-context.js';
import type { V14CalibrationExpectations } from './fixed-calibration-expectations.js';

export interface V14LiveVariation {
  base_scenario_id: string;
  category: string;
  source_channel: string;
  source_mode: 'conversational' | 'passive';
  buildRawContent: (rep: number) => string;
  corrections?: (rep: number) => Array<{ id: string; correction_text: string }>;
  expected: V14CalibrationExpectations;
  regime?: CalibrationRegime;
  ingestion_context_id?: string;
  source_metadata?: {
    thread_reference?: string;
    reply_to_reference?: string;
    subject?: string;
  };
}

export const V14_LIVE_VARIATIONS: V14LiveVariation[] = [
  {
    base_scenario_id: 'syn-bootstrap-panorama',
    category: 'bootstrap_panorama',
    source_channel: 'bootstrap',
    source_mode: 'passive',
    buildRawContent: (rep) =>
      `Panorama v${rep}: Alex Costa (Ace), Dana Silva (Dee), Chris Oliveira (Cri).`,
    expected: {
      must_not_have: { event_kinds: ['meeting', 'confirmation'] },
      decision: 'accepted',
    },
  },
  {
    base_scenario_id: 'syn-static-preferences',
    category: 'static_preferences',
    source_channel: 'bootstrap',
    source_mode: 'passive',
    buildRawContent: (rep) =>
      `Alex prefere reuniões pela manhã (var ${rep}). Dana cuida do financeiro.`,
    expected: {
      must_have: { assertion_kinds: ['opinion'] },
      must_not_have: { event_kinds: ['meeting'] },
      decision: 'accepted',
    },
  },
  {
    base_scenario_id: 'syn-explicit-alias',
    category: 'explicit_alias',
    source_channel: 'calibration-live',
    source_mode: 'conversational',
    buildRawContent: (rep) => `O apelido Tick-${rep} se refere a Alex Costa.`,
    expected: {
      must_have: { alias_targets: ['Alex Costa'] },
      must_not_have: { entity_mentions: ['Tick'] },
      decision: 'accepted',
    },
  },
  {
    base_scenario_id: 'syn-alias-negation',
    category: 'alias_negation',
    source_channel: 'calibration-live',
    source_mode: 'conversational',
    buildRawContent: (rep) =>
      `O apelido Zeta-${rep} agora se refere a Gabriel Nova, não mais a Helcio Zeta.`,
    expected: {
      must_have: { alias_targets: ['Gabriel Nova'] },
      /** Exact match only: blocks literal "Zeta", not "Zeta-1" nor "Helcio Zeta". */
      must_not_have: { entity_mentions: ['Zeta'] },
      decision: 'accepted',
    },
  },
  {
    base_scenario_id: 'syn-alias-reassignment',
    category: 'alias_reassignment',
    source_channel: 'calibration-live',
    source_mode: 'conversational',
    buildRawContent: (rep) =>
      `Codinome Fox-${rep} agora se refere a Pat Lee, não mais a Sam Fox.`,
    expected: {
      must_have: { alias_targets: ['Pat Lee'] },
      /** Exact match only: blocks literal "Fox", not "Fox-3" nor "Sam Fox". */
      must_not_have: { entity_mentions: ['Fox'] },
      decision: 'accepted',
    },
  },
  {
    base_scenario_id: 'syn-episodic-meeting',
    category: 'episodic_meeting',
    source_channel: 'calibration-live',
    source_mode: 'conversational',
    buildRawContent: (rep) =>
      `Chris Oliveira participou da reunião sobre integração ${rep}.`,
    expected: {
      must_have: { event_kinds: ['meeting'] },
      decision: 'accepted',
    },
  },
  {
    base_scenario_id: 'syn-episodic-confirmation',
    category: 'episodic_confirmation',
    source_channel: 'calibration-live',
    source_mode: 'conversational',
    buildRawContent: (rep) => `Dana Silva confirmou o envio do contrato ${rep}.`,
    expected: {
      must_have: { event_kinds: ['confirmation'] },
      decision: 'accepted',
    },
  },
  {
    base_scenario_id: 'syn-correction-participant',
    category: 'correction_participant',
    source_channel: 'calibration-live',
    source_mode: 'conversational',
    buildRawContent: (rep) => `Chris participou da reunião ${rep}.`,
    corrections: () => [
      {
        id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        correction_text: 'Na verdade, Bruno Vega participou da reunião.',
      },
    ],
    expected: {
      must_have: { event_kinds: ['meeting'] },
      decision: 'accepted',
    },
  },
  {
    base_scenario_id: 'syn-correction-sender',
    category: 'correction_document_sender',
    source_channel: 'calibration-live',
    source_mode: 'conversational',
    buildRawContent: (rep) => `Chris enviou o relatório ${rep}.`,
    corrections: () => [
      {
        id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
        correction_text: 'O relatório foi enviado por Dana Silva, não Chris.',
      },
    ],
    expected: {
      must_have: { event_kinds: ['document_sent'] },
      decision: 'accepted',
    },
  },
  {
    base_scenario_id: 'syn-task-open',
    category: 'task_open',
    source_channel: 'calibration-live',
    source_mode: 'conversational',
    buildRawContent: (rep) => `Abrir tarefa: revisar spec ${rep} até sexta.`,
    expected: {
      must_have: { task_operations: ['create'] },
      decision: 'accepted',
    },
  },
  {
    base_scenario_id: 'syn-task-blocked',
    category: 'task_blocked',
    source_channel: 'calibration-live',
    source_mode: 'conversational',
    buildRawContent: (rep) => `Tarefa bloqueada: deploy ${rep} aguardando aprovação.`,
    expected: {
      must_have: { task_operations: ['update_blocker'] },
      decision: 'accepted',
    },
  },
  {
    base_scenario_id: 'syn-task-completed',
    category: 'task_completed',
    source_channel: 'calibration-live',
    source_mode: 'conversational',
    buildRawContent: (rep) => `Concluída a tarefa de migração ${rep}.`,
    expected: {
      must_have: { task_operations: ['complete'] },
      decision: 'accepted',
    },
  },
  {
    base_scenario_id: 'syn-project-status',
    category: 'project_status_update',
    source_channel: 'calibration-live',
    source_mode: 'conversational',
    buildRawContent: (rep) => `Projeto Atlas está em risco na sprint ${rep}.`,
    expected: {
      must_have: { assertion_kinds: ['status_update'] },
      decision: 'accepted',
    },
  },
  {
    base_scenario_id: 'syn-task-due-date',
    category: 'task_due_date_change',
    source_channel: 'calibration-live',
    source_mode: 'conversational',
    buildRawContent: (rep) => `Prazo da tarefa de QA ${rep} mudou para segunda-feira.`,
    expected: {
      must_have: { task_operations: ['update_due_date'] },
      decision: 'accepted',
    },
  },
  {
    base_scenario_id: 'syn-task-assignee',
    category: 'task_assignee_change',
    source_channel: 'calibration-live',
    source_mode: 'conversational',
    buildRawContent: (rep) => `Tarefa ${rep} passou para Dana Silva.`,
    expected: {
      must_have: { task_operations: ['update_assignee'] },
      decision: 'accepted',
    },
  },
  {
    base_scenario_id: 'syn-fc-task',
    category: 'first_contact_task',
    source_channel: 'calibration-live',
    source_mode: 'conversational',
    regime: 'first_contact',
    ingestion_context_id: 'empty',
    buildRawContent: (rep) => `Precisamos revisar o contrato ${rep}.`,
    expected: {
      regime: 'first_contact',
      must_have: { task_operations: ['create'] },
      decision: 'accepted',
    },
  },
  {
    base_scenario_id: 'syn-ctx-due-unique',
    category: 'incremental_due_date_unique',
    source_channel: 'calibration-live',
    source_mode: 'conversational',
    regime: 'incremental_single',
    ingestion_context_id: 'atlas_single_task',
    source_metadata: { thread_reference: 'thread-atlas-1' },
    buildRawContent: (rep) => `O prazo da revisão ${rep} mudou para sexta-feira.`,
    expected: {
      regime: 'incremental_single',
      must_have: { task_operations: ['update_due_date'], context_resolution: 'auto' },
      decision: 'accepted',
    },
  },
  {
    base_scenario_id: 'syn-ctx-due-ambiguous',
    category: 'incremental_due_date_ambiguous',
    source_channel: 'calibration-live',
    source_mode: 'conversational',
    regime: 'incremental_ambiguous',
    ingestion_context_id: 'two_contract_reviews',
    source_metadata: { thread_reference: 'thread-reviews' },
    buildRawContent: (rep) => `O prazo da revisão ${rep} mudou para sexta-feira.`,
    expected: {
      regime: 'incremental_ambiguous',
      must_have: { task_operations: ['update_due_date'], context_resolution: 'ambiguous' },
      min_clarifications: 1,
      decision: 'needs_clarification',
    },
  },
  {
    base_scenario_id: 'syn-ambiguous-identity',
    category: 'ambiguous_identity',
    source_channel: 'calibration-live',
    source_mode: 'conversational',
    buildRawContent: (rep) => `Chris participou da call ${rep} (pode ser Oliveira ou Mendes).`,
    expected: {
      min_clarifications: 1,
      decision: 'needs_clarification',
    },
  },
];

export function filterV14VariationsByCategories(categories: string[]): V14LiveVariation[] {
  if (categories.length === 0) return V14_LIVE_VARIATIONS;
  const set = new Set(categories.map((c) => c.trim()));
  return V14_LIVE_VARIATIONS.filter((v) => set.has(v.category));
}

export function hashV14OutputShape(output: ExtractorOutputV14): string {
  const shape = {
    mentions: output.entity_mentions.map((m) => m.mention_text),
    aliases: output.aliases.map((a) => a.alias),
    events: output.events.map((e) => e.event_kind),
    assertions: output.assertions.length,
    task_signals: (output.task_signals ?? []).map((t) => `${t.operation}:${t.title ?? t.task_reference ?? ''}`),
  };
  return createHash('sha256').update(JSON.stringify(shape), 'utf8').digest('hex').slice(0, 16);
}
