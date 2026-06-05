import { describe, expect, it } from 'vitest';
import { runIntentClassifierEval } from './intent-classifier.eval.js';

function hasRealOpenAiKey(): boolean {
  const key = process.env.OPENAI_API_KEY;
  return Boolean(key && key !== 'test-openai-key' && key.startsWith('sk-'));
}

describe('intent-classifier eval (live)', () => {
  it.skipIf(!hasRealOpenAiKey(), 'requires real OPENAI_API_KEY')(
    'achieves >=85% hit rate on intent-eval fixture',
    async () => {
      const report = await runIntentClassifierEval(0.85);
      if (!report.passed) {
        console.error('Failures:', report.failures);
      }
      expect(report.hitRate).toBeGreaterThanOrEqual(0.85);
    },
    120_000,
  );
});
