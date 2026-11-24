/** The year-long date searches, off the main thread: a street's henges, or passes behind the landmarks. */
import { getMoonIllumination } from 'suncalc';
import { sampleBody } from '../lib/bodyPosition.ts';
import { MIN_MOON_ILLUMINATION } from '../lib/dailyPaths.ts';
import { findStreetPasses } from '../lib/streets.ts';
import { TARGETS } from './targets.js';
import { findShots } from './towerShots.js';

/**
 * `bodyAt` for the search, saying how far the search is as it is asked: findShots sweeps the
 * year once for each landmark and body, in time order, so the instants asked for tell how much
 * of the `sweeps` is behind it. Posts `{ id, progress }` (0 to 1) a hundred times at most.
 */
function watched(id, start, end, sweeps, bodyAt) {
  let sweep = 0;
  let last = -Infinity;
  let said = 0;
  return (body, t) => {
    // A step back by more than a day is the next sweep starting over at the year's start.
    if (t < last - 86_400_000) sweep++;
    last = t;
    const share = Math.min(1, (sweep + (t - start) / (end - start)) / sweeps);
    if (share - said >= 0.01) self.postMessage({ id, progress: (said = share) });
    return bodyAt(body, t);
  };
}

self.onmessage = ({ data }) => {
  const { id, kind, start, end } = data;
  try {
    const result =
      kind === 'street'
        ? [...findStreetPasses(data.view, 'sun', start, end), ...findStreetPasses(data.view, 'moon', start, end)].sort((a, b) => a.peak - b.peak)
        : findShots({
            eye: data.eye,
            base: data.base,
            start,
            end,
            targets: TARGETS,
            bodyAt: watched(id, start, end, TARGETS.length * 2, (body, t) => sampleBody(body, new Date(t), data.lat, data.lon)),
            moonLit: (t) => getMoonIllumination(new Date(t)).fraction,
            minMoonLit: MIN_MOON_ILLUMINATION,
            northOffsetDeg: data.northOffsetDeg ?? 0,
          });
    self.postMessage({ id, result });
  } catch (error) {
    self.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
  }
};
