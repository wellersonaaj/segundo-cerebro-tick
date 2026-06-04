import type { ProcessingStatus } from '../types/domain.js';

export type VisualStatus = 'processado' | 'revisar' | 'falhou' | 'corrigido';

export type VisualStatusFilter = 'todos' | 'revisar' | 'falhas';

export interface VisualStatusInput {
  processing_status: ProcessingStatus;
  pending_clarifications_count: number;
  has_warnings: boolean;
  has_correction: boolean;
}

export function mapVisualStatus(input: VisualStatusInput): VisualStatus {
  if (input.processing_status === 'failed') {
    return 'falhou';
  }
  if (
    input.pending_clarifications_count > 0 ||
    input.has_warnings ||
    input.processing_status === 'pending' ||
    input.processing_status === 'processing'
  ) {
    return 'revisar';
  }
  if (input.has_correction) {
    return 'corrigido';
  }
  return 'processado';
}

export function matchesVisualFilter(
  visualStatus: VisualStatus,
  filter: VisualStatusFilter,
): boolean {
  if (filter === 'todos') return true;
  if (filter === 'revisar') return visualStatus === 'revisar';
  return visualStatus === 'falhou';
}

export function visualStatusLabel(status: VisualStatus): string {
  switch (status) {
    case 'processado':
      return 'Processado';
    case 'revisar':
      return 'Revisar';
    case 'falhou':
      return 'Falhou';
    case 'corrigido':
      return 'Corrigido';
  }
}

export const DEFAULT_AUDIT_LIST_LIMIT = 100;

export function truncatePreview(rawContent: string, maxLength = 120): string {
  if (rawContent.length <= maxLength) return rawContent;
  return `${rawContent.slice(0, maxLength)}…`;
}
