import type { FastifyReply, FastifyRequest } from 'fastify';
import { loadEnv } from './env.js';
import {
  isInternalProcessingConfigured,
  verifyInternalProcessingSecret,
} from './internal-processing.js';

/** Public routes that stay reachable in production without INTERNAL_PROCESSING_SECRET. */
const PUBLIC_ROUTE_RULES: ReadonlyArray<{ method: string; pattern: RegExp }> = [
  { method: 'GET', pattern: /^\/health\/?$/ },
  { method: 'POST', pattern: /^\/webhooks\/telegram\/?$/ },
  { method: 'GET', pattern: /^\/audit\/?$/ },
  { method: 'GET', pattern: /^\/audit\/styles\.css\/?$/ },
  { method: 'GET', pattern: /^\/audit\/app\.js\/?$/ },
];

function normalizePath(url: string): string {
  const path = url.split('?')[0] ?? url;
  if (path.length > 1 && path.endsWith('/')) {
    return path.slice(0, -1);
  }
  return path;
}

export function isProductionRuntime(): boolean {
  return loadEnv().NODE_ENV === 'production';
}

export function isPublicRoute(method: string, url: string): boolean {
  const path = normalizePath(url);
  return PUBLIC_ROUTE_RULES.some(
    (rule) => rule.method === method.toUpperCase() && rule.pattern.test(path),
  );
}

export function isSensitiveInternalRoute(method: string, url: string): boolean {
  return !isPublicRoute(method, url);
}

export function internalApiProtectionRequiredMessage(): string {
  if (!isInternalProcessingConfigured()) {
    return 'Internal API protection is not configured. Set INTERNAL_PROCESSING_SECRET in production.';
  }
  return 'Unauthorized. Provide x-internal-processing-secret header.';
}

/**
 * Production: sensitive routes require INTERNAL_PROCESSING_SECRET via header.
 * Development/test: always allow.
 */
export function enforceInternalApiAccess(req: FastifyRequest, reply: FastifyReply): boolean {
  if (!isProductionRuntime()) {
    return true;
  }

  if (!isSensitiveInternalRoute(req.method, req.url)) {
    return true;
  }

  if (!isInternalProcessingConfigured()) {
    reply.status(503).send({ error: internalApiProtectionRequiredMessage() });
    return false;
  }

  if (!verifyInternalProcessingSecret(req)) {
    reply.status(401).send({ error: internalApiProtectionRequiredMessage() });
    return false;
  }

  return true;
}
