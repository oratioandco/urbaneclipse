/**
 * Rules of spectacle that every list of shots shares, whatever the shot is of: the day's rows
 * (dayShots.js), and through them `/plan/`'s "Next 3 days", the home grid and `/map`. Pure.
 *
 * The moon by day. With the sun more than 6° up the moon is a pale disc in a blue sky: a street
 * henge or a tower pass with it is less of a picture than the same at dusk or at night, and
 * much less than the sun on a figure at golden hour. It counts 0.6 times. "From here" uses the
 * same two numbers from here for its year of dates (fromHere.js `spectacle`).
 */
import { sampleBody } from '../lib/bodyPosition.ts';
import { FERNSEHTURM } from '../lib/landmarks.ts';

/** With the sun this high the moon is a pale disc in a blue sky. */
export const PALE_MOON_SUN_DEG = 6;
/** What a shot with such a moon counts, against the same shot in a dark sky. */
export const PALE_MOON = 0.6;

/** What a shot's score is multiplied by for the light its body stands in at instant `t`. */
export function paleMoon(body, t) {
  if (body !== 'moon') return 1;
  return sampleBody('sun', new Date(t), FERNSEHTURM.lat, FERNSEHTURM.lon).alt > PALE_MOON_SUN_DEG ? PALE_MOON : 1;
}
