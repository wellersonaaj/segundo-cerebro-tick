import { describe, expect, it } from 'vitest';
import type { ExtractorOutputV14 } from '../src/openai/extractor-v1.4.types.js';
import { MemoryCompilerV2Service } from '../src/services/memory-compiler-v2.service.js';
import {
  applyInTextPronounCoreference,
  collectResolvedObjectPronouns,
  resolveInTextPronounAntecedent,
} from '../src/services/pronoun-coreference.service.js';
import { ReferenceResolverService } from '../src/services/reference-resolver.service.js';
import { suppressPronounClarifications } from '../src/services/implicit-assignee.service.js';

const EXCERPT =
  'Mandei mensagem para o Breno sugerindo que eu e o Brant almocemos com ele sábado ou domingo. Ele vai avaliar a disponibilidade.';

const registry = [
  {
    id: 'breno-id',
    name: 'Breno Moreira',
    normalized_name: 'breno moreira',
    entity_type: 'person',
    aliases: ['Breno'],
  },
  {
    id: 'brant-id',
    name: 'Bruno Brant Gotschalg',
    normalized_name: 'bruno brant gotschalg',
    entity_type: 'person',
    aliases: ['Brant'],
  },
  {
    id: 'eu-id',
    name: 'Wellerson Assumpção',
    normalized_name: 'wellerson assumpcao',
    entity_type: 'person',
    aliases: ['eu'],
  },
];

function lunchOutput(): ExtractorOutputV14 {
  return {
    schema_version: '1.4',
    events: [
      {
        title: 'Almoço (proposta)',
        event_kind: 'meeting',
        occurred_at: null,
        source_excerpt: EXCERPT,
        related_entities: [
          { entity_reference: 'Breno', relation_type: 'participant', role: null },
          { entity_reference: 'Brant', relation_type: 'participant', role: null },
          { entity_reference: 'eu', relation_type: 'participant', role: null },
        ],
        episodic_confidence: 0.7,
      },
    ],
    aliases: [],
    assertions: [
      {
        predicate: 'availability',
        confidence: 0.85,
        value_text: 'vai avaliar',
        assertion_kind: 'status_update',
        source_excerpt: 'Ele vai avaliar a disponibilidade.',
        object_reference: null,
        subject_reference: 'Breno',
        source_block_reference: '[SOURCE_BLOCK:raw]',
        related_entity_references: [],
      },
    ],
    review_hints: [
      {
        reason: "Uso de pronome 'ele'",
        confidence: 0.5,
        issue_type: 'ambiguous_identity',
        source_excerpt: EXCERPT,
        target_reference: 'ele',
      },
    ],
    task_signals: [],
    extraction_notes: [],
    correction_signals: [],
    clarification_candidates: [
      {
        target_type: 'entity',
        target_reference: 'ele',
        issue_type: 'ambiguous_identity',
        question: "Quem é 'ele'?",
        reason: 'pronome',
        priority: 'medium',
        blocking_scope: 'none',
        suggested_answers: ['Breno', 'Outra pessoa'],
        source_excerpt: EXCERPT,
        source_block_reference: '[SOURCE_BLOCK:raw]',
        confidence: 0.6,
      },
    ],
    entity_mentions: [
      {
        mention_text: 'Breno',
        suggested_entity_type: 'person',
        source_excerpt: EXCERPT,
        confidence: 0.98,
      },
      {
        mention_text: 'Brant',
        suggested_entity_type: 'person',
        source_excerpt: EXCERPT,
        confidence: 0.98,
      },
      {
        mention_text: 'eu',
        suggested_entity_type: 'person',
        source_excerpt: EXCERPT,
        confidence: 0.9,
      },
      {
        mention_text: 'ele',
        suggested_entity_type: 'person',
        source_excerpt: EXCERPT,
        confidence: 0.8,
      },
    ],
  };
}

describe('in-text pronoun coreference', () => {
  it('resolveInTextPronounAntecedent picks Breno before ele in same excerpt', () => {
    const output = lunchOutput();
    expect(resolveInTextPronounAntecedent(EXCERPT, 'ele', output)).toBe('Breno');
  });

  it('applyInTextPronounCoreference binds ele to Breno in registry', () => {
    const output = lunchOutput();
    const resolver = new ReferenceResolverService(registry);
    let result = resolver.resolveReferences(['Breno', 'Brant', 'eu', 'ele']);
    result = applyInTextPronounCoreference(result, output);

    const ele = result.byReferenceText.get('ele');
    expect(ele?.status).toBe('resolved');
    expect(ele?.entity_id).toBe('breno-id');
    expect(ele?.canonical_name).toContain('Breno');
    expect(collectResolvedObjectPronouns(result).has('ele')).toBe(true);
  });

  it('suppresses LLM clarification/review noise after pronoun resolution', () => {
    const output = lunchOutput();
    const resolver = new ReferenceResolverService(registry);
    let result = resolver.resolveReferences(['Breno', 'Brant', 'eu', 'ele']);
    result = applyInTextPronounCoreference(result, output);
    const resolved = collectResolvedObjectPronouns(result);
    const suppressed = suppressPronounClarifications(output, resolved);

    expect(suppressed.clarification_candidates).toHaveLength(0);
    expect(suppressed.review_hints).toHaveLength(0);
  });

  it('compiler drops ambiguous_identity clarification for resolved ele', () => {
    const output = lunchOutput();
    const resolver = new ReferenceResolverService(registry);
    let resolverResult = resolver.resolveReferences(['Breno', 'Brant', 'eu', 'ele']);
    resolverResult = applyInTextPronounCoreference(resolverResult, output);

    const compiler = new MemoryCompilerV2Service();
    const compiled = compiler.compile({
      extractorOutput: output,
      effectiveInput: `[SOURCE_BLOCK:raw]\n${EXCERPT}`,
      resolverResult,
      fullIngestionContext: {
        sourceMetadata: { routing: { thread_reference: 'telegram:chat:1' } },
        tasks: [],
        projects: [],
        entities: [],
      },
      compactIngestionContext: { tasks: [], projects: [] },
      taskSignalResolutions: [],
    });

    const eleEntity = compiled.resolvedEntities.find((e) => e.mentionText === 'ele');
    expect(eleEntity?.entityId).toBe('breno-id');
    expect(compiled.clarificationCandidates.some((c) => c.targetReference === 'ele')).toBe(false);
    expect(compiled.compilerNotes.some((n) => n.includes('pronoun_resolved: ele'))).toBe(true);
  });
});
