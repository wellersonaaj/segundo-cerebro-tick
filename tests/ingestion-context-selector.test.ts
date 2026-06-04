import { describe, expect, it } from 'vitest';
import { IngestionContextSelectorService } from '../src/services/ingestion-context-selector.service.js';
import { TaskContextResolverService } from '../src/services/task-context-resolver.service.js';
import type { IngestionContext } from '../src/types/ingestion-context.js';
import type { ExtractorOutputV14 } from '../src/openai/extractor-v1.4.types.js';

describe('IngestionContextSelector vs full resolver', () => {
  it('truncation does not reduce candidateCountBeforeTruncation used for resolution', () => {
    const full: IngestionContext = {
      activeProjects: [],
      openTasks: [
        {
          id: 'a',
          reference: 'Revisar contrato fornecedor A',
          normalizedReference: 'revisar contrato fornecedor a',
          threadReferences: ['thread-reviews'],
        },
        {
          id: 'b',
          reference: 'Revisar contrato fornecedor B',
          normalizedReference: 'revisar contrato fornecedor b',
          threadReferences: ['thread-reviews'],
        },
      ],
      activeAliases: [],
      recentEntities: [],
      recentAssertions: [],
      recentEvents: [],
      sourceMetadata: { entityLike: {}, routing: {} },
    };

    const output: ExtractorOutputV14 = {
      schema_version: '1.4',
      entity_mentions: [],
      aliases: [],
      events: [],
      correction_signals: [],
      assertions: [],
      task_signals: [
        {
          operation: 'update_due_date',
          task_reference: 'revisão',
          title: null,
          task_kind: null,
          status_signal: null,
          assignee_reference: null,
          target_reference: null,
          project_reference: null,
          due_at: 'sexta',
          blocked_reason: null,
          source_excerpt: 'x',
          source_block_reference: null,
          confidence: 0.9,
        },
      ],
      clarification_candidates: [],
      review_hints: [],
      extraction_notes: [],
    };

    const resolver = new TaskContextResolverService();
    const resolutions = resolver.resolveTaskSignals(output.task_signals, full);
    expect(resolutions[0]?.outcome.candidateCountBeforeTruncation).toBe(2);
    expect(resolutions[0]?.outcome.status).toBe('ambiguous');

    const compact = new IngestionContextSelectorService().selectCompact(
      full,
      output,
      'revisão prazo',
    );
    expect(compact.openTasks.length).toBeLessThanOrEqual(full.openTasks.length);
    expect(resolutions[0]?.outcome.status).toBe('ambiguous');
  });
});
