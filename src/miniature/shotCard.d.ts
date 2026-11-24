/** Types for shotCard.js, for the TypeScript pages that show the card (`/map`). */
import type { ShotRow } from './dayShots.js';
export function shotCard(shot: ShotRow, verdict?: { grade: string | null; word: string; label: string } | null, options?: { size?: 'card' | 'row' | 'ticket'; tag?: string; pixels?: [number, number]; day?: string }): HTMLElement;
