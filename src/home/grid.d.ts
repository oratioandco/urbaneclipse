/** Types for the parts of grid.js that TypeScript pages use. */
import type { ShotRow } from '../miniature/dayShots.js';
export function planLink(shot: ShotRow): string;
export function dayLink(date: string): string;
export function isNight(sunAltitudeDeg: number): boolean;
