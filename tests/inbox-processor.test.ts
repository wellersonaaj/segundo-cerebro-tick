import { describe, expect, it } from 'vitest';
import { extractorOutputSchema } from '../src/openai/extractor.types.js';
import { resolveDueAt } from '../src/utils/temporal.js';
import cases from './fixtures/inbox-cases.json' with { type: 'json' };

describe('Extractor fixtures validation', () => {
  for (const c of cases as Array<{ scenario_id: string; mock_output: unknown }>) {
    it(`validates schema for ${c.scenario_id}`, () => {
      const parsed = extractorOutputSchema.safeParse(c.mock_output);
      expect(parsed.success).toBe(true);
    });
  }
});

describe('Temporal resolution', () => {
  it('resolves amanhã from received_at', () => {
    const due = resolveDueAt('amanhã', null, '2026-05-31T10:00:00-03:00', 'America/Sao_Paulo');
    expect(due).toBe('2026-06-01');
  });
});

describe('Scenario expectations', () => {
  it('case-01: occurred_at is null', () => {
    const c = (cases as Array<{ scenario_id: string; mock_output: { events: Array<{ occurred_at: null }> } }>).find(
      (x) => x.scenario_id === 'case-01-past-event-no-date',
    )!;
    expect(c.mock_output.events[0]?.occurred_at).toBeNull();
  });

  it('case-03: hypothesis assertion', () => {
    const c = (cases as Array<{ scenario_id: string; mock_output: { assertions: Array<{ assertion_type: string }> } }>).find(
      (x) => x.scenario_id === 'case-03-hypothesis',
    )!;
    expect(c.mock_output.assertions[0]?.assertion_type).toBe('hypothesis');
    expect(
      (c as unknown as { mock_output: { clarification_requests: unknown[] } }).mock_output.clarification_requests,
    ).toHaveLength(0);
  });

  it('case-05: missing fornecedor clarification', () => {
    const c = (cases as Array<{ scenario_id: string; mock_output: { clarification_requests: Array<{ question: string }> } }>).find(
      (x) => x.scenario_id === 'case-02-explicit-tomorrow',
    )!;
    expect(c.mock_output.clarification_requests[0]?.question).toContain('fornecedor');
  });

  it('case-06: external action high priority', () => {
    const c = (cases as Array<{ scenario_id: string; mock_output: { clarification_requests: Array<{ priority: string; blocking_scope: string }> } }>).find(
      (x) => x.scenario_id === 'case-06-external-action',
    )!;
    expect(c.mock_output.clarification_requests[0]?.priority).toBe('high');
    expect(c.mock_output.clarification_requests[0]?.blocking_scope).toBe('external_action');
  });

  it('case-08 vs case-09: commitment flag', () => {
    const c8 = (cases as Array<{ scenario_id: string; mock_output: { tasks: Array<{ is_commitment: boolean }> } }>).find(
      (x) => x.scenario_id === 'case-08-commitment',
    )!;
    const c9 = (cases as Array<{ scenario_id: string; mock_output: { tasks: Array<{ is_commitment: boolean }> } }>).find(
      (x) => x.scenario_id === 'case-09-task-no-commitment',
    )!;
    expect(c8.mock_output.tasks[0]?.is_commitment).toBe(true);
    expect(c9.mock_output.tasks[0]?.is_commitment).toBe(false);
  });
});
