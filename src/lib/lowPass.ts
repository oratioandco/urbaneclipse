/**
 * Low passes: a disc so near the horizon that the skyline probably hides it. Pure.
 *
 * Panel 05's Fernsehturm calendar tests the tower's own outline and nothing else: no
 * buildings, no trees. The accuracy audit of November 2026 (docs/accuracy-audit-2026-11.md,
 * defect 3) found 60 of the 203 bridge windows with the disc's centre under 0.8 degrees.
 *
 * THE THRESHOLD, and where it comes from:
 *  - Skyline 0.5 deg. The app's own street data (public/streets/berlin.json) gives Frankfurter
 *    Allee looking west from the foot of the Lichtenberger Brücke (52.51167, 13.49556, bearing
 *    279.4 deg, the bridge's line to the tower) a skyline of 0.5 deg.
 *  - Disc radius 0.27 deg (sun 0.262 to 0.271, moon 0.245 to 0.279 over the year).
 *  - So with its centre under 0.5 + 0.27 = 0.77, rounded to 0.8 deg, part of the disc is
 *    already behind the roofs; under 0.5 - 0.27 = 0.23 deg all of it is.
 * This is a likelihood, not a measurement: the building model has not been run for the bridge
 * and nobody has stood there to check. Hence "wahrscheinlich", and the altitude beside it so
 * the photographer can judge.
 */
export const SKYLINE_TOWARD_TOWER_DEG = 0.5;
export const DISC_RADIUS_DEG = 0.27;
/** Below this apparent altitude of the disc's centre a pass counts as low. */
export const LOW_PASS_CENTRE_DEG = 0.8;

/** Whether a pass with the disc's centre at this apparent altitude is probably hidden by buildings. */
export function isLowPass(centreAltitudeDeg: number): boolean {
  return centreAltitudeDeg < LOW_PASS_CENTRE_DEG;
}

/** "0,4°" or "−0,3°": an altitude to a tenth of a degree, written the German way. */
export function formatAltitudeDe(altitudeDeg: number): string {
  const tenths = Math.round(altitudeDeg * 10) / 10;
  const text = Math.abs(tenths).toFixed(1).replace('.', ',');
  return `${tenths < 0 ? '−' : ''}${text}°`;
}

/** The words a low pass carries in the list. */
export function lowPassNote(centreAltitudeDeg: number): string {
  const tenths = Math.round(centreAltitudeDeg * 10) / 10;
  const where = tenths < 0 ? `${formatAltitudeDe(-tenths)} unter dem Horizont` : `${formatAltitudeDe(tenths)} hoch`;
  return `tief, Scheibenmitte ${where} · wahrscheinlich von Häusern verdeckt`;
}
