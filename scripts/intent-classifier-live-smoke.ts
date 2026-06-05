import { loadDotEnv } from '../src/config/load-dotenv.js';
import { resetEnvCache } from '../src/config/env.js';
import { createIntentClassifierService } from '../src/services/intent-classifier.service.js';

loadDotEnv();
resetEnvCache();

async function main(): Promise<void> {
  const svc = createIntentClassifierService();
  const cases = [
    { text: 'marquei consulta com Breno quinta 14h', expected: 'save' },
    { text: 'o que eu tenho com o Breno?', expected: 'query' },
    { text: 'na verdade era sexta, não quinta', expected: 'update' },
    { text: '/status', expected: 'command' },
  ];

  let ok = 0;
  for (const c of cases) {
    const r = await svc.classify(c.text);
    const pass = r.intent === c.expected && r.confidence >= 0.5;
    if (pass) ok += 1;
    console.log(
      JSON.stringify({
        pass,
        text: c.text,
        expected: c.expected,
        got: r.intent,
        confidence: r.confidence,
        reasoning: r.reasoning.slice(0, 120),
      }),
    );
  }
  console.log(`\n${ok}/${cases.length} passed`);
  if (ok < cases.length) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
