import { assertionKindLabel } from '../audit/assertion-labels.js';
import { extractPeripheralTerms } from '../audit/peripheral-terms.js';
import {
  DEFAULT_AUDIT_LIST_LIMIT,
  mapVisualStatus,
  matchesVisualFilter,
  truncatePreview,
  type VisualStatus,
  type VisualStatusFilter,
  visualStatusLabel,
} from '../audit/visual-status.js';
import { MVP_AUTO_REGISTRY_ENTITY_TYPES } from '../config/mvp-registry-policy.js';
import type { AssertionsAuditRepository } from '../repositories/assertions-audit.repository.js';
import type { ClarificationsRepository } from '../repositories/clarifications.repository.js';
import type { CorrectionsRepository } from '../repositories/corrections.repository.js';
import type { EntitiesRepository } from '../repositories/entities.repository.js';
import type { EventsRepository } from '../repositories/events.repository.js';
import type { ExtractionRunsRepository } from '../repositories/extraction-runs.repository.js';
import type { InboxItemEntitiesRepository } from '../repositories/inbox-item-entities.repository.js';
import type {
  InboxItemRow,
  InboxItemsRepository,
} from '../repositories/inbox-items.repository.js';
import type { TaskAuditRepository } from '../repositories/task-audit.repository.js';

export interface AuditListQuery {
  status?: VisualStatusFilter;
  search?: string;
  limit?: number;
}

export interface AuditListItem {
  id: string;
  raw_content_preview: string;
  source_channel: string;
  received_at: string;
  processing_status: string;
  visual_status: VisualStatus;
  visual_status_label: string;
  pending_clarifications_count: number;
  has_warnings: boolean;
}

export interface AuditEntityItem {
  id: string;
  name: string;
  entity_type: string;
  registry_status: string | null;
}

export interface AuditEventItem {
  id: string;
  title: string;
  event_type: string;
  occurred_at: string | null;
  record_status: string;
}

export interface AuditAssertionItem {
  id: string;
  content: string;
  assertion_kind: string;
  assertion_kind_label: string;
  verification_status: string;
  confidence: number | null;
}

export interface AuditTaskItem {
  id: string;
  title: string;
  description: string | null;
  status: string;
  task_kind: string | null;
  due_at: string | null;
  target: string | null;
  inbox_item_id: string;
  missing_target: boolean;
}

export interface AuditClarificationItem {
  id: string;
  question: string;
  reason: string;
  priority: string;
  blocking_scope: string;
  status: string;
  source_excerpt: string | null;
}

export interface AuditTechnicalDetails {
  run_id: string | null;
  extractor_version: string | null;
  processing_status: string;
  processing_notes: string[];
  warnings: string[];
  metadata: Record<string, unknown> | null;
  parsed_output: Record<string, unknown> | null;
  compiled_output: Record<string, unknown> | null;
}

export interface AuditInboxDetail {
  inbox_item: InboxItemRow;
  entities: AuditEntityItem[];
  peripheral_terms: string[] | null;
  events: AuditEventItem[];
  assertions: AuditAssertionItem[];
  tasks: AuditTaskItem[];
  clarifications: AuditClarificationItem[];
  technical: AuditTechnicalDetails;
  visual_status: VisualStatus;
  visual_status_label: string;
  pending_clarifications_count: number;
  has_warnings: boolean;
}

const MVP_REGISTRY_SET = new Set<string>(MVP_AUTO_REGISTRY_ENTITY_TYPES);

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function pickRunForItem(
  item: InboxItemRow,
  runs: Awaited<ReturnType<ExtractionRunsRepository['listByInboxItem']>>,
) {
  if (item.active_extraction_run_id) {
    const active = runs.find((run) => run.id === item.active_extraction_run_id);
    if (active) return active;
  }
  if (item.latest_extraction_run_id) {
    const latest = runs.find((run) => run.id === item.latest_extraction_run_id);
    if (latest) return latest;
  }
  return runs[0] ?? null;
}

