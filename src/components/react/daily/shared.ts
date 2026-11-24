// Times as `/plan/` writes them: the device's own 12 or 24 hours, always Berlin's clock.
import { formatClock } from '../../../miniature/time.js';
import type { Body } from '../../../lib/bodyPosition.js';
import type { OccultationKind } from '../../../lib/occultation.js';

/** A position to preview, optionally at a specific moment. */
export interface SpotTarget {
  lat: number;
  lon: number;
  /** Absent when the user picked a place first and the app has to find its next date. */
  t?: number;
  body: Body;
  label: string;
  viewpointId?: string;
  /** Set when the view looks down a street rather than at the tower. */
  street?: {
    bearingDeg: number;
    skylineDeg: number;
    toleranceDeg: number;
    lengthM: number;
  };
}

export function coverageLabel(kind: OccultationKind, fraction: number): string {
  if (kind === 'full') return 'fully hidden';
  // Rounded down: a sliver of visible disc must not read as fully hidden.
  if (kind === 'partial') return `${Math.floor(fraction * 100)}% hidden`;
  return 'not behind the tower';
}

/** A time of day in Berlin, written as the planner writes it (src/miniature/time.js). */
export const formatTime = (d: Date): string => formatClock(d.getTime());
