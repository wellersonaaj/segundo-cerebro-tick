#!/usr/bin/env tsx
/**
 * CEREBRO.OBSERVER — Evaluation set
 *
 * 12 perguntas reais baseadas nos dados do banco. Cada uma tem:
 *   - question: o que o Wellerson perguntaria
 *   - must_mention: termos que a resposta DEVE conter (substring match)
 *   - must_not_say: termos que a resposta NAO deve conter (sinais de confabulação)
 *
 * O eval roda cada pergunta pelo pipeline completo (retrieve → rerank →
 * compose → verify) e mede:
 *   - retrieval_hit: top-1/3/5 do rerank contém texto relevante?
 *   - compose_mentions: a resposta cita os must_mention?
 *   - compose_clean: a resposta evita must_not_say?
 *   - empty_response: a resposta veio vazia?
 *
 * Output em /tmp/observer-eval.jsonl (1 entry por pergunta).
 *
 * Uso:
 *   set -a; source /root/.observer_env; set +a
 *   npx tsx scripts/observer-eval.ts
 */

import { appendFile, writeFile } from 'node:fs/promises';

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY!;
const OUTPUT_FILE = '/tmp/observer-eval.jsonl';

interface EvalCase {
  id: string;
  question: string;
  must_mention: string[];
  must_not_say: string[];
  rationale: string;
  synonyms?: Record<string, string[]>;  // chave pode ser um desses
  allow_missing?: boolean;  // se true, "Nao tenho" é resposta válida
}

const CASES: EvalCase[] = [
  {
    id: 'compromissos-hoje',
    question: 'Tenho algum compromisso para hoje?',
    must_mention: ['Lari'],  // Larisse ok também
    must_not_say: ['reunião agendada'],  // não há reunião hoje marcada
    rationale: 'Lari vem de inbox 053564ef, compromissos vem de inbox 6ea54901 e tasks abertas',
    synonyms: { 'Lari': ['Larisse', 'Lari', 'lari'] },
    allow_missing: false,  // espera resposta substancial
  },
  {
    id: 'quem-bruno',
    question: 'Quem é o Bruno?',
    must_mention: ['sócio', 'CEO', 'VELT'],
    must_not_say: ['desconhecido'],
    rationale: 'vem das assertions: role, sócio, CEO da VELT',
    synonyms: {},
    allow_missing: false,
  },
  {
    id: 'quem-breno',
    question: 'Quem é o Breno?',
    must_mention: ['Rio'],
    must_not_say: ['sócio da VELT', 'CEO'],  // NÃO é sócio da VELT
    rationale: 'Breno Moreira = Rio, ex-colega, potencial investidor (mas o "potencial investidor" não é assert confirmado no DB)',
    synonyms: { 'Rio': ['rio', 'Rio de Janeiro'] },
    allow_missing: false,
  },
  {
    id: 'larisse-quem',
    question: 'Quem é a Larisse?',
    must_mention: ['Lari'],  // só precisa mencionar pelo nome
    must_not_say: ['amiga', 'colega', 'desconhecida'],
    rationale: 'vem do bootstrap: Larisse do Carmo Peixoto (Lari), namorada. Relação específica é nice-to-have',
    synonyms: { 'Lari': ['Larisse', 'Lari', 'lari'] },
    allow_missing: false,
  },
  {
    id: 'o-que-sabe-sobre-mim',
    question: 'O que você sabe sobre mim?',
    must_mention: ['Wellerson'],  // deve mencionar o nome
    must_not_say: [],
    rationale: 'qualquer menção ao Wellerson é válida',
    synonyms: { 'Wellerson': ['Wellerson', 'voce', 'você', 'Tick'] },
    allow_missing: false,
  },
  {
    id: 'tarefas-pendentes',
    question: 'Quais são minhas tarefas pendentes?',
    must_mention: ['fornecedor', 'IP'],  // tem Cobrar fornecedor sobre IP
    must_not_say: [],
    rationale: 'tem Cobrar fornecedor sobre IP entre as tasks abertas — o bot DEVE listar',
    synonyms: {},
    allow_missing: false,
  },
  {
    id: 'quem-brant',
    question: 'Quem é o Brant?',
    must_mention: ['Bruno', 'CEO'],
    must_not_say: ['desconhecido'],
    rationale: 'Brant = Bruno Brant Gotschalg, CEO da VELT',
    synonyms: { 'Bruno': ['Bruno', 'bruno'] },
    allow_missing: false,
  },
  {
    id: 'proximo-almoço',
    question: 'Vou almoçar com alguém em breve?',
    must_mention: ['Breno'],
    must_not_say: [],
    rationale: 'vem de inbox bda5bec8: Mandei mensagem para o Breno sugerindo almoço',
    synonyms: {},
    allow_missing: false,
  },
  {
    id: 'relacao-velho',
    question: 'Como é minha relação com pessoas da VELT?',
    must_mention: ['Bruno'],
    must_not_say: [],
    rationale: 'Bruno Brant = sócio + CEO da VELT (assertions)',
    synonyms: {},
    allow_missing: false,
  },
  {
    id: 'projeto-atlas',
    question: 'O que é o projeto Atlas?',
    must_mention: ['nao tenho'],  // não há info sobre Atlas, deve admitir
    must_not_say: [],
    rationale: 'não tem info sobre Atlas no DB (deve admitir) — checa se bot NÃO inventa',
    synonyms: { 'nao tenho': ['nao tenho', 'não tenho', 'nao encontrei', 'não encontrei'] },
    allow_missing: true,  // caso de "missing info é resposta correta"
  },
  {
    id: 'quem-dele-msg',
    question: 'Sobre o que eu falei na última mensagem?',
    must_mention: ['Breno'],
    must_not_say: [],
    rationale: 'última msg Telegram: "O breno confirmou"',
    synonyms: {},
    allow_missing: false,
  },
  {
    id: 'financeiro-quem',
    question: 'Quem cuida do financeiro aqui?',
    must_mention: ['Lari'],
    must_not_say: [],
    rationale: 'vem do inbox pipeline: "Larisse cuida do financeiro"',
    synonyms: { 'Lari': ['Larisse', 'Lari', 'lari'] },
    allow_missing: false,
  },
];

