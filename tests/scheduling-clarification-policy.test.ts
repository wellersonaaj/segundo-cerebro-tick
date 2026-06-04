import { describe, expect, it } from 'vitest';
import type { ExtractorOutputV14 } from '../src/openai/extractor-v1.4.types.js';
import { MemoryCompilerV2Service } from '../src/services/memory-compiler-v2.service.js';
import {
  hasAwaitAvailabilityWithOpenScheduling,
  isVagueDueWindow,
  shouldSuppressSchedulingClarification,
} from '../src/services/scheduling-clarification-policy.js';
import { isTelegramPromptableClarification } from '../src/telegram/telegram-metadata.js';
import type { ClarificationRequest } from '../src/types/domain.js';

const EXCERPT =
  'Mandei mensagem para o Breno sugerindo que eu e o Brant almocemos com ele sábado ou domingo. Ele vai avaliar a disponibilidade.';

function lunchOutput(): ExtractorOutputV14 {
  return {
    schema_version: '1.4',
    events: [],
    aliases: [],
    assertions: [],
    review_hints: [],
    extraction_notes: [],
    correction_signals: [],
    entity_mentions: [],
    task_signals: [
      {
        title: 'Aguardar confirmação de disponibilidade do Breno para almoço no fim de semana',
        due_at: 'sábado ou domingo',
        operation: 'create',
        task_kind: 'follow_up',
        confidence: 0.7,
        status_signal: 'open',
        blocked_reason: null,
        source_excerpt: EXCERPT,
        task_reference: null,
        target_reference: 'Breno',
        project_reference: null,
        assignee_reference: 'eu',
        source_block_reference: '[SOURCE_BLOCK:raw]',
      },
    ],
    clarification_candidates: [
      {
        target_type: 'task',
        target_reference: 'almoço',
        issue_type: 'ambiguous_date',
        question:
          'Qual dia (sábado ou domingo) e que horário devemos propor/confirmar para o almoço?',
        reason: 'janela vaga',
        priority: 'medium',
        blocking_scope: 'none',
        suggested_answers: ['Sábado (manhã/tarde)', 'Domingo (manhã/tarde)'],
        source_excerpt: EXCERPT,
        source_block_reference: '[SOURCE_BLOCK:raw]',
        confidence: 0.7,
      },
    ],
  };
}

describe('scheduling-clarification-policy', () => {
  it('detects vague due window and await-availability context', () => {
    const output = lunchOutput();
    expect(isVagueDueWindow('sábado ou domingo')).toBe(true);
    expect(hasAwaitAvailabilityWithOpenScheduling(output)).toBe(true);
    expect(
      shouldSuppressSchedulingClarification(output, output.clarification_candidates[0]!),
    ).toBe(true);
  });

  it('compiler drops scheduling clarification for lunch scenario', () => {
    const compiler = new MemoryCompilerV2Service();
    const compiled = compiler.compile({
      extractorOutput: lunchOutput(),
      effectiveInput: `[SOURCE_BLOCK:raw]\n${EXCERPT}`,
      resolverResult: { references: [], byReferenceText: new Map() },
      fullIngestionContext: {
        sourceMetadata: { routing: { thread_reference: 'telegram:chat:1' } },
        tasks: [],
        projects: [],
        entities: [],
      },
      compactIngestionContext: { tasks: [], projects: [] },
      taskSignalResolutions: [],
    });

    expect(compiled.clarificationCandidates).toHaveLength(0);
    expect(
      compiled.compilerNotes.some((n) => n.startsWith('scheduling_clarification_suppressed')),
    ).toBe(true);
  });

  it('isTelegramPromptableClarification rejects scheduling noise with blocking_scope none', () => {
    const c = {
      id: '1',
      status: 'pending',
      issue_type: 'ambiguous_date',
      blocking_scope: 'none',
      question: 'Qual dia (sábado ou domingo) e que horário?',
      reason: 'x',
      target_reference: 'almoço',
    } as ClarificationRequest;
    expect(isTelegramPromptableClarification(c)).toBe(false);
  });
});
