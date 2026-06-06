import OpenAI from 'openai';
import { z } from 'zod';
import { loadEnv } from '../config/env.js';
import type { ExtractorOutput } from '../types/domain.js';
import { log } from '../utils/logger.js';
import { withRetry } from '../utils/retry.js';
import {
  EXTRACTOR_SYSTEM_PROMPT,
  EXTRACTOR_VERSION,
  buildExtractorUserMessage,
} from './extractor.prompt.js';
import { extractorJsonSchema } from './extractor.schema.js';
import { extractorOutputSchema } from './extractor.types.js';

/** Timeout explícito na chamada OpenAI (smoke/E2E não ficam pendurados indefinidamente). */
export const OPENAI_REQUEST_TIMEOUT_MS = 120_000;

export type ExtractFn = (params: {
  inbox_item_id: string;
  raw_content: string;
  source_channel: string;
  source_mode: string;
  received_at: string;
  timezone: string;
}) => Promise<ExtractorOutput>;

export function createOpenAiExtractor(): ExtractFn {
  const env = loadEnv();
  const client = new OpenAI({
    apiKey: env.OPENAI_API_KEY,
    timeout: OPENAI_REQUEST_TIMEOUT_MS,
  });

  return async (params) => {
    const userMessage = buildExtractorUserMessage(params);

    log('info', 'inbox_flow', {
      step: 'openai_request_start',
      inbox_item_id: params.inbox_item_id,
      timeout_ms: OPENAI_REQUEST_TIMEOUT_MS,
    });

    let response: Awaited<ReturnType<typeof client.responses.create>>;
    try {
      response = await withRetry(
        () =>
          client.responses.create({
            model: env.OPENAI_MODEL,
            input: [
              { role: 'system', content: EXTRACTOR_SYSTEM_PROMPT },
              { role: 'user', content: userMessage },
            ],
            text: {
              format: {
                type: 'json_schema',
                name: 'extractor_output',
                schema: extractorJsonSchema,
                strict: true,
              },
            },
          }),
        {
          maxAttempts: 3,
          baseDelayMs: 1000,
          onRetry: (attempt, err, delay) => {
            log('warn', 'inbox_flow', {
              step: 'openai_request_retry',
              inbox_item_id: params.inbox_item_id,
              attempt,
              delay_ms: delay,
              error: err instanceof Error ? err.message : String(err),
            });
          },
        },
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log('error', 'inbox_flow', {
        step: 'openai_request_failed',
        inbox_item_id: params.inbox_item_id,
        error: message,
      });
      throw new Error(`OpenAI extraction failed: ${message}`);
    }

    log('info', 'inbox_flow', {
      step: 'openai_request_done',
      inbox_item_id: params.inbox_item_id,
    });

    const text = response.output_text;
    if (!text) {
      const err = new Error('OpenAI returned empty output');
      log('error', 'inbox_flow', {
        step: 'openai_empty_output',
        inbox_item_id: params.inbox_item_id,
        error: err.message,
      });
      throw err;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text) as unknown;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log('error', 'inbox_flow', {
        step: 'structured_output_json_parse_failed',
        inbox_item_id: params.inbox_item_id,
        error: message,
      });
      throw new Error(`Extractor JSON parse failed: ${message}`);
    }

    let validated: ExtractorOutput;
    try {
      validated = extractorOutputSchema.parse(parsed) as ExtractorOutput;
    } catch (err) {
      const message =
        err instanceof z.ZodError
          ? `Extractor output validation failed: ${err.message}`
          : err instanceof Error
            ? err.message
            : String(err);
      log('error', 'inbox_flow', {
        step: 'structured_output_validation_failed',
        inbox_item_id: params.inbox_item_id,
        error: message,
      });
      throw new Error(message);
    }

    log('info', 'inbox_flow', {
      step: 'structured_output_validated',
      inbox_item_id: params.inbox_item_id,
      entities: validated.entities.length,
      events: validated.events.length,
      tasks: validated.tasks.length,
    });

    return validated;
  };
}

export { EXTRACTOR_VERSION };
