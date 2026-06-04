import { createHash } from 'node:crypto';
import type { ExtractorOutput } from '../../types/domain.js';
import type { CalibrationCase } from './types.js';

export type LiveDivergenceClass =
  | 'A_compiler_deterministic'
  | 'B_fixture_incomplete'
  | 'C_schema_signal_gap'
  | 'D_extractor_prompt'
  | 'E_legitimate_ambiguity'
  | 'F_taxonomy_error';

export interface LiveCaptureRecord {
  scenario_id: string;
  base_scenario_id: string;
  category: string;
  fixture_origin: 'captured';
  extractor_version: string;
  schema_version: string;
  prompt_version: string;
  model_name: string;
  captured_at: string;
  raw_content: string;
  source_channel: string;
  source_mode: 'conversational' | 'passive';
  received_at: string;
  timezone: string;
  extractor_output: ExtractorOutput;
  expected: CalibrationCase['expected'];
  repetition_index: number;
  output_shape_hash: string;
}

export interface LiveVariation {
  base_scenario_id: string;
  category: string;
  source_channel: string;
  source_mode: 'conversational' | 'passive';
  buildRawContent: (rep: number) => string;
  expected: CalibrationCase['expected'];
}

/** Synthetic/anonymized variations — no personal bootstrap content. */
export const LIVE_VARIATIONS: LiveVariation[] = [
  {
    base_scenario_id: 'syn-bootstrap-panorama',
    category: 'bootstrap_panorama',
    source_channel: 'bootstrap',
    source_mode: 'passive',
    buildRawContent: (rep) =>
      `Panorama v${rep}: Alex Costa (Ace), Dana Silva (Dee), Chris Oliveira (Cri).`,
    expected: {
      must_have: { entities: ['Alex Costa', 'Dana Silva', 'Chris Oliveira'] },
      must_not_have: { entities: ['Ace', 'Dee', 'financeiro', 'engenharia'], events: ['document_snapshot'] },
    },
  },
  {
    base_scenario_id: 'syn-static-preferences',
    category: 'static_preferences',
    source_channel: 'bootstrap',
    source_mode: 'passive',
    buildRawContent: (rep) =>
      `Alex prefere reuniões pela manhã (var ${rep}). Dana cuida do financeiro. Chris lidera engenharia.`,
    expected: {
      must_not_have: { events: ['conversation', 'document_snapshot'] },
      allowed: { entities: ['Alex Costa'] },
    },
  },
  {
    base_scenario_id: 'syn-episodic-meeting',
    category: 'episodic_meeting',
    source_channel: 'calibration-live',
    source_mode: 'conversational',
    buildRawContent: (rep) =>
      `Chris participou da reunião sobre integração do módulo ${rep}.`,
    expected: {
      must_have: { entities: ['Chris Oliveira'], events: ['meeting'] },
      must_not_have: { entities: ['integração'] },
    },
  },
  {
    base_scenario_id: 'syn-episodic-confirmation',
    category: 'episodic_confirmation',
    source_channel: 'calibration-live',
    source_mode: 'conversational',
    buildRawContent: (rep) => `Dana confirmou o envio do contrato ${rep} ontem.`,
    expected: {
      must_have: { events: ['confirmation'] },
      allowed: { entities: ['Dana Silva'] },
    },
  },
  {
    base_scenario_id: 'syn-alias-negation-shell',
    category: 'alias_negation',
    source_channel: 'calibration-live',
    source_mode: 'conversational',
    buildRawContent: (rep) =>
      `O apelido Zeta-${rep} agora se refere a Gabriel Nova, não mais a Helcio Zeta.`,
    expected: {
      must_have: { alias_targets: ['Gabriel Nova'] },
      must_not_have: { entities: ['Zeta'] },
      forbidden_outputs: [{ type: 'clarification', match: 'Helcio' }],
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
      must_not_have: { entities: ['Fox'] },
      allowed: { entities: ['Pat Lee'] },
    },
  },
  {
    base_scenario_id: 'syn-correction-participant',
    category: 'correction_participant',
    source_channel: 'calibration-live',
    source_mode: 'conversational',
    buildRawContent: (rep) =>
      `Chris participou da reunião ${rep}.\n\n[CORREÇÃO] Na verdade, Bruno Vega participou da reunião.`,
    expected: {
      must_have: { entities: ['Bruno Vega'], events: ['meeting'] },
      allowed: { entities: ['Chris Oliveira'] },
      must_not_have: { event_descriptions: ['Chris participou'] },
    },
  },
  {
    base_scenario_id: 'syn-correction-sender',
    category: 'correction_document_sender',
    source_channel: 'calibration-live',
    source_mode: 'conversational',
    buildRawContent: (rep) =>
      `Chris enviou o relatório ${rep}.\n\n[CORREÇÃO] O relatório foi enviado por Dana Silva, não Chris.`,
    expected: {
      must_have: { entities: ['Dana Silva'] },
      forbidden_outputs: [{ type: 'event', match: 'Chris enviou' }],
    },
  },
];

