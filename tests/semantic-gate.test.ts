import { describe, expect, it } from 'vitest';
import { createContextRegimeAccumulator } from '../src/calibration/extractor-v1.4/context-regime-metrics.js';
import {
  createV14MetricsAccumulator,
  finalizeV14Metrics,
} from '../src/calibration/extractor-v1.4/live-metrics.js';
import { evaluateSemanticGate } from '../src/calibration/extractor-v1.4/semantic-gate.js';
import { finalizeContextRegimeMetrics } from '../src/calibration/extractor-v1.4/context-regime-metrics.js';

describe('semantic-gate preference_to_event_rate', () => {
  it('is not_applicable without static_preferences runs (no false exit)', () => {
    const liveAcc = createV14MetricsAccumulator();
    liveAcc.totalRuns = 5;
    liveAcc.structuredOutputValid = 5;
    const contextAcc = createContextRegimeAccumulator();
    const metrics = finalizeV14Metrics(liveAcc);
    const contextMetrics = finalizeContextRegimeMetrics(contextAcc);
    const gate = evaluateSemanticGate(liveAcc, metrics, contextAcc, contextMetrics);
    const pref = gate.metrics.find((m) => m.metric === 'preference_to_event_rate');
    expect(pref).toMatchObject({
      status: 'not_applicable',
      value: null,
      passed: true,
    });
    expect(gate.all_passed).toBe(true);
  });
});
