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
  where?: 'sphere' | 'antenna' | 'viktoria' | 'quadriga';
  /** Set on a shot of the Siegessäule or the Brandenburger Tor: the landmark's id. */
  target?: string;
  /** What such a shot has not been checked against, in two words ("trees unchecked"). */
  caution?: string;
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
  landmarks?: boolean;
  sun?: boolean;
  moon?: boolean;
  seesTower?: ((lat: number, lon: number) => boolean) | null;
}
export const BODY_NAME: Record<Body, string>;
export function computeDayPaths(from: number, shed?: Viewshed | null): DayPath[];
/** A day's passes behind the Viktoria and the quadriga (landmarkShots.js); opaque to the pages. */
export type LandmarkPass = { readonly body: Body };
export function computeLandmarkPasses(from: number, sheds?: Record<string, Viewshed>): LandmarkPass[];
export function collectRows(paths: DayPath[], moments: StreetMoment[], from: number, flags?: ShotFlags, passes?: LandmarkPass[]): ShotRow[];
export function withoutContinued(rows: ShotRow[], from: number, dayBefore?: ShotRow[]): ShotRow[];
export function shotKey(row: ShotRow): string;
export function findShot(rows: ShotRow[], key: string, t: number): ShotRow | null;
export function dayShots(from: number, data?: { shed?: Viewshed | null; views?: StreetView[] }): ShotRow[];
export function streetStatus(row: ShotRow | null | undefined, t: number): { text: string; state: 'now' | 'soon'; body: Body; jumpTo: number | null } | null;
export function towerSeenFrom(shed: Viewshed | null): ((lat: number, lon: number) => boolean) | null;
export function shotStillHeld(row: ShotRow, stoodAt: { x: number; z: number }, here: { x: number; z: number }, t: number): boolean;
