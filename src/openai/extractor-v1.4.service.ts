import OpenAI from 'openai';
import { z } from 'zod';
import { loadEnv } from '../config/env.js';
import { log } from '../utils/logger.js';
import {
  EXTRACTOR_V14_PROMPT_VERSION,
  EXTRACTOR_V14_SYSTEM_PROMPT,
  EXTRACTOR_V14_VERSION,
  buildExtractorV14UserMessage,
} from './extractor-v1.4.prompt.js';
import { extractorV14JsonSchema } from './extractor-v1.4.schema.js';
import {
  type ExtractorOutputV14,
  parseExtractorOutputV14,
} from './extractor-v1.4.types.js';

export const OPENAI_V14_REQUEST_TIMEOUT_MS = 120_000;

export type ExtractV14Params = {
  effective_input: string;
  source_channel: string;
  source_mode: string;
  received_at: string;
  timezone: string;
  context_block?: string;
};

export type ExtractV14Fn = (params: ExtractV14Params) => Promise<ExtractorOutputV14>;

export function createOpenAiExtractorV14(): ExtractV14Fn {
  const env = loadEnv();
  const client = new OpenAI({
    apiKey: env.OPENAI_API_KEY,
    timeout: OPENAI_V14_REQUEST_TIMEOUT_MS,
  });

  return async (params) => {
    const userMessage = buildExtractorV14UserMessage(params);

    log('info', 'extractor_v14', {
      step: 'openai_request_start',
      prompt_version: EXTRACTOR_V14_PROMPT_VERSION,
      timeout_ms: OPENAI_V14_REQUEST_TIMEOUT_MS,
    });

    let response: Awaited<ReturnType<typeof client.responses.create>>;
    try {
      response = await client.responses.create({
        model: env.OPENAI_MODEL,
        input: [
          { role: 'system', content: EXTRACTOR_V14_SYSTEM_PROMPT },
          { role: 'user', content: userMessage },
        ],
        text: {
          format: {
            type: 'json_schema',
            name: 'extractor_output_v14',
            schema: extractorV14JsonSchema,
            strict: true,
          },
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log('error', 'extractor_v14', { step: 'openai_request_failed', error: message });
      throw new Error(`OpenAI extractor-v1.4 failed: ${message}`);
    }

    log('info', 'extractor_v14', { step: 'openai_request_done' });

    const text = response.output_text;
    if (!text) {
      throw new Error('OpenAI extractor-v1.4 returned empty output');
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text) as unknown;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Extractor-v1.4 JSON parse failed: ${message}`);
    }

    try {
      const validated = parseExtractorOutputV14(parsed);
      log('info', 'extractor_v14', {
        step: 'structured_output_validated',
        entity_mentions: validated.entity_mentions.length,
        aliases: validated.aliases.length,
        events: validated.events.length,
        task_signals: validated.task_signals.length,
      });
      return validated;
    } catch (err) {
      const message =
        err instanceof z.ZodError
          ? `Extractor-v1.4 validation failed: ${err.message}`
          : err instanceof Error
            ? err.message
            : String(err);
      log('error', 'extractor_v14', { step: 'validation_failed', error: message });
      throw new Error(message);
    }
  };
}

export { EXTRACTOR_V14_VERSION };
