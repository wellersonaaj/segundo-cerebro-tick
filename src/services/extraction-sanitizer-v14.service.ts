import type { ExtractorOutputV14 } from '../openai/extractor-v1.4.types.js';
import { normalizeText } from '../utils/normalize.js';

/**
 * Pronouns and generic nouns that the LLM should never extract as entities.
 * Defense in depth: the prompt also tells the LLM not to extract these, but
 * gpt-5-mini sometimes does. We drop them as a safety net, before persistence.
 */
const NON_ENTITY_STOPWORDS = new Set([
  // PT-BR pronouns
  'eu', 'mim', 'meu', 'minha', 'meus', 'minhas',
  'voce', 'tu', 'te', 'teu', 'tua', 'teus', 'tuas', 'seu', 'sua', 'seus', 'suas',
  'ele', 'ela', 'eles', 'elas', 'nos', 'nós', 'nosso', 'nossa',
  'alguem', 'alguém', 'ninguem', 'ninguém', 'todo mundo', 'ninguem',
  'fulano', 'beltrano', 'cicrano', 'sicrano',
  // PT-BR demonstratives / generic
  'isso', 'isto', 'aquilo', 'aquele', 'aquela', 'aqueles', 'aquelas',
  'esse', 'essa', 'esses', 'essas', 'este', 'esta', 'estes', 'estas',
  'algo', 'alguma coisa', 'coisa', 'treco', 'negocio', 'negócio',
  'tal', 'tal coisa',
  // PT-BR generic roles / abstract nouns (almost never real entities)
  'prazo', 'fornecedor', 'cliente', 'reunião', 'reuniao',
  'data', 'hora', 'dia', 'local', 'lugar', 'endereco', 'endereço',
  'tarefa', 'pessoa', 'empresa', 'amigo', 'amiga', 'colega',
  'chefe', 'dono', 'dona', 'chamado', 'mensagem', 'email', 'e-mail',
  'telefone', 'contato', 'anotacao', 'anotação', 'lembrete', 'nota',
  'compra', 'venda', 'pagamento', 'reunião', 'encontro', 'compromisso',
  // EN pronouns (just in case)
  'i', 'me', 'my', 'mine', 'you', 'your', 'yours',
  'he', 'she', 'it', 'we', 'they', 'them', 'their',
  'someone', 'anyone', 'everyone', 'no one', 'somebody', 'anybody',
  'this', 'that', 'these', 'those', 'thing', 'something', 'anything',
  // EN generic nouns
  'deadline', 'supplier', 'client', 'meeting', 'date', 'time', 'day',
  'place', 'task', 'person', 'company', 'friend', 'boss', 'owner',
  'message', 'email', 'phone', 'contact', 'note', 'payment', 'sale',
]);

/**
 * Drop entity_mentions that are clearly hallucinated:
 * 1. mention_text doesn't appear as substring in the source (after normalization)
 * 2. mention_text is a pronoun or generic noun
 * 3. mention_text is shorter than 2 chars (single letter is noise)
 *
 * This is a SAFETY NET. The primary fix is in the prompt (telling the LLM
 * to be strict). The LLM is the source of truth on whether something IS
 * an entity — this filter only checks whether the LLM's claim is even
 * possible (the word is in the text).
 *
 * Returns the filtered output AND a count of dropped mentions for logging.
 */
export interface SanitizeResultV14 {
  output: ExtractorOutputV14;
  droppedMentions: Array<{
    mention_text: string;
    reason: 'not_in_source' | 'stopword' | 'too_short';
  }>;
}

export function sanitizeV14EntityMentions(
  output: ExtractorOutputV14,
  rawContent: string,
  contextBlock?: string,
): SanitizeResultV14 {
  // The combined source = the inbox raw_content plus the pre-context block
  // (thread context). An entity mentioned in the thread context is still real.
  const combinedSource = normalizeText(
    `${rawContent} ${contextBlock ?? ''}`,
  );

  const droppedMentions: SanitizeResultV14['droppedMentions'] = [];
  const keptMentions = output.entity_mentions.filter((m) => {
    const trimmed = m.mention_text.trim();
    if (trimmed.length < 2) {
      droppedMentions.push({ mention_text: m.mention_text, reason: 'too_short' });
      return false;
    }
    const normalized = normalizeText(trimmed);
    if (NON_ENTITY_STOPWORDS.has(normalized)) {
      droppedMentions.push({ mention_text: m.mention_text, reason: 'stopword' });
      return false;
    }
    // Substring check (case-insensitive, accent-insensitive) against the
    // combined source. If the word isn't in the source at all, the LLM
    // invented it. Drop it.
    if (!combinedSource.includes(normalized)) {
      droppedMentions.push({ mention_text: m.mention_text, reason: 'not_in_source' });
      return false;
    }
    return true;
  });

  return {
    output: { ...output, entity_mentions: keptMentions },
    droppedMentions,
  };
}
