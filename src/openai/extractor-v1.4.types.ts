import { z } from 'zod';
import { assertAllowedSourceBlockReference } from './source-block-reference.js';

const LEGACY_ROOT_KEYS = [
  'inbox_item_id',
  'entities',
  'requires_review',
  'review_reasons',
  'clarification_requests',
  'processing_notes',
  'tasks',
] as const;

export function rejectLegacyExtractorRootFields(value: unknown): void {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return;
  const record = value as Record<string, unknown>;
  for (const key of LEGACY_ROOT_KEYS) {
    if (key in record) {
      throw new Error(`Legacy field not allowed in extractor-v1.4 output: ${key}`);
    }
  }
  if (Array.isArray(record.events)) {
    for (const [i, ev] of record.events.entries()) {
      if (ev && typeof ev === 'object' && 'event_type' in (ev as object)) {
        throw new Error(`Legacy field not allowed: events[${i}].event_type`);
      }
    }
  }
}

/**
 * Canonical entity types for extractor-v1.4 output.
 * Single source of truth — both the Zod validator (below) and the JSON Schema
 * (src/openai/extractor-v1.4.schema.ts) MUST derive their enums from this list.
 *
 * Types that DO NOT enter the automatic registry (per mvp-registry-policy) are
 * included here on purpose: 'temporal' and 'measurement' are valid context
 * signals the LLM is prompted to emit, and they are filtered out downstream by
 * `isMvpAutoRegistryEntityType` before any DB write.
 */
export const EXTRACTOR_V14_ENTITY_TYPES = [
  'person',
  'company',
  'project',
  'product',
  'topic',
  'document',
  'location',
  'temporal',
  'measurement',
  'other',
] as const;

export type ExtractorV14EntityType = (typeof EXTRACTOR_V14_ENTITY_TYPES)[number];

const entityTypeEnum = z.enum(EXTRACTOR_V14_ENTITY_TYPES);

const extractedEntityMentionSchema = z.object({
  mention_text: z.string().min(1),
  suggested_entity_type: entityTypeEnum,
  source_excerpt: z.string(),
  confidence: z.number().min(0).max(1),
});

const extractedAliasSchema = z.object({
  alias: z.string().min(1),
  target_reference: z.string().min(1),
  negated_former_references: z.array(z.string()),
  source_excerpt: z.string(),
  confidence: z.number().min(0).max(1),
});

const eventKindEnum = z.enum([
  'meeting',
  'confirmation',
  'decision',
  'document_sent',
  'presentation',
  'commitment',
  'change',
  'correction',
  'other',
]);

const eventRelationTypeEnum = z.enum([
  'participant',
  'subject',
  'mentioned',
  'sender',
  'recipient',
  'other',
]);

const extractedEventEntityReferenceSchema = z.object({
  entity_reference: z.string().min(1),
  relation_type: eventRelationTypeEnum,
  role: z.string().nullable(),
});

const extractedEventSchema = z.object({
  event_kind: eventKindEnum,
  title: z.string(),
  source_excerpt: z.string(),
  occurred_at: z.string().nullable(),
  episodic_confidence: z.number().min(0).max(1),
  related_entities: z.array(extractedEventEntityReferenceSchema),
});

const correctionTypeEnum = z.enum([
  'replace_subject',
  'replace_object',
  'invalidate_assertion',
  'invalidate_alias',
  'other',
]);

const extractedCorrectionSignalSchema = z
  .object({
    correction_type: correctionTypeEnum,
    previous_reference: z.string().nullable(),
    current_reference: z.string().nullable(),
    source_excerpt: z.string(),
    source_block_reference: z.string().nullable(),
    confidence: z.number().min(0).max(1),
  })
  .superRefine((data, ctx) => {
    try {
      assertAllowedSourceBlockReference(data.source_block_reference, 'correction_signals');
    } catch (e) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: e instanceof Error ? e.message : String(e),
      });
    }
  });

const assertionKindEnum = z.enum([
  'fact',
  'hypothesis',
  'opinion',
  'decision',
  'commitment',
  'status_update',
  'other',
]);

const extractedAssertionSchema = z
  .object({
    assertion_kind: assertionKindEnum,
    subject_reference: z.string().min(1),
    predicate: z.string().min(1),
    object_reference: z.string().nullable(),
    value_text: z.string().nullable(),
    related_entity_references: z.array(z.string()),
    source_excerpt: z.string(),
    source_block_reference: z.string().nullable(),
    confidence: z.number().min(0).max(1),
  })
  .superRefine((data, ctx) => {
    try {
      assertAllowedSourceBlockReference(data.source_block_reference, 'assertions');
    } catch (e) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: e instanceof Error ? e.message : String(e),
      });
    }
  });