function deriveWarnings(
  item: InboxItemRow,
  run: ReturnType<typeof pickRunForItem>,
): { has_warnings: boolean; warnings: string[] } {
  const warnings: string[] = [];
  if (item.processing_error?.trim()) {
    warnings.push(item.processing_error.trim());
  }
  if (run?.validation_errors) {
    warnings.push(JSON.stringify(run.validation_errors));
  }
  if (run?.error_message?.trim()) {
    warnings.push(run.error_message.trim());
  }
  return { has_warnings: warnings.length > 0, warnings };
}

function deriveProcessingNotes(run: ReturnType<typeof pickRunForItem>): string[] {
  const parsed = asRecord(run?.parsed_output);
  const compiled = asRecord((run as { compiled_output?: unknown } | null)?.compiled_output);
  return [
    ...asStringArray(parsed?.processing_notes),
    ...asStringArray(compiled?.processing_notes),
  ];
}

function deriveCompilerNotes(run: ReturnType<typeof pickRunForItem>): string[] {
  const compiled = asRecord((run as { compiled_output?: unknown } | null)?.compiled_output);
  return asStringArray(compiled?.compilerNotes);
}

export class AuditService {
  constructor(
    private readonly inboxRepo: InboxItemsRepository,
    private readonly clarificationsRepo: ClarificationsRepository,
    private readonly correctionsRepo: CorrectionsRepository,
    private readonly runsRepo: ExtractionRunsRepository,
    private readonly inboxItemEntitiesRepo: InboxItemEntitiesRepository,
    private readonly entitiesRepo: EntitiesRepository,
    private readonly eventsRepo: EventsRepository,
    private readonly assertionsRepo: AssertionsAuditRepository,
    private readonly tasksRepo: TaskAuditRepository,
  ) {}

  async listInboxItems(query: AuditListQuery = {}): Promise<{ items: AuditListItem[] }> {
    const limit = query.limit ?? DEFAULT_AUDIT_LIST_LIMIT;
    const filter = query.status ?? 'todos';
    const rows = await this.inboxRepo.listRecent({ limit, search: query.search });

    const ids = rows.map((row) => row.id);
    const [pendingCounts, correctionInboxIds, correctionRunInboxIds, runsByInbox] =
      await Promise.all([
        this.clarificationsRepo.pendingCountsByInboxIds(ids),
        this.correctionsRepo.inboxIdsWithCorrections(ids),
        this.runsRepo.inboxIdsWithCorrectionRuns(ids),
        this.loadRunsByInbox(ids),
      ]);

    const items: AuditListItem[] = [];
    for (const row of rows) {
      const pending = pendingCounts.get(row.id) ?? 0;
      const run = pickRunForItem(row, runsByInbox.get(row.id) ?? []);
      const { has_warnings } = deriveWarnings(row, run);
      const has_correction =
        correctionInboxIds.has(row.id) || correctionRunInboxIds.has(row.id);
      const visual_status = mapVisualStatus({
        processing_status: row.processing_status,
        pending_clarifications_count: pending,
        has_warnings,
        has_correction,
      });

      if (!matchesVisualFilter(visual_status, filter)) continue;

      items.push({
        id: row.id,
        raw_content_preview: truncatePreview(row.raw_content),
        source_channel: row.source_channel,
        received_at: row.received_at,
        processing_status: row.processing_status,
        visual_status,
        visual_status_label: visualStatusLabel(visual_status),
        pending_clarifications_count: pending,
        has_warnings,
      });
    }

    return { items };
  }

