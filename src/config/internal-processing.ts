import type { FastifyRequest } from 'fastify';
import { loadEnv } from './env.js';

export const INTERNAL_PROCESSING_SECRET_HEADER = 'x-internal-processing-secret';

export function getInternalProcessingSecret(): string | null {
  const secret = loadEnv().INTERNAL_PROCESSING_SECRET?.trim();
  return secret ? secret : null;
}

export function isInternalProcessingConfigured(): boolean {
  return getInternalProcessingSecret() != null;
}

export function readInternalProcessingSecret(req: FastifyRequest): string | undefined {
  const header = req.headers[INTERNAL_PROCESSING_SECRET_HEADER];
  if (typeof header === 'string' && header.trim()) {
    return header.trim();
  }
  return undefined;
}

export function verifyInternalProcessingSecret(req: FastifyRequest): boolean {
  const expected = getInternalProcessingSecret();
  if (!expected) {
    return false;
  }
  const received = readInternalProcessingSecret(req);
  return received != null && received === expected;
}