export const taskOperationEnum = z.enum([
  'create',
  'update_status',
  'update_due_date',
  'update_assignee',
  'update_blocker',
  'complete',
  'cancel',
]);

const nullableTaskKindEnum = z.enum([
  'follow_up',
  'delivery',
  'decision',
  'review',
  'external_action',
  'other',
]).nullable();

const nullableTaskStatusSignalEnum = z.enum([
  'open',
  'completed',
  'cancelled',
  'blocked',
  'unknown',
]).nullable();

function requireField(
  data: Record<string, unknown>,
  field: string,
  ctx: z.RefinementCtx,
  message: string,
): boolean {
  const val = data[field];
  if (val == null || (typeof val === 'string' && val.trim() === '')) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message, path: [field] });
    return false;
  }
  return true;
}

export const extractedTaskSignalSchema = z
  .object({
    operation: taskOperationEnum,
    task_reference: z.string().nullable(),
    title: z.string().nullable(),
    task_kind: nullableTaskKindEnum,
    status_signal: nullableTaskStatusSignalEnum,
    assignee_reference: z.string().nullable(),
    target_reference: z.string().nullable(),
    project_reference: z.string().nullable(),
    due_at: z.string().nullable(),
    blocked_reason: z.string().nullable(),
    source_excerpt: z.string(),
    source_block_reference: z.string().nullable(),
    confidence: z.number().min(0).max(1),
  })
  .superRefine((data, ctx) => {
    try {
      assertAllowedSourceBlockReference(data.source_block_reference, 'task_signals');
    } catch (e) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: e instanceof Error ? e.message : String(e),
        path: ['source_block_reference'],
      });
    }

    const d = data as Record<string, unknown>;
    switch (data.operation) {
      case 'create':
        requireField(d, 'title', ctx, 'create requires title');
        break;
      case 'update_status':
        requireField(d, 'task_reference', ctx, 'update_status requires task_reference');
        if (data.status_signal == null) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'update_status requires status_signal',
            path: ['status_signal'],
          });
        }
        break;
      case 'update_due_date':
        requireField(d, 'task_reference', ctx, 'update_due_date requires task_reference');
        requireField(d, 'due_at', ctx, 'update_due_date requires due_at');
        break;
      case 'update_assignee':
        requireField(d, 'task_reference', ctx, 'update_assignee requires task_reference');
        requireField(d, 'assignee_reference', ctx, 'update_assignee requires assignee_reference');
        break;
      case 'update_blocker':
        requireField(d, 'task_reference', ctx, 'update_blocker requires task_reference');
        requireField(d, 'blocked_reason', ctx, 'update_blocker requires blocked_reason');
        break;
      case 'complete':
        requireField(d, 'task_reference', ctx, 'complete requires task_reference');
        if (data.status_signal != null && data.status_signal !== 'completed') {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'complete requires status_signal completed or null',
            path: ['status_signal'],
          });
        }
        break;
      case 'cancel':
        requireField(d, 'task_reference', ctx, 'cancel requires task_reference');
        if (data.status_signal != null && data.status_signal !== 'cancelled') {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'cancel requires status_signal cancelled or null',
            path: ['status_signal'],
          });
        }
        break;
    }
  });

/** Canonical clarification issue types for extractor-v1.4 clarification_candidates. */
export const CLARIFICATION_ISSUE_TYPES = [
  'ambiguous_identity',
  'ambiguous_entity_type',
  'ambiguous_task_reference',
  'missing_task_reference',
  'missing_due_date',
  'missing_assignee',
  'missing_assignee_or_due_date',
  'ambiguous_date',
  'unclear_scope',
  'missing_external_action_target',
  'possible_contradiction',
  'other',
] as const;

export const clarificationIssueTypeEnum = z.enum(CLARIFICATION_ISSUE_TYPES);
export type ClarificationIssueType = z.infer<typeof clarificationIssueTypeEnum>;

