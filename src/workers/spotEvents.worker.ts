/** Runs the year-long sweep for one position off the main thread. */
import { FERNSEHTURM } from '../lib/landmarks.js';
import { findSpotEvents } from '../lib/dailyPaths.js';
import type { ObserverGeodetic } from '../lib/silhouette.js';

interface Request {
  id: number;
  observer: ObserverGeodetic;
  start: number;
  end: number;
}

self.onmessage = (ev: MessageEvent<Request>) => {
  const { id, observer, start, end } = ev.data;
  try {
    const sweep = (body: 'sun' | 'moon') =>
      findSpotEvents({
        observer,
        landmark: FERNSEHTURM,
        body,
        start: new Date(start),
        end: new Date(end),
      });
    const events = [...sweep('sun'), ...sweep('moon')].sort((a, b) => a.peak - b.peak);
    self.postMessage({ id, events });
  } catch (err) {
    self.postMessage({ id, error: err instanceof Error ? err.message : String(err) });
  }
};
