import type { ExtractFn } from '../../src/openai/extractor.service.js';
import type { ExtractorOutput } from '../../src/types/domain.js';
import cases from '../fixtures/inbox-cases.json' with { type: 'json' };

const byScenario = new Map(
  (cases as Array<{ scenario_id: string; mock_output: ExtractorOutput }>).map((c) => [
    c.scenario_id,
    c.mock_output,
  ]),
);

export function createMockExtractor(scenarioId?: string): ExtractFn {
  return async (params) => {
    for (const c of cases as Array<{ raw_content: string; mock_output: ExtractorOutput }>) {
      if (params.raw_content.includes(c.raw_content.slice(0, 30).replace(/\.\.\.$/, ''))) {
        return { ...c.mock_output, inbox_item_id: params.inbox_item_id };
      }
    }

    if (scenarioId && byScenario.has(scenarioId)) {
      const out = byScenario.get(scenarioId)!;
      return { ...out, inbox_item_id: params.inbox_item_id };
    }

    return {
      schema_version: '1.3',
      inbox_item_id: params.inbox_item_id,
      events: [],
      entities: [],
      assertions: [],
      tasks: [],
      clarification_requests: [],
      requires_review: false,
      review_reasons: [],
      processing_notes: [],
    };
  };
}

export function createScenarioExtractor(scenarioId: string): ExtractFn {
  return async (params) => {
    const out = byScenario.get(scenarioId);
    if (!out) throw new Error(`Unknown scenario: ${scenarioId}`);
    return { ...out, inbox_item_id: params.inbox_item_id };
  };
}
