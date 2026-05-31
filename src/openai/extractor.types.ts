import { z } from 'zod';

const extractedEntitySchema = z.object({
  name: z.string(),
  entity_type: z.enum([
    'person',
    'company',
    'project',
    'product',
    'topic',
    'document',
    'location',
    'other',
  ]),
  source_excerpt: z.string(),
  confidence: z.number(),
});

const extractedEventSchema = z.object({
  event_type: z.string(),
  description: z.string(),
  occurred_at: z.string().nullable(),
  source_excerpt: z.string(),
  confidence: z.number(),
  entity_names: z.array(z.string()).default([]),
});

const extractedAssertionSchema = z.object({
  assertion_type: z.enum([
    'fact',
    'hypothesis',
    'opinion',
    'decision',
    'commitment',
    'question',
    'assumption',
    'recommendation',
  ]),
  content: z.string(),
  status: z.enum([
    'unverified',
    'supported',
    'confirmed',
    'contested',
    'invalidated',
    'superseded',
  ]),
  source_excerpt: z.string(),
  confidence: z.number(),
});

const extractedTaskSchema = z.object({
  title: z.string(),
  description: z.string().nullable(),
  due_at: z.string().nullable(),
  temporal_reference_text: z.string().nullable(),
  source_excerpt: z.string(),
  confidence: z.number(),
  is_commitment: z.boolean().default(false),
});

const extractedClarificationSchema = z.object({
  target_type: z.enum(['entity', 'event', 'assertion', 'task', 'external_action', 'other']),
  target_reference: z.string(),
  issue_type: z.enum([
    'ambiguous_entity_type',
    'ambiguous_entity_identity',
    'missing_task_target',
    'missing_external_action_target',
    'missing_date',
    'missing_context',
    'other',
  ]),
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
});

export const extractorOutputSchema = z.object({
  schema_version: z.string(),
  inbox_item_id: z.string().uuid(),
  events: z.array(extractedEventSchema),
  entities: z.array(extractedEntitySchema),
  assertions: z.array(extractedAssertionSchema),
  tasks: z.array(extractedTaskSchema),
  clarification_requests: z.array(extractedClarificationSchema),
  requires_review: z.boolean(),
  review_reasons: z.array(z.string()),
  processing_notes: z.array(z.string()),
});

export type ExtractorOutputValidated = z.infer<typeof extractorOutputSchema>;
