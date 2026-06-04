import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  isAllowedSourceBlockReference,
  SOURCE_BLOCK_RAW,
} from '../src/openai/source-block-reference.js';
import {
  parseExtractorOutputV14,
  rejectLegacyExtractorRootFields,
  CLARIFICATION_ISSUE_TYPES,
} from '../src/openai/extractor-v1.4.types.js';
import { EXTRACTOR_V14_SCHEMA_VERSION } from '../src/openai/extractor-v1.4.prompt.js';
import { extractorV14JsonSchema } from '../src/openai/extractor-v1.4.schema.js';
import { EXTRACTOR_V14_SYSTEM_PROMPT } from '../src/openai/extractor-v1.4.prompt.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const validFixture = JSON.parse(
  readFileSync(join(root, 'tests/fixtures/extractor-v1.4-valid-minimal.json'), 'utf8'),
) as unknown;

describe('extractor-v1.4 parse', () => {
  it('parses valid minimal fixture', () => {
    const out = parseExtractorOutputV14(validFixture);
    expect(out.schema_version).toBe('1.4');
    expect(out.aliases[0]?.target_reference).toBe('Alex Costa');
    expect(out.events[0]?.event_kind).toBe('meeting');
    expect(out.task_signals[0]?.project_reference).toBe('Projeto Atlas');
    expect(out.task_signals[0]?.operation).toBe('update_blocker');
    expect(out.review_hints[0]?.issue_type).toBe('ambiguous_entity_type');
  });

  it('rejects inbox_item_id', () => {
    expect(() =>
      rejectLegacyExtractorRootFields({
        schema_version: '1.4',
        inbox_item_id: '00000000-0000-4000-8000-000000000001',
      }),
    ).toThrow(/inbox_item_id/);
  });

  it('rejects legacy root tasks', () => {
    expect(() =>
      rejectLegacyExtractorRootFields({
        schema_version: '1.4',
        tasks: [],
      }),
    ).toThrow(/tasks/);
  });

  it('rejects entities and event_type', () => {
    expect(() =>
      rejectLegacyExtractorRootFields({
        schema_version: '1.4',
        entities: [],
      }),
    ).toThrow(/entities/);
    expect(() =>
      rejectLegacyExtractorRootFields({
        schema_version: '1.4',
        events: [{ event_type: 'meeting' }],
      }),
    ).toThrow(/event_type/);
  });

  it('rejects requires_review and review_reasons', () => {
    expect(() =>
      rejectLegacyExtractorRootFields({ requires_review: true }),
    ).toThrow(/requires_review/);
    expect(() =>
      rejectLegacyExtractorRootFields({ review_reasons: ['x'] }),
    ).toThrow(/review_reasons/);
  });

  it('accepts empty events for static panorama', () => {
    const out = parseExtractorOutputV14({
      schema_version: '1.4',
      entity_mentions: [
        {
          mention_text: 'Alex Costa',
          suggested_entity_type: 'person',
          source_excerpt: 'Alex Costa',
          confidence: 0.9,
        },
      ],
      aliases: [],
      events: [],
      correction_signals: [],
      assertions: [],
      task_signals: [],
      clarification_candidates: [],
      review_hints: [],
      extraction_notes: [],
    });
    expect(out.events).toEqual([]);
  });

  it('validates negated_former_references on alias', () => {
    const out = parseExtractorOutputV14({
      schema_version: '1.4',
      entity_mentions: [],
      aliases: [
        {
          alias: 'Zeta-1',
          target_reference: 'Gabriel Nova',
          negated_former_references: ['Helcio Zeta'],
          source_excerpt: 'Zeta-1 agora é Gabriel',
          confidence: 0.9,
        },
      ],
      events: [],
      correction_signals: [],
      assertions: [],
      task_signals: [],
      clarification_candidates: [],
      review_hints: [],
      extraction_notes: [],
    });
    expect(out.aliases[0]?.negated_former_references).toContain('Helcio Zeta');
  });

  it('validates related_entities on events', () => {
    const out = parseExtractorOutputV14(validFixture);
    expect(out.events[0]?.related_entities[0]?.relation_type).toBe('participant');
  });

  it('validates correction_signals', () => {
    const out = parseExtractorOutputV14(validFixture);
    expect(out.correction_signals[0]?.correction_type).toBe('replace_subject');
    expect(out.correction_signals[0]?.source_block_reference).toContain('SOURCE_BLOCK');
  });

  it('validates task_signals by operation', () => {
    expect(() =>
      parseExtractorOutputV14({
        ...JSON.parse(JSON.stringify(validFixture)),
        task_signals: [
          {
            operation: 'update_due_date',
            task_reference: 'QA',
            title: null,
            task_kind: null,
            status_signal: null,
            assignee_reference: null,
            target_reference: null,
            project_reference: null,
            due_at: null,
            blocked_reason: null,
            source_excerpt: 'x',
            source_block_reference: null,
            confidence: 0.5,
          },
        ],
      }),
    ).toThrow(/due_at/);
  });

  it('rejects invalid source_block_reference', () => {
    expect(() =>
      parseExtractorOutputV14({
        ...JSON.parse(JSON.stringify(validFixture)),
        task_signals: [
          {
            operation: 'create',
            task_reference: null,
            title: 'T',
            task_kind: 'follow_up',
            status_signal: 'open',
            assignee_reference: null,
            target_reference: null,
            project_reference: null,
            due_at: null,
            blocked_reason: null,
            source_excerpt: 'T',
            source_block_reference: 'parágrafo 3',
            confidence: 0.5,
          },
        ],
      }),
    ).toThrow(/source_block_reference/);
  });
});