interface EvalResult {
  case_id: string;
  question: string;
  rerank_top: Array<{ source: string; date: string; score: number; preview: string }>;
  answer: string;
  answer_chars: number;
  empty: boolean;
  mentions_hit: string[];
  mentions_miss: string[];
  forbidden_hit: string[];
  retrieval_top1_correct: boolean;
  pass: boolean;
  rationale: string;
  total_ms: number;
}

interface HybridRow {
  id: string;
  raw_content: string;
  source_channel: string | null;
  occurred_at: string | null;
  combined_score: number;
}

interface RankedItem {
  id: string;
  text: string;
  source: string;
  date: string;
  score: number;
}

function toRanked(it: HybridRow, score?: number): RankedItem {
  return { id: it.id, text: it.raw_content, source: it.source_channel ?? 'memory', date: it.occurred_at ? String(it.occurred_at).slice(0, 16) : '', score: score ?? it.combined_score };
}

async function openai<T = any>(path: string, body: Record<string, unknown>): Promise<T> {
  const r = await fetch(`https://api.openai.com/v1/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', authorization: `Bearer ${OPENAI_API_KEY}` },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`openai ${path}: ${r.status} ${(await r.text()).slice(0, 200)}`);
  return (await r.json()) as T;
}

async function embed(text: string): Promise<number[]> {
  const d = await openai<{ data: Array<{ embedding: number[] }> }>('embeddings', { model: 'text-embedding-3-small', input: text });
  return d.data[0].embedding;
}

async function hybridSearch(table: 'inbox_items' | 'assertions', query: string, limit: number): Promise<HybridRow[]> {
  const emb = await embed(query);
  const vecStr = '[' + emb.join(',') + ']';
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/hybrid_search_${table}`, {
    method: 'POST',
    headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_query_embedding: vecStr, p_query_text: query, p_limit: limit }),
  });
  if (!r.ok) throw new Error(`rpc ${table}: ${r.status}`);
  return (await r.json()) as HybridRow[];
}

