/** Runs the year-long sweep for one street direction off the main thread. */
import { findStreetPasses, type StreetView } from '../lib/streets.js';

interface Request {
  view: Pick<StreetView, 'bearingDeg' | 'skylineDeg' | 'toleranceDeg' | 'from'>;
  start: number;
  end: number;
}

self.onmessage = (ev: MessageEvent<Request>) => {
  const { view, start, end } = ev.data;
  try {
    const passes = [
      ...findStreetPasses(view, 'sun', start, end),
      ...findStreetPasses(view, 'moon', start, end),
    ].sort((a, b) => a.peak - b.peak);
    self.postMessage({ passes });
  } catch (err) {
    self.postMessage({ error: err instanceof Error ? err.message : String(err) });
  }
};
