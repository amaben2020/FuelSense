/**
 * The trip-segmentation thresholds, as the UI states them.
 *
 * Mirrors `backend/src/features/telemetry/trip-segmentation.service.ts`
 * (`TRIP_BREAK_MS`). Kept here so the explainer cannot quietly drift from the
 * rule it describes — if the server's break changes, this is the one place the
 * copy reads it from.
 */
export const TRIP_BREAK_MINUTES = 30;
