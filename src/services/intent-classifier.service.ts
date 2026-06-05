import OpenAI from 'openai';
import { z } from 'zod';
import { loadEnv } from '../config/env.js';
import {
  buildIntentClassifierUserMessage,
  INTENT_CLASSIFIER_SYSTEM_PROMPT,
} from './intent-classifier.prompt.js';

export type Intent = 'save' | 'update' | 'query' | 'command';

export interface IntentResult {
  intent: Intent;
  confidence: number;
  reasoning: string;
  suggested_command?: string;
}

export interface IntentClassifierContext {
  recent_messages?: string[];
  user_id?: string;
}

export interface IntentClassifierLlmClient {
  completeJson(input: {
    model: string;
    system: string;
    user: string;
    maxTokens: number;
  }): Promise<string>;
}

const intentSchema = z.enum(['save', 'update', 'query', 'command']);

const llmResponseSchema = z.object({
  intent: intentSchema,
  confidence: z.coerce.number().min(0).max(1),
  reasoning: z.string().min(1),
  suggested_command: z.string().optional(),
});

const SAFE_FALLBACK: IntentResult = {
  intent: 'save',
  confidence: 0.4,
  reasoning: 'fallback seguro',
};

export class OpenAiIntentClassifierClient implements IntentClassifierLlmClient {
  constructor(private readonly client: OpenAI) {}

  async completeJson(input: {
    model: string;
    system: string;
    user: string;
    maxTokens: number;
  }): Promise<string> {
    const response = await this.client.chat.completions.create({
      model: input.model,
      messages: [
        { role: 'system', content: input.system },
        { role: 'user', content: input.user },
      ],
      response_format: { type: 'json_object' },
      max_completion_tokens: input.maxTokens,
    });
    return response.choices[0]?.message?.content ?? '';
  }
}

export function parseIntentLlmResponse(raw: string): IntentResult | null {
  try {
    const parsed = llmResponseSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return null;
    const result: IntentResult = {
      intent: parsed.data.intent,
      confidence: parsed.data.confidence,
      reasoning: parsed.data.reasoning,
      suggested_command: parsed.data.suggested_command,
    };
    if (result.confidence < 0.5) {
      return { ...SAFE_FALLBACK, reasoning: `low confidence (${result.confidence}): ${result.reasoning}` };
    }
    return result;
  } catch {
    return null;
  }
}

export function applyIntentFallback(result: IntentResult | null, reason: string): IntentResult {
  if (!result) {
    return { ...SAFE_FALLBACK, reasoning: reason };
  }
  return result;
}

export class IntentClassifierService {
  constructor(
    private readonly llm: IntentClassifierLlmClient,
    private readonly model = 'gpt-5-mini',
    private readonly maxTokens = 200,
  ) {}

  async classify(text: string, context?: IntentClassifierContext): Promise<IntentResult> {
    const trimmed = text.trim();
    if (!trimmed) {
      return { ...SAFE_FALLBACK, reasoning: 'mensagem vazia' };
    }

    const commandMatch = trimmed.match(/^\/([a-z0-9_-]+)/i);
    if (commandMatch) {
      return {
        intent: 'command',
        confidence: 0.99,
        reasoning: 'prefixo / detectado',
        suggested_command: `/${commandMatch[1]}`,
      };
    }

    const userMessage = buildIntentClassifierUserMessage(trimmed, context);
    let raw: string;
    try {
      raw = await this.llm.completeJson({
        model: this.model,
        system: INTENT_CLASSIFIER_SYSTEM_PROMPT,
        user: userMessage,
        maxTokens: this.maxTokens,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return applyIntentFallback(null, `llm error: ${message}`);
    }

    const parsed = parseIntentLlmResponse(raw);
    return applyIntentFallback(parsed, 'resposta malformada do classificador');
  }
}

export function createIntentClassifierService(model?: string): IntentClassifierService {
  const env = loadEnv();
  if (!env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY required for intent classifier');
  }
  const client = new OpenAI({ apiKey: env.OPENAI_API_KEY, timeout: 30_000 });
  return new IntentClassifierService(
    new OpenAiIntentClassifierClient(client),
    model ?? env.INTENT_CLASSIFIER_MODEL,
  );
}
