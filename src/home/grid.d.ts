/** Types for the parts of grid.js that TypeScript pages use. */
import type { ShotRow } from '../miniature/dayShots.js';
export function planLink(shot: ShotRow): string;
export function dayLink(date: string): string;
export function isNight(sunAltitudeDeg: number): boolean;
export const DAY_BEST: number;
export function bestOf<T extends { shot: { score?: number; t: number } }>(rated: T[], count?: number): T[];
