import { describe, expect, it } from 'vitest';
import { sanitizeV14EntityMentions } from '../src/services/extraction-sanitizer-v14.service.js';
import type { ExtractorOutputV14 } from '../src/openai/extractor-v1.4.types.js';

const baseOutput = (overrides: Partial<ExtractorOutputV14> = {}): ExtractorOutputV14 => ({
  schema_version: '1.4',
  entity_mentions: [],
  aliases: [],
  events: [],
  correction_signals: [],
  assertions: [],
  task_signals: [],
  clarification_candidates: [],
  review_hints: [],
  extraction_notes: [],
  ...overrides,
});

function mention(text: string, type: string = 'person'): { mention_text: string; suggested_entity_type: string; source_excerpt: string; confidence: number } {
  return {
    mention_text: text,
    suggested_entity_type: type,
    source_excerpt: text,
    confidence: 0.8,
  };
}

describe('sanitizeV14EntityMentions — anti-hallucination', () => {
  it("user's actual case: 'Preciso falar com alguém do ESX sobre prazo' returns only ESX (or nothing)", () => {
    // The LLM produced 11 mentions for this 1-sentence input. Some of them are
    // pronouns ('alguém'), some are generic nouns ('prazo'), some are invented
    // ('fornecedor', 'cliente'). After sanitization, only real entities survive.
    const output = baseOutput({
      entity_mentions: [
        mention('alguém', 'person'),        // pronoun — drop
        mention('ESX', 'company'),          // in source — keep
        mention('prazo', 'topic'),          // generic noun — drop
        mention('fornecedor', 'person'),    // generic — drop
        mention('cliente', 'person'),       // generic — drop
        mention('reunião', 'event'),        // invented (not in source) — drop
        mention('Wellerson', 'person'),     // not in source — drop
        mention('amanhã', 'temporal'),      // not in source — drop
        mention('urgente', 'topic'),        // not in source — drop
        mention('setor', 'topic'),          // not in source — drop
        mention('projeto', 'project'),      // not in source — drop
      ],
    });
    const rawContent = 'Preciso falar com alguém do ESX sobre prazo';
    const { output: cleaned, droppedMentions } = sanitizeV14EntityMentions(output, rawContent);

    const kept = cleaned.entity_mentions.map((m) => m.mention_text);
    expect(kept).toEqual(['ESX']);
    expect(droppedMentions.length).toBe(10);
    expect(droppedMentions.every((d) => d.reason !== 'too_short')).toBe(true);
  });

  it('drops pronouns (PT-BR)', () => {
    const output = baseOutput({
      entity_mentions: [
        mention('eu', 'person'),
        mention('você', 'person'),
        mention('ele', 'person'),
        mention('ela', 'person'),
        mention('alguém', 'person'),
        mention('ninguém', 'person'),
        mention('isso', 'topic'),
        mention('isto', 'topic'),
        mention('aquilo', 'topic'),
        mention('coisa', 'topic'),
      ],
    });
    const rawContent = 'eu vou falar com você sobre isso mas ninguém sabe coisa nenhuma';
    const { output: cleaned } = sanitizeV14EntityMentions(output, rawContent);
    expect(cleaned.entity_mentions).toEqual([]);
  });

  it('drops hallucinated entities (mention_text not in source)', () => {
    const output = baseOutput({
      entity_mentions: [
        mention('Breno', 'person'),       // not in source — drop
        mention('Lari', 'person'),        // not in source — drop
        mention('Genius', 'product'),     // not in source — drop
        mention('reunião', 'event'),      // not in source — drop
      ],
    });
    const rawContent = 'Vou viajar amanhã para casa';
    const { output: cleaned } = sanitizeV14EntityMentions(output, rawContent);
    expect(cleaned.entity_mentions).toEqual([]);
  });

  it('keeps real entities that appear in the source', () => {
    const output = baseOutput({
      entity_mentions: [
        mention('Breno', 'person'),
        mention('Lari', 'person'),
        mention('Genius', 'product'),
      ],
    });
    const rawContent = 'Conversei com Breno e Lari sobre a Genius ontem';
    const { output: cleaned } = sanitizeV14EntityMentions(output, rawContent);
    expect(cleaned.entity_mentions.map((m) => m.mention_text).sort()).toEqual(['Breno', 'Genius', 'Lari']);
  });

  it('is case-insensitive and accent-insensitive', () => {
    const output = baseOutput({
      entity_mentions: [
        mention('BRENO', 'person'),
        mention('Gênius', 'product'),
      ],
    });
    const rawContent = 'Conversei com breno sobre a genius';
    const { output: cleaned } = sanitizeV14EntityMentions(output, rawContent);
    expect(cleaned.entity_mentions).toHaveLength(2);
  });

  it('drops single-character mentions (noise)', () => {
    const output = baseOutput({
      entity_mentions: [mention('a', 'topic'), mention('Breno', 'person')],
    });
    const rawContent = 'Conversei com Breno sobre a vida';
    const { output: cleaned, droppedMentions } = sanitizeV14EntityMentions(output, rawContent);
    expect(cleaned.entity_mentions).toHaveLength(1);
    expect(cleaned.entity_mentions[0]?.mention_text).toBe('Breno');
    expect(droppedMentions.some((d) => d.reason === 'too_short')).toBe(true);
  });

  it('keeps entities that appear in the pre-context block (thread history)', () => {
    const output = baseOutput({
      entity_mentions: [
        mention('Breno', 'person'),
        mention('Lari', 'person'),
      ],
    });
    const rawContent = 'Combinamos amanhã';
    const preContext = 'Última mensagem da thread: Wellerson vai encontrar Breno e Lari sábado';
    const { output: cleaned } = sanitizeV14EntityMentions(output, rawContent, preContext);
    expect(cleaned.entity_mentions).toHaveLength(2);
  });

  it('does not mutate the input output', () => {
    const output = baseOutput({
      entity_mentions: [mention('alguém', 'person'), mention('ESX', 'company')],
    });
    const original = JSON.parse(JSON.stringify(output));
    const rawContent = 'Preciso falar com alguém do ESX';
    sanitizeV14EntityMentions(output, rawContent);
    expect(output).toEqual(original);
  });
});
