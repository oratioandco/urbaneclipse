/** Types for dayShots.js, for the TypeScript pages that list the same shots (`/map`). */
import type { Body } from '../lib/bodyPosition.js';
import type { DayPath } from '../lib/dailyPaths.js';
import type { StreetMoment, StreetView } from '../lib/streets.js';
import type { Viewshed } from '../lib/viewshed.js';

export interface ShotRow {
  t: number;
  start?: number;
  until?: number;
  body: Body;
  kind: 'tower' | 'street';
  where?: 'sphere' | 'antenna';
  short: string;
  stand?: string;
  brief: string;
  title: string;
  detail: string;
  distanceM: number;
  score: number;
  openAt: number;
  at: [number, number] | null;
  look: [number, number];
  lens: number;
  moment?: StreetMoment;
}
export interface ShotFlags {
  tower?: boolean;
  streets?: boolean;
  sun?: boolean;
  moon?: boolean;
}
export const BODY_NAME: Record<Body, string>;
export function computeDayPaths(from: number, shed?: Viewshed | null): DayPath[];
export function collectRows(paths: DayPath[], moments: StreetMoment[], from: number, flags?: ShotFlags): ShotRow[];
export function withoutContinued(rows: ShotRow[], from: number, dayBefore?: ShotRow[]): ShotRow[];
export function shotKey(row: ShotRow): string;
export function findShot(rows: ShotRow[], key: string, t: number): ShotRow | null;
export function dayShots(from: number, data?: { shed?: Viewshed | null; views?: StreetView[] }): ShotRow[];
export function streetStatus(row: ShotRow | null | undefined, t: number): { text: string; state: 'now' | 'soon'; body: Body; jumpTo: number | null } | null;
