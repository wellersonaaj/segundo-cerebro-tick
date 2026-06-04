import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { FIXED_EXTRACTOR_FIXTURES } from '../src/calibration/extractor-v1.4/fixed-extractor-fixtures.js';
import { ClarificationManagerV2Service } from '../src/services/clarification-manager-v2.service.js';
import { MemoryCompilerV2Service } from '../src/services/memory-compiler-v2.service.js';
import {
  collectReferenceTextsFromExtractor,
  ReferenceResolverService,
  type RegistryEntityFixture,
} from '../src/services/reference-resolver.service.js';
import { parseExtractorOutputV14 } from '../src/openai/extractor-v1.4.types.js';
import { CALIBRATION_DEFAULT_TEMPORAL_ANCHOR } from '../src/calibration/temporal-normalizer/default-anchor.js';
import type { TemporalAnchor } from '../src/types/memory-compiler-v2.js';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const registry = JSON.parse(
  readFileSync(join(root, 'data/calibration/extractor-v1.4/registry-fixture.json'), 'utf8'),
) as { entities: RegistryEntityFixture[] };

function compileScenario(
  scenarioId: string,
  rawContent: string,
  temporalAnchor: TemporalAnchor | undefined = CALIBRATION_DEFAULT_TEMPORAL_ANCHOR,
) {
  const output = FIXED_EXTRACTOR_FIXTURES[scenarioId]!;
  const resolver = new ReferenceResolverService(registry.entities);
  const resolverResult = resolver.resolveReferences(collectReferenceTextsFromExtractor(output));
  const compiled = new MemoryCompilerV2Service().compile({
    extractorOutput: output,
    effectiveInput: rawContent,
    resolverResult,
    temporalAnchor,
  });
  const recommended = new ClarificationManagerV2Service().recommend({
    llmCandidates: compiled.clarificationCandidates.filter((c) => c.source === 'llm'),
    compilerCandidates: compiled.clarificationCandidates.filter((c) => c.source !== 'llm'),
    resolverResult,
    flags: compiled.flags,
    extractorOutput: output,
    compiled: {
      tasks: compiled.tasks,
      assertions: compiled.assertions,
      events: compiled.events,
    },
    effectiveInput: rawContent,
  });
  return { compiled, recommended, resolverResult };
}

