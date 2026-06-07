import { z } from 'zod';

// ============================================================================
// ReasonInput — o que passamos pro Reasoner
// ============================================================================

export const PendingClarificationSchema = z.object({
  id: z.string().min(1),
  question: z.string().min(1),
  issue_type: z.string().min(1),
  target_reference: z.string().min(1),
  suggested_answers: z.array(z.string()).default([]),
  source_excerpt: z.string().default(''),
  inbox_item_id: z.string().uuid(),
});

export const ThreadRecentMessageSchema = z.object({
  inbox_item_id: z.string().uuid(),
  raw_content: z.string(),
  created_at: z.string(),
});

export const ThreadSalientEntitySchema = z.object({
  reference: z.string().min(1),
  canonicalName: z.string().nullable(),
  entityType: z.string().nullable(),
});

export const ThreadContextSchema = z.object({
  thread_id: z.string().min(1),
  recentMessages: z.array(ThreadRecentMessageSchema).max(10).default([]),
  salientEntities: z.array(ThreadSalientEntitySchema).default([]),
});

export const ActiveTaskSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1),
  status: z.string().min(1),
  due_at: z.string().nullable(),
  assignee_reference: z.string().nullable(),
  project_reference: z.string().nullable(),
  inbox_item_id: z.string().uuid(),
  created_at: z.string(),
});

export const ReasonInputSchema = z.object({
  currentMessage: z.string().min(1),
  channel: z.enum(['telegram', 'api']),
  receivedAt: z.string().min(1),
  timezone: z.string().min(1),
  pendingClarifications: z.array(PendingClarificationSchema).default([]),
  threadContext: ThreadContextSchema,
  activeTasks: z.array(ActiveTaskSchema).default([]),
});

export type PendingClarification = z.infer<typeof PendingClarificationSchema>;
export type ThreadRecentMessage = z.infer<typeof ThreadRecentMessageSchema>;
export type ThreadSalientEntity = z.infer<typeof ThreadSalientEntitySchema>;
export type ThreadContext = z.infer<typeof ThreadContextSchema>;
export type ActiveTask = z.infer<typeof ActiveTaskSchema>;
export type ReasonInput = z.infer<typeof ReasonInputSchema>;

// ============================================================================
// ReasonOutput — o que o Reasoner devolve
// ============================================================================

export const ReasonDecisionKindSchema = z.enum([
  'pure_reply',
  'new_capture',
  'mixed',
  'update_existing',
  'cancel_pending',
  'unrelated',
]);

export type ReasonDecisionKind = z.infer<typeof ReasonDecisionKindSchema>;

export const ReasonDecisionSchema = z.object({
  kind: ReasonDecisionKindSchema,
  confidence: z.coerce.number().min(0).max(1),
  reasoning: z.string().min(1).max(500),
});

export const ClarifResolutionSchema = z.object({
  clarification_id: z.string().min(1),
  answered: z.boolean(),
  answer: z.string().nullable(),
  confidence: z.coerce.number().min(0).max(1),
});

export type ClarifResolution = z.infer<typeof ClarifResolutionSchema>;

export const TaskUpdateOperationSchema = z.enum([
  'update_due_date',
  'update_assignee',
  'update_status',
  'complete',
  'cancel',
]);

export type TaskUpdateOperation = z.infer<typeof TaskUpdateOperationSchema>;

export const TaskUpdateSchema = z.object({
  task_id: z.string().uuid(),
  operation: TaskUpdateOperationSchema,
  new_value: z.string().nullable(),
  inherit_from_parent: z.boolean().default(false),
  parent_task_id: z.string().uuid().nullable(),
  reasoning: z.string().min(1).max(300),
});

export type TaskUpdate = z.infer<typeof TaskUpdateSchema>;

export const NewCaptureSchema = z.object({
  effective_input: z.string().min(1),
  summary: z.string().min(1).max(300),
});

export type NewCapture = z.infer<typeof NewCaptureSchema>;

export const NewClarificationSchema = z.object({
  question: z.string().min(1),
  target_reference: z.string().min(1),
  issue_type: z.string().min(1),
  suggested_answers: z.array(z.string()).default([]),
  priority: z.coerce.number().min(0).max(100),
  reasoning: z.string().min(1).max(300),
});

export type NewClarification = z.infer<typeof NewClarificationSchema>;

export const ReasonOutputSchema = z.object({
  decision: ReasonDecisionSchema,
  clarif_resolutions: z.array(ClarifResolutionSchema).default([]),
  task_updates: z.array(TaskUpdateSchema).default([]),
  new_capture: NewCaptureSchema.nullable(),
  new_clarifications: z.array(NewClarificationSchema).default([]),
});

export type ReasonOutput = z.infer<typeof ReasonOutputSchema>;

// ============================================================================
// Erros específicos do Reasoner
// ============================================================================

export type ReasonerErrorCode =
  | 'LLM_ERROR'
  | 'PARSE_ERROR'
  | 'SCHEMA_VALIDATION_ERROR'
  | 'SANITY_CHECK_FAILED'
  | 'TIMEOUT';

export class ReasonerError extends Error {
  constructor(
    readonly code: ReasonerErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ReasonerError';
  }
}
