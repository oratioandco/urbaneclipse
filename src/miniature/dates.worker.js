/** The year-long date searches, off the main thread: a street's henges, or passes behind the landmarks. */
import { getMoonIllumination } from 'suncalc';
import { sampleBody } from '../lib/bodyPosition.ts';
import { MIN_MOON_ILLUMINATION } from '../lib/dailyPaths.ts';
import { findStreetPasses } from '../lib/streets.ts';
import { TARGETS } from './targets.js';
import { findShots } from './towerShots.js';

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
            bodyAt: (body, t) => sampleBody(body, new Date(t), data.lat, data.lon),
            moonLit: (t) => getMoonIllumination(new Date(t)).fraction,
            minMoonLit: MIN_MOON_ILLUMINATION,
          });
    self.postMessage({ id, result });
  } catch (error) {
    self.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
  }
};
