import type { OpenTaskRow, RankedRow, VerifyCoverageResult } from './rag/rag.types.js';

const WEAK_FALLBACK_SUFFIX =
  '\n\n_(Resposta baseada em poucos itens; se faltou algo, reformule ou pergunte de outro jeito.)_';

export class VerifierService {
  verifyCoverage(
    query: string,
    draft: string,
    allContext: RankedRow[],
    tasks: OpenTaskRow[],
  ): VerifyCoverageResult {
    const mentionsCtx = (draft.match(/\[(\d+)\]/g) ?? []).length > 0;
    const mentionsTasks = /\bT\d+\b/.test(draft);
    const admitsMissing = /nao tenho|nao encontrei|nao ha registro|sem tarefas abertas/i.test(draft);

    if (allContext.length > 0 && !mentionsCtx && !admitsMissing) {
      return { ok: false, reason: 'no citations and no explicit missing-info admission' };
    }
    if (tasks.length > 0 && /taref|pendente|compromisso/i.test(query) && !mentionsTasks && !admitsMissing) {
      return { ok: false, reason: 'question about tasks but no T# citation and no missing-info admission' };
    }
    return { ok: true };
  }

  applyWeakFallback(draft: string, check: VerifyCoverageResult): string {
    if (check.ok) return draft;
    return draft + WEAK_FALLBACK_SUFFIX;
  }
}
