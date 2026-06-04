import { randomUUID } from 'node:crypto';
import {
  isAllowedSourceBlockReference,
  SOURCE_BLOCK_RAW,
} from '../openai/source-block-reference.js';

export { SOURCE_BLOCK_RAW };

const SOURCE_BLOCK_LINE_RE =
  /^\[SOURCE_BLOCK:(raw|correction:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\]\s*$/i;

export interface SourceBlockSegment {
  block_id: string;
  body: string;
}

export function formatCorrectionSourceBlock(correctionId: string): string {
  return `[SOURCE_BLOCK:correction:${correctionId}]`;
}

export function buildEffectiveInputWithSourceBlocks(parts: {
  raw_content: string;
  corrections?: Array<{ id: string; correction_text: string }>;
}): string {
  const segments: string[] = [`${SOURCE_BLOCK_RAW}\n${parts.raw_content.trim()}`];
  for (const c of parts.corrections ?? []) {
    const marker = formatCorrectionSourceBlock(c.id);
    const body = c.correction_text.trim().startsWith('[CORREÇÃO]')
      ? c.correction_text.trim()
      : `[CORREÇÃO] ${c.correction_text.trim()}`;
    segments.push(`${marker}\n${body}`);
  }
  return segments.join('\n\n');
}

/** Parse effective input into SOURCE_BLOCK segments (order preserved). */
export function parseSourceBlockSegments(effectiveInput: string): SourceBlockSegment[] {
  const lines = effectiveInput.split('\n');
  const segments: SourceBlockSegment[] = [];
  let currentId: string | null = null;
  let bodyLines: string[] = [];

  const flush = (): void => {
    if (currentId == null) return;
    segments.push({
      block_id: currentId,
      body: bodyLines.join('\n').trim(),
    });
    bodyLines = [];
  };

  for (const line of lines) {
    const match = line.match(SOURCE_BLOCK_LINE_RE);
    if (match) {
      flush();
      currentId = `[SOURCE_BLOCK:${match[1]!.toLowerCase()}]`.replace(
        /correction:([0-9a-f-]+)/i,
        (_, uuid) => `correction:${uuid.toLowerCase()}`,
      );
      if (match[1]!.toLowerCase() === 'raw') {
        currentId = SOURCE_BLOCK_RAW;
      } else {
        currentId = formatCorrectionSourceBlock(match[1]!.slice('correction:'.length));
      }
      continue;
    }
    if (currentId != null) {
      bodyLines.push(line);
    }
  }
  flush();
  return segments;
}

export function listSourceBlockIds(effectiveInput: string): string[] {
  const ids = new Set<string>();
  for (const line of effectiveInput.split('\n')) {
    const match = line.match(SOURCE_BLOCK_LINE_RE);
    if (!match) continue;
    if (match[1]!.toLowerCase() === 'raw') {
      ids.add(SOURCE_BLOCK_RAW);
    } else {
      ids.add(formatCorrectionSourceBlock(match[1]!.slice('correction:'.length)));
    }
  }
  return [...ids];
}

export function assertSourceBlockExists(
  sourceBlockReference: string | null | undefined,
  presentIds: Set<string>,
  field: string,
): void {
  if (sourceBlockReference == null || sourceBlockReference.trim() === '') return;
  if (!isAllowedSourceBlockReference(sourceBlockReference)) {
    throw new Error(`${field}: invalid source_block_reference format`);
  }
  if (!presentIds.has(sourceBlockReference.trim())) {
    throw new Error(
      `${field}: source_block_reference "${sourceBlockReference}" not found in effective input`,
    );
  }
}

export function newCorrectionBlockId(): string {
  return randomUUID();
}