  async getInboxItemDetail(id: string): Promise<AuditInboxDetail | null> {
    const item = await this.inboxRepo.findById(id);
    if (!item) return null;

    const [
      clarifications,
      corrections,
      runs,
      entityLinks,
      events,
      assertions,
      tasks,
    ] = await Promise.all([
      this.clarificationsRepo.listByInboxItem(id),
      this.correctionsRepo.listByInboxItem(id),
      this.runsRepo.listByInboxItem(id),
      this.inboxItemEntitiesRepo.listActiveByInboxItem(id),
      this.eventsRepo.listActiveByInboxItem(id),
      this.assertionsRepo.listActiveByInboxItem(id),
      this.tasksRepo.listByInboxItem(id),
    ]);

    const entities: AuditEntityItem[] = [];
    for (const link of entityLinks) {
      const entity = await this.entitiesRepo.findById(link.entity_id);
      if (!entity) continue;
      if (!MVP_REGISTRY_SET.has(entity.entity_type)) continue;
      entities.push({
        id: entity.id,
        name: entity.name,
        entity_type: entity.entity_type,
        registry_status: entity.registry_status ?? entity.status ?? null,
      });
    }

    const run = pickRunForItem(item, runs);
    const processing_notes = deriveProcessingNotes(run);
    const compilerNotes = deriveCompilerNotes(run);
    const { has_warnings, warnings } = deriveWarnings(item, run);
    const pending_clarifications_count = clarifications.filter((c) => c.status === 'pending').length;
    const has_correction =
      corrections.length > 0 || runs.some((entry) => entry.trigger_type === 'correction');
    const visual_status = mapVisualStatus({
      processing_status: item.processing_status,
      pending_clarifications_count,
      has_warnings,
      has_correction,
    });

    const peripheralTerms = extractPeripheralTerms(processing_notes, compilerNotes);
    const missingTargetIssue = clarifications.some(
      (c) => c.status === 'pending' && c.issue_type === 'missing_task_target',
    );

    return {
      inbox_item: item,
      entities,
      peripheral_terms: peripheralTerms.length ? peripheralTerms : null,
      events: events.map((event) => ({
        id: event.id,
        title: event.description,
        event_type: event.event_type,
        occurred_at: event.occurred_at,
        record_status: event.record_status,
      })),
      assertions: assertions.map((assertion) => ({
        id: assertion.id,
        content: assertion.content,
        assertion_kind: assertion.assertion_kind,
        assertion_kind_label: assertionKindLabel(assertion.assertion_kind),
        verification_status: assertion.verification_status,
        confidence: assertion.confidence,
      })),
      tasks: tasks.map((task) => ({
        id: task.id,
        title: task.title,
        description: task.description,
        status: task.status,
        task_kind: task.task_kind,
        due_at: task.due_at,
        target: task.target,
        inbox_item_id: task.inbox_item_id,
        missing_target: missingTargetIssue,
      })),
      clarifications: clarifications.map((clarification) => ({
        id: clarification.id,
        question: clarification.question,
        reason: clarification.reason,
        priority: clarification.priority,
        blocking_scope: clarification.blocking_scope,
        status: clarification.status,
        source_excerpt: clarification.source_excerpt?.trim() ? clarification.source_excerpt : null,
      })),
      technical: {
        run_id: run?.id ?? null,
        extractor_version: item.extractor_version ?? run?.extractor_version ?? null,
        processing_status: item.processing_status,
        processing_notes,
        warnings,
        metadata: item.metadata ?? null,
        parsed_output: asRecord(run?.parsed_output),
        compiled_output: asRecord((run as { compiled_output?: unknown } | null)?.compiled_output),
      },
      visual_status,
      visual_status_label: visualStatusLabel(visual_status),
      pending_clarifications_count,
      has_warnings,
    };
  }

  private async loadRunsByInbox(
    inboxItemIds: string[],
  ): Promise<Map<string, Awaited<ReturnType<ExtractionRunsRepository['listByInboxItem']>>>> {
    const map = new Map<string, Awaited<ReturnType<ExtractionRunsRepository['listByInboxItem']>>>();
    if (!inboxItemIds.length) return map;

    await Promise.all(
      inboxItemIds.map(async (inboxItemId) => {
        const runs = await this.runsRepo.listByInboxItem(inboxItemId);
        map.set(inboxItemId, runs);
      }),
    );
    return map;
  }
}
