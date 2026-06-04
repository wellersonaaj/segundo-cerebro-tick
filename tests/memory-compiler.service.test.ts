import { describe, expect, it } from 'vitest';
import { MemoryCompilerService } from '../src/services/memory-compiler.service.js';
import type { ExtractorOutput } from '../src/types/domain.js';

const emptyMap = { byExtractedName: new Map(), resolutions: [] };

function baseOutput(overrides: Partial<ExtractorOutput> = {}): ExtractorOutput {
  return {
    schema_version: '1.3',
    inbox_item_id: '00000000-0000-4000-8000-000000000001',
    events: [],
    entities: [],
    assertions: [],
    tasks: [],
    clarification_requests: [],
    requires_review: false,
    review_reasons: [],
    processing_notes: [],
    ...overrides,
  };
}

describe('MemoryCompilerService', () => {
  const compiler = new MemoryCompilerService();

  it('drops panorama events for bootstrap static content', () => {
    const raw =
      'Panorama: Alex Costa (Ace), Dana Silva (Dee). Alex prefere reuniões pela manhã.';
    const compiled = compiler.compile({
      rawContent: raw,
      sourceChannel: 'bootstrap',
      sourceMode: 'passive',
      extractorOutput: baseOutput({
        entities: [
          { name: 'Alex Costa', entity_type: 'person', source_excerpt: raw, confidence: 0.9, aliases: ['Ace'] },
          { name: 'financeiro', entity_type: 'topic', source_excerpt: raw, confidence: 0.5, aliases: [] },
        ],
        events: [
          {
            event_type: 'document_snapshot',
            description: 'panorama',
            occurred_at: null,
            source_excerpt: raw,
            confidence: 0.8,
            entity_names: [],
          },
        ],
      }),
      resolvedMap: emptyMap,
    });
    expect(compiled.events).toHaveLength(0);
    expect(compiled.entities.some((e) => e.name === 'financeiro')).toBe(false);
  });

  it('maps explicit alias without separate entity', () => {
    const raw = 'Ace é alias de Alex Costa.';
    const compiled = compiler.compile({
      rawContent: raw,
      sourceChannel: 'test',
      sourceMode: 'conversational',
      extractorOutput: baseOutput({
        entities: [
          { name: 'Ace', entity_type: 'person', source_excerpt: raw, confidence: 0.9, aliases: [] },
          { name: 'Alex Costa', entity_type: 'person', source_excerpt: raw, confidence: 0.9, aliases: ['Ace'] },
        ],
      }),
      resolvedMap: emptyMap,
    });
    expect(compiled.entities.some((e) => e.name === 'Ace')).toBe(false);
    expect(compiled.aliases.some((a) => a.alias === 'Ace')).toBe(true);
  });

  it('applies participant correction to events', () => {
    const raw =
      'Chris participou da reunião.\n\n[CORREÇÃO] Na verdade, Bruno Vega participou da reunião.';
    const compiled = compiler.compile({
      rawContent: raw,
      sourceChannel: 'test',
      sourceMode: 'conversational',
      extractorOutput: baseOutput({
        entities: [
          { name: 'Chris Oliveira', entity_type: 'person', source_excerpt: raw, confidence: 0.9, aliases: [] },
          { name: 'Bruno Vega', entity_type: 'person', source_excerpt: raw, confidence: 0.9, aliases: [] },
        ],
        events: [
          {
            event_type: 'meeting',
            description: 'Chris participou da reunião',
            occurred_at: null,
            source_excerpt: raw,
            confidence: 0.9,
            entity_names: ['Chris'],
          },
        ],
      }),
      resolvedMap: emptyMap,
    });
    expect(compiled.events.some((e) => e.description.includes('Bruno'))).toBe(true);
    expect(compiled.events.some((e) => e.description.includes('Chris participou'))).toBe(false);
  });
});
