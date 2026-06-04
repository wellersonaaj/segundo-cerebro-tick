import type { TemporalAnchor } from '../../types/memory-compiler-v2.js';

/** Default anchor for offline v1.4 calibration when case file omits temporal_anchor. */
export const CALIBRATION_DEFAULT_TEMPORAL_ANCHOR: TemporalAnchor = {
  receivedAt: '2026-06-03T12:00:00-03:00',
  timezone: 'America/Sao_Paulo',
};
