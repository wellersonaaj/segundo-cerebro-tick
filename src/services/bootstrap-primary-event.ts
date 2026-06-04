import type { ExtractedEvent } from '../types/domain.js';
import { log } from '../utils/logger.js';

export const BOOTSTRAP_SOURCE_CHANNEL = 'bootstrap';

export type BootstrapPrimaryEventStrategy =
  | 'single_event'
  | 'document_snapshot'
  | 'profile_created'
  | 'highest_confidence'
  | 'first_persisted';

export interface PersistedEventRef {
  id: string;
  event_type: string;
  confidence: number;
  index: number;
}

export interface BootstrapPrimaryEventSelection {
  eventId: string;
  eventType: string;
  strategy: BootstrapPrimaryEventStrategy;
}

const PRIMARY_EVENT_TYPE_PRIORITY: Array<{ type: string; strategy: BootstrapPrimaryEventStrategy }> =
  [
    { type: 'document_snapshot', strategy: 'document_snapshot' },
    { type: 'profile_created', strategy: 'profile_created' },
  ];

export function selectBootstrapPrimaryEvent(
  events: readonly PersistedEventRef[],
): BootstrapPrimaryEventSelection | null {
  if (!events.length) return null;

  if (events.length === 1) {
    const only = events[0]!;
    return {
      eventId: only.id,
      eventType: only.event_type,
      strategy: 'single_event',
    };
  }

  for (const { type, strategy } of PRIMARY_EVENT_TYPE_PRIORITY) {
    const match = events.find((e) => e.event_type === type);
    if (match) {
      return { eventId: match.id, eventType: match.event_type, strategy };
    }
  }

  const maxConfidence = Math.max(...events.map((e) => e.confidence));
  const topCandidates = events.filter((e) => e.confidence === maxConfidence);

  if (topCandidates.length === 1) {
    const chosen = topCandidates[0]!;
    return {
      eventId: chosen.id,
      eventType: chosen.event_type,
      strategy: 'highest_confidence',
    };
  }

  const first = [...topCandidates].sort((a, b) => a.index - b.index)[0]!;
  return {
    eventId: first.id,
    eventType: first.event_type,
    strategy: 'first_persisted',
  };
}

export function logBootstrapPrimaryEventSelected(
  inboxItemId: string,
  selection: BootstrapPrimaryEventSelection,
  entitiesLinked: number,
): void {
  log('info', 'bootstrap_primary_event_selected', {
    inbox_item_id: inboxItemId,
    event_id: selection.eventId,
    event_type: selection.eventType,
    strategy: selection.strategy,
    entities_linked: entitiesLinked,
  });
}

export function isBootstrapSourceChannel(sourceChannel: string): boolean {
  return sourceChannel === BOOTSTRAP_SOURCE_CHANNEL;
}

/** @internal test helper */
export function eventRefFromExtracted(
  id: string,
  extracted: ExtractedEvent,
  index: number,
): PersistedEventRef {
  return {
    id,
    event_type: extracted.event_type,
    confidence: extracted.confidence,
    index,
  };
}