describe('SOURCE_BLOCK reference', () => {
  it('allows raw and correction uuid blocks', () => {
    expect(isAllowedSourceBlockReference(null)).toBe(true);
    expect(isAllowedSourceBlockReference(SOURCE_BLOCK_RAW)).toBe(true);
    expect(
      isAllowedSourceBlockReference(
        '[SOURCE_BLOCK:correction:00000000-0000-4000-8000-000000000001]',
      ),
    ).toBe(true);
    expect(isAllowedSourceBlockReference('trecho acima')).toBe(false);
  });
});

describe('extractor-v1.4 schema metadata', () => {
  it('requires schema_version 1.4 only at root', () => {
    expect(extractorV14JsonSchema.properties.schema_version.enum).toEqual(['1.4']);
    expect(extractorV14JsonSchema.required).not.toContain('inbox_item_id');
    expect(extractorV14JsonSchema.required).toContain('entity_mentions');
    expect(extractorV14JsonSchema.required).toContain('aliases');
    expect(extractorV14JsonSchema.required).toContain('task_signals');
  });

  it('exports prompt schema version constant', () => {
    expect(EXTRACTOR_V14_SCHEMA_VERSION).toBe('1.4');
  });

  it('uses canonical clarification issue_type enum in json schema', () => {
    const enumValues =
      extractorV14JsonSchema.properties.clarification_candidates.items.properties.issue_type
        .enum;
    expect(enumValues).toEqual([...CLARIFICATION_ISSUE_TYPES]);
  });
});

describe('extractor-v1.4 canonical clarification issue_type', () => {
  const emptyV14 = () => ({
    schema_version: '1.4' as const,
    entity_mentions: [],
    aliases: [],
    events: [],
    correction_signals: [],
    assertions: [],
    task_signals: [],
    clarification_candidates: [] as unknown[],
    review_hints: [],
    extraction_notes: [],
  });

  it('rejects non-canonical issue_type missing_assignment_and_deadline', () => {
    expect(() =>
      parseExtractorOutputV14({
        ...emptyV14(),
        clarification_candidates: [
          {
            target_type: 'task',
            target_reference: 'Revisar contrato',
            issue_type: 'missing_assignment_and_deadline',
            question: 'Quem e quando?',
            reason: 'sem responsável e prazo',
            priority: 'high',
            blocking_scope: 'task_execution',
            suggested_answers: [],
            source_excerpt: 'x',
            source_block_reference: null,
            confidence: 0.8,
          },
        ],
      }),
    ).toThrow();
  });

  it('accepts canonical missing_assignee_or_due_date', () => {
    const out = parseExtractorOutputV14({
      ...emptyV14(),
      clarification_candidates: [
        {
          target_type: 'task',
          target_reference: 'Revisar contrato',
          issue_type: 'missing_assignee_or_due_date',
          question: 'Responsável e prazo?',
          reason: 'incompleto',
          priority: 'high',
          blocking_scope: 'task_execution',
          suggested_answers: [],
          source_excerpt: 'x',
          source_block_reference: null,
          confidence: 0.8,
        },
      ],
    });
    expect(out.clarification_candidates[0]?.issue_type).toBe('missing_assignee_or_due_date');
  });

  it('accepts issue_type other', () => {
    const out = parseExtractorOutputV14({
      ...emptyV14(),
      clarification_candidates: [
        {
          target_type: 'task',
          target_reference: 'Tarefa X',
          issue_type: 'other',
          question: 'Detalhe?',
          reason: 'nuance não coberta pelo enum',
          priority: 'medium',
          blocking_scope: 'task_execution',
          suggested_answers: [],
          source_excerpt: 'x',
          source_block_reference: null,
          confidence: 0.5,
        },
      ],
    });
    expect(out.clarification_candidates[0]?.issue_type).toBe('other');
  });

  it('documents canonical issue_type usage in prompt', () => {
    expect(EXTRACTOR_V14_SYSTEM_PROMPT).toMatch(/issue_type canônicos/i);
    expect(EXTRACTOR_V14_SYSTEM_PROMPT).toMatch(/missing_assignee_or_due_date/);
    expect(EXTRACTOR_V14_SYSTEM_PROMPT).toMatch(/\bother\b/);
  });

  it('documents status_update contract in prompt', () => {
    expect(EXTRACTOR_V14_SYSTEM_PROMPT).toMatch(/Para status_update, use predicate como dimensão atualizada/);
    expect(EXTRACTOR_V14_SYSTEM_PROMPT).toMatch(
      /predicate = "status", value_text = "em risco"/,
    );
    expect(EXTRACTOR_V14_SYSTEM_PROMPT).toMatch(/Não coloque o novo status dentro de predicate/);
  });
});

describe('extractor-v1.4 dataset cases', () => {
  it('loads all minimum calibration cases', async () => {
    const { readdirSync } = await import('node:fs');
    const casesDir = join(root, 'data/calibration/extractor-v1.4/cases');
    const files = readdirSync(casesDir).filter((f) => f.endsWith('.json'));
    expect(files.length).toBeGreaterThanOrEqual(17);
    for (const file of files) {
      const c = JSON.parse(readFileSync(join(casesDir, file), 'utf8')) as {
        scenario_id: string;
        raw_content: string;
      };
      expect(c.scenario_id).toBeTruthy();
      expect(c.raw_content.length).toBeGreaterThan(0);
    }
  });
});