const clarificationCandidateSchema = z
  .object({
    target_type: z.enum(['entity', 'event', 'assertion', 'task', 'external_action', 'other']),
    target_reference: z.string().min(1),
    issue_type: clarificationIssueTypeEnum,
    question: z.string(),
    reason: z.string(),
    priority: z.enum(['low', 'medium', 'high']),
    blocking_scope: z.enum([
      'none',
      'knowledge_confirmation',
      'task_execution',
      'external_action',
    ]),
    suggested_answers: z.array(z.string()),
    source_excerpt: z.string(),
    source_block_reference: z.string().nullable(),
    confidence: z.number().min(0).max(1),
  })
  .superRefine((data, ctx) => {
    try {
      assertAllowedSourceBlockReference(
        data.source_block_reference,
        'clarification_candidates',
      );
    } catch (e) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: e instanceof Error ? e.message : String(e),
      });
    }
  });

const reviewHintIssueTypeEnum = z.enum([
  'ambiguous_identity',
  'ambiguous_entity_type',
  'possible_contradiction',
  'low_confidence_event',
  'unresolved_reference',
  'other',
]);

const reviewHintSchema = z.object({
  issue_type: reviewHintIssueTypeEnum,
  target_reference: z.string().nullable(),
  reason: z.string(),
  source_excerpt: z.string(),
  confidence: z.number().min(0).max(1),
});

export const extractorOutputV14Schema = z.object({
  schema_version: z.literal('1.4'),
  entity_mentions: z.array(extractedEntityMentionSchema),
  aliases: z.array(extractedAliasSchema),
  events: z.array(extractedEventSchema),
  correction_signals: z.array(extractedCorrectionSignalSchema),
  assertions: z.array(extractedAssertionSchema),
  task_signals: z.array(extractedTaskSignalSchema),
  clarification_candidates: z.array(clarificationCandidateSchema),
  review_hints: z.array(reviewHintSchema),
  extraction_notes: z.array(z.string()),
});

export type ExtractorOutputV14 = z.infer<typeof extractorOutputV14Schema>;
export type TaskOperation = z.infer<typeof taskOperationEnum>;
export type ExtractedTaskSignal = z.infer<typeof extractedTaskSignalSchema>;
export type ExtractedEntityMention = z.infer<typeof extractedEntityMentionSchema>;
export type ExtractedAlias = z.infer<typeof extractedAliasSchema>;
export type ExtractedEvent = z.infer<typeof extractedEventSchema>;
export type ExtractedEventEntityReference = z.infer<typeof extractedEventEntityReferenceSchema>;
export type ExtractedCorrectionSignal = z.infer<typeof extractedCorrectionSignalSchema>;
export type ExtractedAssertion = z.infer<typeof extractedAssertionSchema>;
export type ClarificationCandidate = z.infer<typeof clarificationCandidateSchema>;
export type ReviewHint = z.infer<typeof reviewHintSchema>;

export function parseExtractorOutputV14(value: unknown): ExtractorOutputV14 {
  rejectLegacyExtractorRootFields(value);
  const sanitized = sanitizeEntityTypes(value);
  return extractorOutputV14Schema.parse(sanitized);
}

/**
 * Defense in depth: if the LLM emits a `suggested_entity_type` outside the
 * canonical enum (e.g. a future model version invents a new category before we
 * update EXTRACTOR_V14_ENTITY_TYPES), coerce to 'other' and log a warning
 * instead of failing the whole extraction. Downstream code (memory-compiler-v2)
 * already drops non-registry types, so the system stays consistent.
 *
 * Sanitization runs BEFORE the Zod parse so the schema accepts the result
 * (the coerce-on-output approach in earlier versions could not run because
 * ZodError aborted the parse).
 */
function sanitizeEntityTypes(value: unknown): unknown {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  const mentions = record.entity_mentions;
  if (!Array.isArray(mentions)) return value;

  const allowed = new Set<string>(EXTRACTOR_V14_ENTITY_TYPES);
  const clonedMentions: unknown[] = [];

  for (let i = 0; i < mentions.length; i++) {
    const m = mentions[i];
    if (m == null || typeof m !== 'object' || Array.isArray(m)) {
      clonedMentions.push(m);
      continue;
    }
    const mentionRecord = m as Record<string, unknown>;
    const type = mentionRecord.suggested_entity_type;
    if (typeof type === 'string' && !allowed.has(type)) {
      // eslint-disable-next-line no-console
      console.warn(
        `[extractor-v1.4] unknown suggested_entity_type "${type}" for mention "${mentionRecord.mention_text}" — coercing to "other"`,
      );
      clonedMentions.push({ ...mentionRecord, suggested_entity_type: 'other' });
    } else {
      clonedMentions.push(m);
    }
  }

  return { ...record, entity_mentions: clonedMentions };
}
