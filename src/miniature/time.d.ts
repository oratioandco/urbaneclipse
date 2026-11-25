/** Types for time.js, for the TypeScript pages that write times as `/plan/` does (`/map`). */
export const uses12h: boolean;
export function formatClock(t: number | Date): string;
export function formatSeconds(t: number | Date): string;
export function formatMinutes(minutes: number, seconds?: boolean): string;
export function weekdayShort(t: number | Date): string;
export function formatDay(day: number | string | Date): string;
export function formatHour(hour: number): string;
export function parseTime(text: string): number | null;
export function formatDistance(metres: number): string;
