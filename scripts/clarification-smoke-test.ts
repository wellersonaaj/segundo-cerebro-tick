/**
 * Homologação POST /clarifications/:id/resolve.
 * Pré-requisito: test:e2e:smoke (1 clarificação pending do fornecedor).
 */

import {
  BASE,
  fail,
  fetchJson,
  normalizeQuestion,
  ok,
  requireEnv,
} from './lib/homolog-helpers.js';

requireEnv(['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']);

const EXPECTED_QUESTION = 'qual fornecedor deve ser cobrado';

async function main(): Promise<void> {
  console.log('=== Clarification Resolve Smoke Test ===\n');
  console.log(`Base URL: ${BASE}\n`);
  console.log('Pré-requisito: npm run test:e2e:smoke (clarificação pending).\n');

  const listBefore = await fetchJson('/clarifications?status=pending');
  if (listBefore.status !== 200) {
    fail(`GET /clarifications retornou ${listBefore.status}`);
  }

  const pending = listBefore.body as Array<{
    id: string;
    question: string;
  }>;

  const target = pending.find(
    (c) => normalizeQuestion(c.question) === EXPECTED_QUESTION,
  );

  if (!target) {
    fail(
      `Clarificação "${EXPECTED_QUESTION}" não encontrada entre ${pending.length} pending. Rode test:e2e:smoke antes.`,
    );
  }
  ok(`Clarificação localizada: ${target.id}`);

  const resolve = await fetchJson(`/clarifications/${target.id}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ answer: 'Genius Hotels' }),
  });

  if (resolve.status !== 200 && resolve.status !== 201) {
    fail(`POST resolve retornou ${resolve.status}: ${JSON.stringify(resolve.body)}`);
  }
  ok('POST /clarifications/:id/resolve → Genius Hotels');

  const listAfter = await fetchJson('/clarifications?status=pending');
  const stillPending = (listAfter.body as Array<{ id: string }>).some((c) => c.id === target.id);
  if (stillPending) {
    fail('Clarificação ainda aparece como pending após resolve');
  }

  const resolvedBody = resolve.body as {
    clarification?: {
      id: string;
      status: string;
      answer: string | null;
      answered_at: string | null;
    };
  };
  const answered = resolvedBody.clarification;
  if (!answered || answered.id !== target.id) {
    fail(`Resposta resolve sem clarification: ${JSON.stringify(resolve.body)}`);
  }
  if (answered.status !== 'answered') {
    fail(`status esperado answered, obtido: ${answered.status}`);
  }
  if (answered.answer !== 'Genius Hotels') {
    fail(`answer esperado "Genius Hotels", obtido: ${answered.answer}`);
  }
  if (!answered.answered_at) {
    fail('answered_at não preenchido');
  }

  ok('POST resolve → clarification answered com answer e answered_at');

  console.log('\n=== Clarification smoke concluído com sucesso ===\n');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
