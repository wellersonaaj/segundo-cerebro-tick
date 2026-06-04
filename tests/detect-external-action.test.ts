import { describe, expect, it } from 'vitest';
import { parseExtractorOutputV14 } from '../src/openai/extractor-v1.4.types.js';
import { detectExternalActionSignals } from '../src/calibration/external-action-s31/detect-external-action.js';

describe('detectExternalActionSignals', () => {
  it('detecta clarification missing_external_action_target', () => {
    const output = parseExtractorOutputV14({
      schema_version: '1.4',
      entity_mentions: [],
      aliases: [],
      events: [],
      correction_signals: [],
      assertions: [],
      task_signals: [],
      clarification_candidates: [
        {
          target_type: 'external_action',
          target_reference: 'enviar contrato',
          issue_type: 'missing_external_action_target',
          question: 'Para quem enviar?',
          reason: 'sem destinatário',
          priority: 'high',
          blocking_scope: 'external_action',
          suggested_answers: [],
          source_excerpt: 'Envie o contrato',
          source_block_reference: null,
          confidence: 0.9,
        },
      ],
      review_hints: [],
      extraction_notes: [],
    });
    const r = detectExternalActionSignals(output);
    expect(r.detected).toBe(true);
    expect(r.outcome).toBe('detected_clarification');
  });

  it('marca ambiguous quando só task create imperativa', () => {
    const output = parseExtractorOutputV14({
      schema_version: '1.4',
      entity_mentions: [],
      aliases: [],
      events: [],
      correction_signals: [],
      assertions: [],
      task_signals: [
        {
          operation: 'create',
          title: 'Enviar o contrato para o cliente',
          task_kind: 'follow_up',
          status_signal: 'open',
          assignee_reference: null,
          target_reference: null,
          project_reference: null,
          due_at: 'amanhã',
          blocked_reason: null,
          source_excerpt: 'Envie o contrato para o cliente amanhã.',
          source_block_reference: null,
          confidence: 0.9,
          task_reference: null,
        },
      ],
      clarification_candidates: [],
      review_hints: [],
      extraction_notes: [],
    });
    const r = detectExternalActionSignals(output);
    expect(r.detected).toBe(false);
    expect(r.outcome).toBe('ambiguous_task_only');
  });
});
