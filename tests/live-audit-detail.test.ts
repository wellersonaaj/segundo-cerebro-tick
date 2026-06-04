import { describe, expect, it } from 'vitest';
import { auditEntityPrecisionV14 } from '../src/calibration/extractor-v1.4/live-audit-detail.js';
import { matchesMustNotEntityMention } from '../src/calibration/extractor-v1.4/entity-mention-match.js';
import { MemoryCompilerV2Service } from '../src/services/memory-compiler-v2.service.js';
import type { ExtractorOutputV14 } from '../src/openai/extractor-v1.4.types.js';

describe('live-audit-detail entity precision', () => {
  it('Zeta-1 does not match must_not Zeta with corrected matcher', () => {
    expect(matchesMustNotEntityMention('Zeta-1', 'Zeta')).toBe(false);
    expect(matchesMustNotEntityMention('Zeta', 'Zeta')).toBe(true);
    expect(matchesMustNotEntityMention('Gabriel Nova', 'Zeta')).toBe(false);
  });

  it('alias-first contract yields precision N/A', () => {
    const output: ExtractorOutputV14 = {
      schema_version: '1.4',
      entity_mentions: [
        {
          mention_text: 'Zeta-1',
          suggested_entity_type: 'other',
          source_excerpt: 'x',
          confidence: 0.9,
        },
        {
          mention_text: 'Gabriel Nova',
          suggested_entity_type: 'person',
          source_excerpt: 'x',
          confidence: 0.9,
        },
      ],
      aliases: [
        {
          alias: 'Zeta-1',
          target_reference: 'Gabriel Nova',
          negated_former_references: ['Helcio Zeta'],
          source_excerpt: 'x',
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
    };
    const compiled = new MemoryCompilerV2Service().compile({
      extractorOutput: output,
      effectiveInput: '[SOURCE_BLOCK:raw]\nx',
      resolverResult: { references: [], byReferenceText: new Map() },
    });
    const detail = auditEntityPrecisionV14(
      {
        must_have: { alias_targets: ['Gabriel Nova'] },
        must_not_have: { entity_mentions: ['Zeta'] },
        decision: 'accepted',
      },
      output,
      compiled,
      'alias_negation',
    );
    expect(detail.applicable).toBe(false);
    expect(detail.precision).toBeNull();
  });
});
