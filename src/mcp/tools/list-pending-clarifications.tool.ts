import { z } from 'zod';
import type { ClarificationService } from '../../services/clarification.service.js';

export const listPendingClarificationsInputSchema = z.object({
  limit: z.number().int().positive().max(50).optional().default(10),
});

export async function listPendingClarifications(
  clarifications: ClarificationService,
  input: z.infer<typeof listPendingClarificationsInputSchema>,
) {
  const items = await clarifications.listPending(input.limit);
  return { clarifications: items };
}