export function hashExtractorShape(output: ExtractorOutput): string {
  const shape = {
    entities: output.entities.map((e) => ({
      name: e.name,
      type: e.entity_type,
      aliases: [...(e.aliases ?? [])].sort(),
    })),
    events: output.events.map((e) => ({ type: e.event_type, desc: e.description.slice(0, 80) })),
    assertions: output.assertions.length,
    tasks: output.tasks.map((t) => t.title),
    clarifications: output.clarification_requests.map((c) => c.issue_type),
  };
  return createHash('sha256').update(JSON.stringify(shape), 'utf8').digest('hex').slice(0, 16);
}

export function classifyLiveDivergence(input: {
  category: string;
  evaluationFailures: string[];
  compiledPassed: boolean;
  shapeDiffersFromMedian: boolean;
}): LiveDivergenceClass {
  const blob = input.evaluationFailures.join(' ').toLowerCase();
  if (blob.includes('must_not_have') && blob.includes('fox')) return 'C_schema_signal_gap';
  if (blob.includes('alias') && input.category.includes('alias')) return 'C_schema_signal_gap';
  if (blob.includes('forbidden_outputs')) return 'A_compiler_deterministic';
  if (blob.includes('must_have') && input.compiledPassed === false) return 'B_fixture_incomplete';
  if (input.shapeDiffersFromMedian) return 'D_extractor_prompt';
  if (input.category.includes('ambiguous')) return 'E_legitimate_ambiguity';
  if (blob.includes('event')) return 'F_taxonomy_error';
  return 'D_extractor_prompt';
}

export function buildLiveCaptureRecord(
  variation: LiveVariation,
  rep: number,
  output: ExtractorOutput,
  meta: {
    extractorVersion: string;
    schemaVersion: string;
    promptVersion: string;
    modelName: string;
  },
): LiveCaptureRecord {
  const raw_content = variation.buildRawContent(rep);
  return {
    scenario_id: `live-${variation.category}-r${rep}-${hashExtractorShape(output).slice(0, 8)}`,
    base_scenario_id: variation.base_scenario_id,
    category: variation.category,
    fixture_origin: 'captured',
    extractor_version: meta.extractorVersion,
    schema_version: meta.schemaVersion,
    prompt_version: meta.promptVersion,
    model_name: meta.modelName,
    captured_at: new Date().toISOString(),
    raw_content,
    source_channel: variation.source_channel,
    source_mode: variation.source_mode,
    received_at: '2026-06-01T12:00:00-03:00',
    timezone: 'America/Sao_Paulo',
    extractor_output: output,
    expected: variation.expected,
    repetition_index: rep,
    output_shape_hash: hashExtractorShape(output),
  };
}

export function filterVariationsByCategories(categories: string[]): LiveVariation[] {
  if (categories.length === 0) return LIVE_VARIATIONS;
  const set = new Set(categories.map((c) => c.trim()));
  return LIVE_VARIATIONS.filter((v) => set.has(v.category));
}
