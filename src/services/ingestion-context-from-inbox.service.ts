import type { InboxItemRow } from '../repositories/inbox-items.repository.js';
import {
  EMPTY_INGESTION_CONTEXT,
  type IngestionContext,
} from '../types/ingestion-context.js';
import { sourceMetadataFromInboxMetadata } from './ingestion-context-metadata.js';

export function buildIngestionContextFromInboxItem(inbox: InboxItemRow): IngestionContext {
  const sourceMetadata = sourceMetadataFromInboxMetadata(inbox.metadata);
  return {
    ...EMPTY_INGESTION_CONTEXT,
    sourceMetadata,
  };
}