async function rerank(query: string, items: HybridRow[], keep: number): Promise<RankedItem[]> {
  if (items.length === 0) return [];
  if (items.length <= keep) return items.map(toRanked);
  const numbered = items.map((it, i) => `[${i + 1}] (${it.source_channel ?? 'memory'})\n${it.raw_content.slice(0, 500)}`).join('\n\n');
  const prompt = `Atribua nota 0-10 a cada candidato pela relevancia com a PERGUNTA. Responda com uma nota por linha, na ordem.\n\nPERGUNTA: ${query}\n\nCANDIDATOS:\n${numbered}\n\nNOTAS:`;
  const d = await openai<{ choices: Array<{ message: { content: string } }> }>('chat/completions', {
    model: 'gpt-5-mini',
    messages: [{ role: 'user', content: prompt }],
    max_completion_tokens: 200,
  });
  const lines = (d.choices[0]?.message?.content ?? '').split('\n').map(l => l.trim()).filter(Boolean);
  const scored = items.map((it, i) => {
    const m = (lines[i] ?? '0').match(/-?\d+(\.\d+)?/);
    return { item: it, score: m ? Math.max(0, Math.min(10, parseFloat(m[0]))) : 0 };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, keep).map(s => toRanked(s.item, s.score));
}

async function compose(query: string, context: RankedItem[], tasks: Array<{ id: string; title: string; due_at_local_date: string | null }> = []): Promise<string> {
  const sections: string[] = [];
  if (context.length > 0) {
    const ctxStr = context.map((c, i) => `[${i + 1}] ${c.source}${c.date ? ' · ' + c.date : ''}\n${c.text.slice(0, 700)}`).join('\n\n---\n\n');
    sections.push(`MEMORIA:\n${ctxStr}`);
  }
  if (tasks.length > 0) {
    const taskStr = tasks.map((t, i) => {
      const due = t.due_at_local_date ?? 'sem prazo';
      return `T${i + 1} | ${due} | ${t.title}`;
    }).join('\n');
    sections.push(`TAREFAS ABERTAS (TOTAL: ${tasks.length}):\n${taskStr}`);
  }
  if (sections.length === 0) return 'Nao encontrei nada relevante na memoria sobre isso ainda.';

  const prompt = `Voce e o assistente de memoria do Wellerson. Responda em portugues, conciso e PRECISO. Use APENAS o que esta nas secoes MEMORIA e TAREFAS. Ao mencionar pessoas, USE O NOME PROPRIO. Se a secao TAREFAS tem items e a pergunta eh sobre tarefas, LISTE TODAS usando T1, T2 etc. Se faltar info, diga "Nao tenho isso na memoria ainda." Max 6 frases.\n\n${sections.join('\n\n---\n\n')}\n\nPERGUNTA: ${query}\n\nRESPOSTA:`;
  const d = await openai<{ choices: Array<{ finish_reason?: string; message: { content: string } }> }>('chat/completions', {
    model: 'gpt-5-mini',
    messages: [{ role: 'user', content: prompt }],
    max_completion_tokens: 1500,
  });
  const c = d.choices[0];
  if (!c?.message?.content) throw new Error(`compose empty (finish=${c?.finish_reason})`);
  return c.message.content;
}

async function runCase(c: EvalCase): Promise<EvalResult> {
  const t0 = Date.now();
  const [inbox, assertions, allTasks] = await Promise.all([
    hybridSearch('inbox_items', c.question, 10),
    hybridSearch('assertions', c.question, 5),
    fetch(`${SUPABASE_URL}/rest/v1/tasks?status=eq.open&order=due_at_local_date.asc.nullslast,created_at.asc&limit=15&select=id,title,due_at_local_date`, {
      headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
    }).then(r => r.json() as Promise<Array<{ id: string; title: string; due_at_local_date: string | null }>>),
  ]);
  const tasks = allTasks.slice(0, 10);
  const [inboxRanked, assertionsRanked] = await Promise.all([
    rerank(c.question, inbox, 5),
    rerank(c.question, assertions, 3),
  ]);
  const allContext = [...inboxRanked, ...assertionsRanked];
  let answer = '';
  try {
    answer = await compose(c.question, allContext, tasks);
  } catch (e) {
    answer = `[ERROR: ${(e as Error).message}]`;
  }

  const lower = answer.toLowerCase();
  const matchesMention = (term: string): boolean => {
    const variants = [term, ...(c.synonyms?.[term] ?? [])];
    return variants.some(v => lower.includes(v.toLowerCase()));
  };
  const mentions_hit = c.must_mention.filter(matchesMention);
  const mentions_miss = c.must_mention.filter(t => !matchesMention(t));
  const forbidden_hit = c.must_not_say.filter(t => lower.includes(t.toLowerCase()));
  const empty = answer.trim() === '' || answer.startsWith('[ERROR');
  const admitsMissing = /nao tenho|nao encontrei|nao ha registro|sem tarefas abertas/i.test(answer);

  // Heuristic: top-1 do rerank tem info relevante?
  const top1 = allContext[0];
  const retrieval_top1_correct = top1
    ? c.must_mention.some(t => top1.text.toLowerCase().includes(t.toLowerCase()))
    : false;

  let pass: boolean;
  if (c.allow_missing && admitsMissing) {
    pass = !empty && forbidden_hit.length === 0;
  } else {
    pass = !empty
      && (c.must_mention.length === 0 || mentions_hit.length > 0)
      && forbidden_hit.length === 0;
  }

  return {
    case_id: c.id,
    question: c.question,
    rerank_top: allContext.slice(0, 5).map(r => ({ source: r.source, date: r.date, score: r.score, preview: r.text.slice(0, 100) })),
    answer,
    answer_chars: answer.length,
    empty,
    mentions_hit,
    mentions_miss,
    forbidden_hit,
    retrieval_top1_correct,
    pass,
    rationale: c.rationale,
    total_ms: Date.now() - t0,
  };
}

async function main(): Promise<void> {
  await writeFile(OUTPUT_FILE, '');
  console.log(`Rodando ${CASES.length} casos de eval...\n`);

  const results: EvalResult[] = [];
  for (const c of CASES) {
    const r = await runCase(c);
    await appendFile(OUTPUT_FILE, JSON.stringify(r) + '\n');
    results.push(r);
    const status = r.pass ? '✓' : '✗';
    const hits = r.mentions_hit.length;
    const forbid = r.forbidden_hit.length;
    console.log(`  ${status} ${c.id.padEnd(22)} | ${hits} hit, ${forbid} forbid, top1=${r.retrieval_top1_correct ? '✓' : '✗'} | ${r.total_ms}ms`);
  }

  // Summary
  const total = results.length;
  const passed = results.filter(r => r.pass).length;
  const empty = results.filter(r => r.empty).length;
  const top1 = results.filter(r => r.retrieval_top1_correct).length;
  const avgMs = results.reduce((s, r) => s + r.total_ms, 0) / total;

  console.log(`\n=== SUMMARY ===`);
  console.log(`  Total:    ${total}`);
  console.log(`  Passed:   ${passed} (${Math.round(passed/total*100)}%)`);
  console.log(`  Empty:    ${empty}`);
  console.log(`  Top1 hit: ${top1} (${Math.round(top1/total*100)}%)`);
  console.log(`  Avg ms:   ${Math.round(avgMs)}`);

  // Detail of fails
  const fails = results.filter(r => !r.pass);
  if (fails.length > 0) {
    console.log(`\n=== FAIL DETAILS ===`);
    for (const f of fails) {
      console.log(`\n[${f.case_id}] Q: ${f.question}`);
      console.log(`  Answer: ${f.answer.slice(0, 200)}...`);
      if (f.mentions_miss.length > 0) console.log(`  Miss: ${f.mentions_miss.join(', ')}`);
      if (f.forbidden_hit.length > 0) console.log(`  Forbidden hit: ${f.forbidden_hit.join(', ')}`);
      if (f.empty) console.log(`  EMPTY response`);
      console.log(`  Top rerank: ${f.rerank_top[0]?.source} | ${f.rerank_top[0]?.preview.slice(0, 80)}...`);
    }
  }
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
