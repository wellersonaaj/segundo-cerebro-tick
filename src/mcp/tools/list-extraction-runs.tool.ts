import { z } from 'zod';
import type { ExtractionRunsRepository } from '../../repositories/extraction-runs.repository.js';
import type { InboxItemEntitiesRepository } from '../../repositories/inbox-item-entities.repository.js';
import type { EntitiesRepository } from '../../repositories/entities.repository.js';
import type { InboxItemEntity } from '../../types/domain.js';

export const listInboxExtractionRunsInputSchema = z.object({
  inbox_item_id: z.string().uuid(),
});

export async function listInboxExtractionRuns(
  runsRepo: ExtractionRunsRepository,
  input: z.infer<typeof listInboxExtractionRunsInputSchema>,
) {
  const runs = await runsRepo.listByInboxItem(input.inbox_item_id);
  return { inbox_item_id: input.inbox_item_id, runs };
}

export const listInboxItemEntitiesInputSchema = z.object({
  inbox_item_id: z.string().uuid(),
});

export async function listInboxItemEntities(
  iieRepo: InboxItemEntitiesRepository,
  entitiesRepo: EntitiesRepository,
  input: z.infer<typeof listInboxItemEntitiesInputSchema>,
) {
  const links = await iieRepo.listActiveByInboxItem(input.inbox_item_id);
  const entities = await Promise.all(
    links.map(async (link: InboxItemEntity) => ({
      ...link,
      entity: await entitiesRepo.findById(link.entity_id),
    })),
  );
  return { inbox_item_id: input.inbox_item_id, entities };
}