describe('MemoryCompilerV2Service', () => {
  it('panorama estático → 0 events', () => {
    const { compiled } = compileScenario(
      'v14-panorama-static',
      '[SOURCE_BLOCK:raw]\nPanorama: Alex Costa (Ace)',
    );
    expect(compiled.events).toHaveLength(0);
    expect(compiled.aliases.length).toBeGreaterThan(0);
  });

  it('preferência estática → assertions, 0 events', () => {
    const { compiled } = compileScenario(
      'v14-static-preferences',
      '[SOURCE_BLOCK:raw]\nAlex prefere reuniões pela manhã',
    );
    expect(compiled.events).toHaveLength(0);
    expect(compiled.assertions.some((a) => a.assertionKind === 'opinion')).toBe(true);
  });

  it('alias explícito → alias sem entity Tick', () => {
    const { compiled } = compileScenario(
      'v14-alias-explicit',
      '[SOURCE_BLOCK:raw]\nTick → Alex Costa',
    );
    expect(compiled.aliases.some((a) => a.alias === 'Tick')).toBe(true);
    expect(compiled.resolvedEntities.some((e) => e.mentionText === 'Tick')).toBe(false);
  });

  it('alias negado → negated_former presente', () => {
    const { compiled } = compileScenario(
      'v14-alias-negated',
      '[SOURCE_BLOCK:raw]\nZeta-1 → Gabriel Nova',
    );
    expect(compiled.aliases[0]?.negatedFormerReferences).toContain('Helcio Zeta');
  });

  it('meeting → event_kind meeting', () => {
    const { compiled } = compileScenario(
      'v14-meeting',
      '[SOURCE_BLOCK:raw]\nChris participou da reunião',
    );
    expect(compiled.events[0]?.eventKind).toBe('meeting');
  });

  it('confirmation → event_kind confirmation', () => {
    const { compiled } = compileScenario(
      'v14-confirmation',
      '[SOURCE_BLOCK:raw]\nDana confirmou envio',
    );
    expect(compiled.events[0]?.eventKind).toBe('confirmation');
  });

  it('task open → operation create', () => {
    const { compiled } = compileScenario('v14-task-open', '[SOURCE_BLOCK:raw]\ntask');
    expect(compiled.tasks[0]?.operation).toBe('create');
    expect(compiled.tasks[0]?.statusSignal).toBe('open');
    expect(compiled.tasks[0]?.projectReference).toBe('Projeto Atlas');
  });

  it('create com fornecedor genérico → missing_task_target (compiler)', () => {
    const cases: Array<{
      label: string;
      targetReference: string | null;
      expectClarification: boolean;
    }> = [
      { label: 'target_reference null', targetReference: null, expectClarification: true },
      { label: 'target_reference fornecedor', targetReference: 'fornecedor', expectClarification: true },
      {
        label: 'target_reference Genius Hotels',
        targetReference: 'Genius Hotels',
        expectClarification: false,
      },
      {
        label: 'target_reference fornecedor ACME',
        targetReference: 'fornecedor ACME',
        expectClarification: false,
      },
    ];

    for (const testCase of cases) {
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
            title: 'Cobrar o fornecedor amanhã.',
            task_kind: 'follow_up',
            status_signal: 'open',
            assignee_reference: null,
            target_reference: testCase.targetReference,
            project_reference: null,
            due_at: '2026-06-02',
            blocked_reason: null,
            source_excerpt: 'Preciso cobrar o fornecedor amanhã.',
            source_block_reference: '[SOURCE_BLOCK:raw]',
            confidence: 0.9,
            task_reference: null,
          },
        ],
        clarification_candidates: [],
        review_hints: [],
        extraction_notes: [],
      });
      const resolver = new ReferenceResolverService(registry.entities);
      const resolverResult = resolver.resolveReferences(collectReferenceTextsFromExtractor(output));
      const compiled = new MemoryCompilerV2Service().compile({
        extractorOutput: output,
        effectiveInput: '[SOURCE_BLOCK:raw]\nPreciso cobrar o fornecedor amanhã.',
        resolverResult,
        temporalAnchor: CALIBRATION_DEFAULT_TEMPORAL_ANCHOR,
      });
      const clarification = compiled.clarificationCandidates.find(
        (c) => c.issueType === 'missing_task_target' && c.source === 'compiler',
      );

      if (testCase.expectClarification) {
        expect(clarification, testCase.label).toBeDefined();
        expect(clarification?.question, testCase.label).toBe('Qual fornecedor deve ser cobrado?');
        expect(clarification?.blockingScope, testCase.label).toBe('task_execution');
        expect(clarification?.targetReference, testCase.label).toBe('Cobrar o fornecedor amanhã.');
      } else {
        expect(clarification, testCase.label).toBeUndefined();
      }
    }

    const materiality = new ClarificationManagerV2Service().classify({
      llmCandidates: [],
      compilerCandidates: new MemoryCompilerV2Service()
        .compile({
          extractorOutput: parseExtractorOutputV14({
            schema_version: '1.4',
            entity_mentions: [],
            aliases: [],
            events: [],
            correction_signals: [],
            assertions: [],
            task_signals: [
              {
                operation: 'create',
                title: 'Cobrar o fornecedor amanhã.',
                task_kind: 'follow_up',
                status_signal: 'open',
                assignee_reference: null,
                target_reference: 'fornecedor',
                project_reference: null,
                due_at: '2026-06-02',
                blocked_reason: null,
                source_excerpt: 'Preciso cobrar o fornecedor amanhã.',
                source_block_reference: '[SOURCE_BLOCK:raw]',
                confidence: 0.9,
                task_reference: null,
              },
            ],
            clarification_candidates: [],
            review_hints: [],
            extraction_notes: [],
          }),
          effectiveInput: '[SOURCE_BLOCK:raw]\nPreciso cobrar o fornecedor amanhã.',
          resolverResult: new ReferenceResolverService(registry.entities).resolveReferences([]),
          temporalAnchor: CALIBRATION_DEFAULT_TEMPORAL_ANCHOR,
        })
        .clarificationCandidates.filter((c) => c.source !== 'llm'),
      resolverResult: new ReferenceResolverService(registry.entities).resolveReferences([]),
      flags: {
        negatedReferences: [],
        supersededReferences: [],
        presentSourceBlocks: ['[SOURCE_BLOCK:raw]'],
        contextResolvedTasks: [],
        contextAmbiguousTasks: [],
      },
      effectiveInput: '[SOURCE_BLOCK:raw]\nPreciso cobrar o fornecedor amanhã.',
    });
    expect(
      [...materiality.blocking, ...materiality.nonBlocking].some(
        (c) => c.issueType === 'missing_task_target',
      ),
    ).toBe(true);
  });

  it('task blocked → update_blocker', () => {
    const { compiled } = compileScenario('v14-task-blocked', '[SOURCE_BLOCK:raw]\nblocked');
    expect(compiled.tasks[0]?.operation).toBe('update_blocker');
    expect(compiled.tasks[0]?.statusSignal).toBe('blocked');
    expect(compiled.tasks[0]?.blockedReason).toContain('aprovação');
  });

  it('task due date → update_due_date', () => {
    const { compiled } = compileScenario('v14-task-due-date-change', '[SOURCE_BLOCK:raw]\ndue');
    expect(compiled.tasks[0]?.operation).toBe('update_due_date');
    expect(compiled.tasks[0]?.dueAt).toBe('segunda-feira');
    expect(compiled.tasks[0]?.dueAtTemporal?.status).toBe('resolved');
    expect(compiled.tasks[0]?.dueAtTemporal?.localDate).toBe('2026-06-08');
    expect(compiled.tasks[0]?.dueAtTemporal?.instant).toBeNull();
  });

  it('task assignee → update_assignee', () => {
    const { compiled } = compileScenario('v14-task-assignee-change', '[SOURCE_BLOCK:raw]\nassignee');
    expect(compiled.tasks[0]?.operation).toBe('update_assignee');
    expect(compiled.tasks[0]?.assigneeReference).toBe('Dana Silva');
  });

  it('task complete → complete', () => {
    const { compiled } = compileScenario('v14-task-completed', '[SOURCE_BLOCK:raw]\ndone');
    expect(compiled.tasks[0]?.operation).toBe('complete');
    expect(compiled.tasks[0]?.statusSignal).toBe('completed');
  });

  it('task cancel → cancel', () => {
    const { compiled } = compileScenario('v14-task-cancel', '[SOURCE_BLOCK:raw]\ncancel');
    expect(compiled.tasks[0]?.operation).toBe('cancel');
    expect(compiled.tasks[0]?.statusSignal).toBe('cancelled');
  });

  it('status_update de projeto', () => {
    const { compiled } = compileScenario('v14-project-status', '[SOURCE_BLOCK:raw]\nstatus');
    expect(compiled.assertions[0]?.assertionKind).toBe('status_update');
  });

  it('status_update válido com value_text → preservado (contrato predicate=status)', () => {
    const resolver = new ReferenceResolverService(registry.entities);
    const output = parseExtractorOutputV14({
      ...FIXED_EXTRACTOR_FIXTURES['v14-project-status']!,
      assertions: [
        {
          assertion_kind: 'status_update',
          subject_reference: 'Projeto Atlas',
          predicate: 'status',
          object_reference: null,
          value_text: 'em risco',
          related_entity_references: ['Projeto Atlas'],
          source_excerpt: 'Projeto Atlas está em risco',
          source_block_reference: '[SOURCE_BLOCK:raw]',
          confidence: 0.9,
        },
      ],
    });
    const resolverResult = resolver.resolveReferences(collectReferenceTextsFromExtractor(output));
    const compiled = new MemoryCompilerV2Service().compile({
      extractorOutput: output,
      effectiveInput: '[SOURCE_BLOCK:raw]\nProjeto Atlas está em risco',
      resolverResult,
    });
    expect(compiled.assertions).toHaveLength(1);
    expect(compiled.assertions[0]?.predicate).toBe('status');
    expect(compiled.assertions[0]?.valueText).toBe('em risco');
    expect(compiled.decision.status).toBe('accepted');
  });

  it('status_update sem value_text → não promove + status_update_missing_value', () => {
    const resolver = new ReferenceResolverService(registry.entities);
    const output = parseExtractorOutputV14({
      ...FIXED_EXTRACTOR_FIXTURES['v14-project-status']!,
      assertions: [
        {
          assertion_kind: 'status_update',
          subject_reference: 'Projeto Atlas',
          predicate: 'está em risco',
          object_reference: 'sprint 4',
          value_text: null,
          related_entity_references: ['sprint 4'],
          source_excerpt: 'Projeto Atlas está em risco na sprint 4.',
          source_block_reference: '[SOURCE_BLOCK:raw]',
          confidence: 0.9,
        },
      ],
    });
    const resolverResult = resolver.resolveReferences(collectReferenceTextsFromExtractor(output));
    const compiled = new MemoryCompilerV2Service().compile({
      extractorOutput: output,
      effectiveInput: '[SOURCE_BLOCK:raw]\nProjeto Atlas está em risco na sprint 4.',
      resolverResult,
    });
    expect(compiled.assertions).toHaveLength(0);
    expect(
      compiled.droppedArtifacts.some((d) => d.reason === 'status_update_missing_value'),
    ).toBe(true);
    expect(
      compiled.clarificationCandidates.some((c) => c.issueType === 'status_update_missing_value'),
    ).toBe(true);
    expect(compiled.decision.status).toBe('needs_clarification');
  });

  it('ambiguous identity → clarification após manager', () => {
    const { recommended } = compileScenario(
      'v14-ambiguous-identity',
      '[SOURCE_BLOCK:raw]\nChris enviou',
    );
    expect(recommended.some((c) => c.issueType === 'ambiguous_entity_identity')).toBe(true);
  });

  it('source_block_reference inválida → rejected decision', () => {
    const resolver = new ReferenceResolverService(registry.entities);
    const output = {
      ...FIXED_EXTRACTOR_FIXTURES['v14-task-open']!,
      task_signals: [
        {
          ...FIXED_EXTRACTOR_FIXTURES['v14-task-open']!.task_signals[0]!,
          source_block_reference: '[SOURCE_BLOCK:missing]',
        },
      ],
    };
    const resolverResult = resolver.resolveReferences(collectReferenceTextsFromExtractor(output));
    const compiled = new MemoryCompilerV2Service().compile({
      extractorOutput: output,
      effectiveInput: '[SOURCE_BLOCK:raw]\nonly raw',
      resolverResult,
    });
    expect(compiled.decision.status).toBe('rejected');
  });

  it('needs_llm_review extension point', () => {
    const resolver = new ReferenceResolverService(registry.entities);
    const output = parseExtractorOutputV14({
      ...FIXED_EXTRACTOR_FIXTURES['v14-panorama-static']!,
      review_hints: [
        {
          issue_type: 'possible_contradiction',
          target_reference: null,
          reason: 'conflito',
          source_excerpt: 'x',
          confidence: 0.9,
        },
      ],
      clarification_candidates: [],
    });
    const resolverResult = resolver.resolveReferences(collectReferenceTextsFromExtractor(output));
    const compiled = new MemoryCompilerV2Service().compile({
      extractorOutput: output,
      effectiveInput: '[SOURCE_BLOCK:raw]\nPanorama',
      resolverResult,
    });
    expect(compiled.decision.status).toBe('needs_llm_review');
  });

  it('unresolved fraca → dropped artifact', () => {
    const resolver = new ReferenceResolverService(registry.entities);
    const output = parseExtractorOutputV14({
      ...FIXED_EXTRACTOR_FIXTURES['v14-panorama-static']!,
      entity_mentions: [
        {
          mention_text: 'xyzterm',
          suggested_entity_type: 'other',
          source_excerpt: 'xyzterm',
          confidence: 0.2,
        },
      ],
    });
    const resolverResult = resolver.resolveReferences(collectReferenceTextsFromExtractor(output));
    const compiled = new MemoryCompilerV2Service().compile({
      extractorOutput: output,
      effectiveInput: '[SOURCE_BLOCK:raw]\nxyzterm',
      resolverResult,
    });
    expect(
      compiled.droppedArtifacts.some(
        (d) => d.reason === 'weak_reference' || d.reason === 'non_registry_entity_type',
      ),
    ).toBe(true);
  });

  it('S1: meeting/topic mentions não entram em resolvedEntities nem bloqueiam por ambiguidade periférica', () => {
    const resolver = new ReferenceResolverService(registry.entities);
    const output = parseExtractorOutputV14({
      ...FIXED_EXTRACTOR_FIXTURES['v14-meeting']!,
      entity_mentions: [
        {
          mention_text: 'Marcelo Oliveira',
          suggested_entity_type: 'person',
          source_excerpt: 'Marcelo participou',
          confidence: 0.9,
        },
        {
          mention_text: 'Bruno Vega',
          suggested_entity_type: 'person',
          source_excerpt: 'Bruno participou',
          confidence: 0.9,
        },
        {
          mention_text: 'reunião',
          suggested_entity_type: 'other',
          source_excerpt: 'reunião',
          confidence: 0.8,
        },
        {
          mention_text: 'integração',
          suggested_entity_type: 'topic',
          source_excerpt: 'integração',
          confidence: 0.6,
        },
      ],
      clarification_candidates: [
        {
          target_type: 'entity',
          target_reference: 'reunião sobre a integração',
          issue_type: 'ambiguous_entity_type',
          question: 'reunião ou integração?',
          reason: 'peripheral',
          priority: 'medium',
          blocking_scope: 'knowledge_confirmation',
          suggested_answers: ['reunião', 'integração'],
          source_excerpt: 'reunião sobre a integração',
          source_block_reference: null,
          confidence: 0.5,
        },
      ],
      correction_signals: [
        {
          correction_type: 'replace_subject',
          previous_reference: 'Marcelo Oliveira',
          current_reference: 'Bruno Vega',
          source_excerpt: 'Na verdade, Bruno participou',
          source_block_reference: null,
          confidence: 0.9,
        },
      ],
    });
    const resolverResult = resolver.resolveReferences(collectReferenceTextsFromExtractor(output));
    const compiled = new MemoryCompilerV2Service().compile({
      extractorOutput: output,
      effectiveInput:
        '[SOURCE_BLOCK:raw]\nMarcelo participou da reunião sobre a integração.\n[CORRECTION] Na verdade, Bruno participou da reunião.',
      resolverResult,
    });

    expect(compiled.resolvedEntities.map((e) => e.mentionText)).toEqual(['Bruno Vega']);
    expect(compiled.resolvedEntities.some((e) => e.mentionText === 'reunião')).toBe(false);
    expect(compiled.resolvedEntities.some((e) => e.mentionText === 'integração')).toBe(false);
    expect(
      compiled.clarificationCandidates.some(
        (c) => c.targetReference === 'reunião sobre a integração',
      ),
    ).toBe(false);
    expect(
      compiled.compilerNotes.some((n) => n.includes('peripheral_ambiguity_ignored')),
    ).toBe(true);

    const materiality = new ClarificationManagerV2Service().classify({
      llmCandidates: compiled.clarificationCandidates.filter((c) => c.source === 'llm'),
      compilerCandidates: compiled.clarificationCandidates.filter((c) => c.source !== 'llm'),
      resolverResult,
      flags: compiled.flags,
      extractorOutput: output,
      compiled: {
        tasks: compiled.tasks,
        assertions: compiled.assertions,
        events: compiled.events,
      },
      effectiveInput: 'Marcelo → Bruno',
    });
    expect(
      materiality.blocking.filter((c) => c.blockingScope === 'knowledge_confirmation'),
    ).toHaveLength(0);
  });

  it('S3.1: termos genéricos/metalinguísticos não entram em resolvedEntities', () => {
    const blocked = [
      'cliente',
      'fornecedor',
      'person',
      'company',
      'project',
      'product',
    ] as const;
    for (const term of blocked) {
      const resolver = new ReferenceResolverService(registry.entities);
      const output = parseExtractorOutputV14({
        schema_version: '1.4',
        entity_mentions: [
          {
            mention_text: term,
            suggested_entity_type: term === 'cliente' || term === 'fornecedor' ? 'company' : term,
            source_excerpt: term,
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
      const resolverResult = resolver.resolveReferences(collectReferenceTextsFromExtractor(output));
      const compiled = new MemoryCompilerV2Service().compile({
        extractorOutput: output,
        effectiveInput: `[SOURCE_BLOCK:raw]\n${term}`,
        resolverResult,
      });
      expect(compiled.resolvedEntities, term).toHaveLength(0);
      expect(
        compiled.droppedArtifacts.some(
          (d) => d.reason === 'generic_term_isolated' && d.originalRef === term,
        ),
        term,
      ).toBe(true);
      expect(
        compiled.compilerNotes.some((n) => n.includes('generic_entity_term_dropped')),
        term,
      ).toBe(true);
    }
  });

  it('S1.1: entity_mention superseded por correction_signal não entra em resolvedEntities', () => {
    const resolver = new ReferenceResolverService(registry.entities);
    const output = parseExtractorOutputV14({
      ...FIXED_EXTRACTOR_FIXTURES['v14-meeting']!,
      entity_mentions: [
        {
          mention_text: 'Marcelo Oliveira',
          suggested_entity_type: 'person',
          source_excerpt: 'Marcelo participou',
          confidence: 0.9,
        },
        {
          mention_text: 'Bruno Vega',
          suggested_entity_type: 'person',
          source_excerpt: 'Bruno participou',
          confidence: 0.9,
        },
      ],
      correction_signals: [
        {
          correction_type: 'replace_subject',
          previous_reference: 'Marcelo Oliveira',
          current_reference: 'Bruno Vega',
          source_excerpt: 'Na verdade, Bruno participou',
          source_block_reference: null,
          confidence: 0.9,
        },
      ],
    });
    const resolverResult = resolver.resolveReferences(collectReferenceTextsFromExtractor(output));
    const compiled = new MemoryCompilerV2Service().compile({
      extractorOutput: output,
      effectiveInput:
        '[SOURCE_BLOCK:raw]\nMarcelo participou.\n[CORRECTION] Na verdade, Bruno participou.',
      resolverResult,
    });
    expect(compiled.resolvedEntities.some((e) => e.mentionText === 'Marcelo Oliveira')).toBe(
      false,
    );
    expect(compiled.resolvedEntities.some((e) => e.mentionText === 'Bruno Vega')).toBe(true);
    expect(
      compiled.droppedArtifacts.some(
        (d) =>
          d.reason === 'correction_superseded' &&
          d.originalRef === 'Marcelo Oliveira',
      ),
    ).toBe(true);
  });
});

describe('MemoryCompilerV2 temporal integration', () => {
  const service = new MemoryCompilerV2Service();
  const anchor = CALIBRATION_DEFAULT_TEMPORAL_ANCHOR;

  function compileTaskOutput(
    taskSignals: NonNullable<
      ReturnType<typeof parseExtractorOutputV14>['task_signals']
    >,
    temporalAnchor?: TemporalAnchor,
  ) {
    const output = parseExtractorOutputV14({
      schema_version: '1.4',
      entity_mentions: [],
      aliases: [],
      events: [],
      correction_signals: [],
      assertions: [],
      task_signals: taskSignals,
      clarification_candidates: [],
      review_hints: [],
      extraction_notes: [],
    });
    const resolver = new ReferenceResolverService(registry.entities);
    return service.compile({
      extractorOutput: output,
      effectiveInput: '[SOURCE_BLOCK:raw]\ntask',
      resolverResult: resolver.resolveReferences(collectReferenceTextsFromExtractor(output)),
      temporalAnchor,
    });
  }

  const baseSignal = {
    task_reference: 'tarefa',
    title: null,
    task_kind: null,
    status_signal: null,
    assignee_reference: null,
    target_reference: null,
    project_reference: null,
    blocked_reason: null,
    source_excerpt: 'x',
    source_block_reference: '[SOURCE_BLOCK:raw]',
    confidence: 0.9,
  };

  it('dueAt null → dueAtTemporal null', () => {
    const compiled = compileTaskOutput(
      [{ ...baseSignal, operation: 'create', title: 'Nova', due_at: null }],
      anchor,
    );
    expect(compiled.tasks[0]?.dueAtTemporal).toBeNull();
  });

  it('amanhã + anchor → literal preserved, date resolved, instant null', () => {
    const compiled = compileTaskOutput(
      [{ ...baseSignal, operation: 'update_due_date', due_at: 'amanhã' }],
      anchor,
    );
    expect(compiled.tasks[0]?.dueAt).toBe('amanhã');
    expect(compiled.tasks[0]?.dueAtTemporal?.status).toBe('resolved');
    expect(compiled.tasks[0]?.dueAtTemporal?.localDate).toBe('2026-06-04');
    expect(compiled.tasks[0]?.dueAtTemporal?.instant).toBeNull();
  });

  it('amanhã às 10h + anchor → datetime with instant', () => {
    const compiled = compileTaskOutput(
      [{ ...baseSignal, operation: 'update_due_date', due_at: 'amanhã às 10h' }],
      anchor,
    );
    expect(compiled.tasks[0]?.dueAtTemporal?.precision).toBe('datetime');
    expect(compiled.tasks[0]?.dueAtTemporal?.instant).toBe('2026-06-04T13:00:00.000Z');
  });

  it('sexta-feira + anchor → date only', () => {
    const compiled = compileTaskOutput(
      [{ ...baseSignal, operation: 'update_due_date', due_at: 'sexta-feira' }],
      anchor,
    );
    expect(compiled.tasks[0]?.dueAtTemporal?.precision).toBe('date');
    expect(compiled.tasks[0]?.dueAtTemporal?.localDate).toBe('2026-06-05');
    expect(compiled.tasks[0]?.dueAtTemporal?.instant).toBeNull();
  });

  it('31/02/2026 + anchor → impossible_date', () => {
    const compiled = compileTaskOutput(
      [{ ...baseSignal, operation: 'update_due_date', due_at: '31/02/2026' }],
      anchor,
    );
    expect(compiled.tasks[0]?.dueAtTemporal?.status).toBe('failed');
    expect(compiled.tasks[0]?.dueAtTemporal?.reasonCode).toBe('impossible_date');
    expect(compiled.tasks[0]?.dueAtTemporal?.instant).toBeNull();
  });

  it('dueAt + anchor ausente → missing_temporal_anchor', () => {
    const compiled = compileTaskOutput(
      [{ ...baseSignal, operation: 'update_due_date', due_at: 'amanhã' }],
      undefined,
    );
    expect(compiled.tasks[0]?.dueAt).toBe('amanhã');
    expect(compiled.tasks[0]?.dueAtTemporal?.status).toBe('failed');
    expect(compiled.tasks[0]?.dueAtTemporal?.reasonCode).toBe('missing_temporal_anchor');
    expect(compiled.tasks[0]?.dueAtTemporal?.instant).toBeNull();
  });
});
