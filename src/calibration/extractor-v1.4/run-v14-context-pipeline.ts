import type { ExtractorOutputV14 } from '../../openai/extractor-v1.4.types.js';
import type { V14CalibrationExpectations } from './fixed-calibration-expectations.js';
import { evaluateV2Case } from './evaluate-v2-case.js';
import {
  getIngestionContextById,
  mergeSourceMetadata,
  normalizeCaseSourceMetadata,
} from './load-ingestion-context.js';
import {
  classifyClarifications,
  computeFinalDecisionFromMateriality,
} from '../../types/clarification-types.js';
import { IngestionContextSelectorService } from '../../services/ingestion-context-selector.service.js';
import { MemoryCompilerV2Service } from '../../services/memory-compiler-v2.service.js';
import {
  buildTrustedEntityReferencesFromMetadata,
  collectReferenceTextsFromExtractor,
  ReferenceResolverService,
  type RegistryEntityFixture,
} from '../../services/reference-resolver.service.js';
import { TaskContextResolverService } from '../../services/task-context-resolver.service.js';
import type { CalibrationRegime, IngestionContext } from '../../types/ingestion-context.js';
import type { TemporalAnchor } from '../../types/memory-compiler-v2.js';
import { CALIBRATION_DEFAULT_TEMPORAL_ANCHOR } from '../temporal-normalizer/default-anchor.js';

export interface V14ContextCaseFile {
  scenario_id: string;
  raw_content: string;
  regime?: CalibrationRegime;
  temporal_anchor?: TemporalAnchor;
  ingestion_context_id?: string;
  source_metadata?: {
    sender_reference?: string;
    recipient_references?: string[];
    thread_reference?: string;
    reply_to_reference?: string;
    subject?: string;
    occurred_at?: string;
  };
}

export function buildFullIngestionContext(caseFile: V14ContextCaseFile): IngestionContext {
  const base = getIngestionContextById(caseFile.ingestion_context_id);
  const overlay = normalizeCaseSourceMetadata(caseFile.source_metadata);
  return {
    ...base,
    sourceMetadata: mergeSourceMetadata(base.sourceMetadata, overlay),
  };
}

export function runV14ContextPipeline(params: {
  scenarioId: string;
  extractorOutput: ExtractorOutputV14;
  expected: V14CalibrationExpectations;
  caseFile: V14ContextCaseFile;
  registryEntities: RegistryEntityFixture[];
  /** Calibration category for evaluate-v2-case (defaults to caseFile.regime). */
  evaluationCategory?: string;
  temporalAnchor?: TemporalAnchor;
}) {
  const { extractorOutput, expected, caseFile, registryEntities } = params;
  const fullContext = buildFullIngestionContext(caseFile);
  const taskResolver = new TaskContextResolverService();
  const taskSignalResolutions = taskResolver.resolveTaskSignals(
    extractorOutput.task_signals ?? [],
    fullContext,
  );

  const selector = new IngestionContextSelectorService();
  const compactContext = selector.selectCompact(
    fullContext,
    extractorOutput,
    caseFile.raw_content,
  );

  const resolverService = new ReferenceResolverService(registryEntities);
  const refs = collectReferenceTextsFromExtractor(extractorOutput);
  const trusted = buildTrustedEntityReferencesFromMetadata(
    fullContext.sourceMetadata.entityLike,
    resolverService,
  );
  const resolverResult = resolverService.resolveReferences(refs, trusted);

  const temporalAnchor =
    params.temporalAnchor ?? caseFile.temporal_anchor ?? CALIBRATION_DEFAULT_TEMPORAL_ANCHOR;

  const compiled = new MemoryCompilerV2Service().compile({
    extractorOutput,
    effectiveInput: caseFile.raw_content,
    resolverResult,
    fullIngestionContext: fullContext,
    compactIngestionContext: compactContext,
    taskSignalResolutions,
    temporalAnchor,
  });

  const clarificationMateriality = classifyClarifications(compiled.clarificationCandidates);
  const recommended = clarificationMateriality.blocking;
  const finalDecision = computeFinalDecisionFromMateriality(clarificationMateriality);

  const evaluation = evaluateV2Case(
    params.scenarioId,
    compiled,
    recommended.length,
    expected,
    {
      recommended,
      extractorOutput,
      category: params.evaluationCategory ?? caseFile.regime,
      finalDecision,
    },
  );

  return {
    compiled,
    recommended,
    clarificationMateriality,
    finalDecision,
    compilerDecision: compiled.decision,
    evaluation,
    fullContext,
    compactContext,
    taskSignalResolutions,
    resolverResult,
  };
}
