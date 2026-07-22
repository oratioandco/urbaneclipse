/**
 * Browser-side loader for the committed DGM1 heightmap.
 *
 * Split from src/lib/heightmap.ts so the sampling math stays pure and Node-testable;
 * this file owns only the fetch and the wiring.
 *
 * Failure is explicit, never silent: if the grid cannot be loaded the caller gets a
 * null sampler and a reason to surface. Falling back quietly would reintroduce exactly
 * the kind of invisible elevation error this subsystem exists to prevent — the app
 * would keep drawing a confident sightline computed from the wrong ground.
 */
import {
  createHeightmap,
  decodeSamples,
  sampleGroundOrthometric,
  type HeightmapHeader,
} from '../lib/heightmap.js';
import type { SampleGround } from '../lib/sceneHeights.js';

export interface HeightmapLoadResult {
  /** Ground sampler, or null when the heightmap could not be loaded. */
  sampleGround: SampleGround | null;
  /** Human-readable failure reason, present only on failure. */
  error?: string;
}

const DEFAULT_BASE = '/heightmap/berlin-dgm1';

/**
 * Fetch and decode the heightmap.
 *
 * @param base URL prefix for the `.json` header and `.bin` payload.
 * @param fetchImpl Injectable for testing.
 */
export async function loadHeightmap(
  base: string = DEFAULT_BASE,
  fetchImpl: typeof fetch = fetch,
): Promise<HeightmapLoadResult> {
  try {
    const [headerRes, binRes] = await Promise.all([
      fetchImpl(`${base}.json`),
      fetchImpl(`${base}.bin`),
    ]);

    if (!headerRes.ok) {
      return { sampleGround: null, error: `${base}.json — HTTP ${headerRes.status}` };
    }
    if (!binRes.ok) {
      return { sampleGround: null, error: `${base}.bin — HTTP ${binRes.status}` };
    }

    const header = (await headerRes.json()) as HeightmapHeader;
    const buffer = await binRes.arrayBuffer();

    // createHeightmap validates header-vs-payload, so a truncated or mismatched
    // download surfaces here rather than as quietly wrong elevations.
    const map = createHeightmap(header, decodeSamples(buffer));

    return {
      sampleGround: (lat: number, lon: number) => sampleGroundOrthometric(map, lat, lon),
    };
  } catch (err) {
    return {
      sampleGround: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
