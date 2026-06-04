import type { CalibrationRegime } from '../../types/ingestion-context.js';
import { resolveExpected } from './live-audit-detail.js';
import type { LiveV14CaptureFile } from './live-audit-detail.js';
import type { V14ContextCaseFile } from './run-v14-context-pipeline.js';
import { V14_LIVE_VARIATIONS } from './live-variations.js';

export interface LiveV14CaptureForReeval extends LiveV14CaptureFile {
  ingestion_context_id?: string;
  source_metadata?: V14ContextCaseFile['source_metadata'];
  regime?: CalibrationRegime;
}

export function buildCaseFileFromLiveCapture(capture: LiveV14CaptureForReeval): V14ContextCaseFile {
  const variation = V14_LIVE_VARIATIONS.find((v) => v.category === capture.category);
  const expected = resolveExpected(capture.category, capture.repetition_index);

  return {
    scenario_id: capture.scenario_id,
    raw_content: capture.effective_input || capture.raw_content,
    regime: capture.regime ?? expected.regime ?? variation?.regime,
    ingestion_context_id:
      capture.ingestion_context_id ?? variation?.ingestion_context_id ?? 'empty',
    source_metadata: capture.source_metadata ?? variation?.source_metadata,
  };
}
