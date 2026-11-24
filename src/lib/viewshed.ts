/**
 * Where a landmark's sphere can be seen from eye height. Pure, no Cesium, no fetch.
 *
 * Built offline by scripts/build_viewshed.py from the LoD2 buildings. It knows nothing
 * about trees or street furniture, so "visible" means no building is in the way.
 */
export const VIEW_BLOCKED = 0;
export const VIEW_VISIBLE = 1;
export const VIEW_BUILDING = 2;
/**
 * Only in the viewsheds of the low landmarks (Siegessäule, Brandenburger Tor): the figure is
 * in view from here, but the sight line carried on past it ends on a building, so a disc
 * behind the figure would itself be behind houses. Not a place to stand for a shot.
 */
export const VIEW_NO_SKY = 3;

export type ViewState = typeof VIEW_BLOCKED | typeof VIEW_VISIBLE | typeof VIEW_BUILDING | typeof VIEW_NO_SKY;

export interface ViewshedHeader {
  format: string;
  version: number;
  width: number;
  height: number;
  latMin: number;
  lonMin: number;
  dLat: number;
  dLon: number;
}

export interface Viewshed {
  header: ViewshedHeader;
  cells: Uint8Array;
}

/** Expand the packed runs: one byte each, value in the top 2 bits, length - 1 below. */
export function decodeViewshed(header: ViewshedHeader, packed: Uint8Array): Viewshed {
  if (header.format !== 'urban-eclipse-viewshed' || header.version !== 1) {
    throw new Error(`unexpected viewshed format ${header.format} v${header.version}`);
  }
  const total = header.width * header.height;
  const cells = new Uint8Array(total);
  let at = 0;
  for (let i = 0; i < packed.length; i++) {
    const byte = packed[i];
    const length = (byte & 0x3f) + 1;
    if (at + length > total) throw new Error('viewshed data is longer than its grid');
    cells.fill(byte >> 6, at, at + length);
    at += length;
  }
  if (at !== total) throw new Error('viewshed data is truncated');
  return { header, cells };
}

/** The state at a position. Outside the grid there is no data, which reads as blocked. */
export function sampleViewshed(view: Viewshed, lat: number, lon: number): ViewState {
  const { header, cells } = view;
  const row = Math.floor((lat - header.latMin) / header.dLat);
  const col = Math.floor((lon - header.lonMin) / header.dLon);
  if (row < 0 || col < 0 || row >= header.height || col >= header.width) return VIEW_BLOCKED;
  return cells[row * header.width + col] as ViewState;
}

/** How far round a spot the scene's verdict is taken to hold, metres. */
const SCENE_MASK_M = 25;

/**
 * Spots the viewshed calls visible from which the planner's own scene, in full detail, finds
 * the landmark hidden or the shot not where its row says: marked blocked, 25 m round each.
 * The viewshed is LoD2 roofs on a 2.5 m raster over DGM1 ground; the scene has the same
 * buildings as meshes on a terrain of 40 m cells, and the two disagree in places (an
 * embankment the coarse terrain flattens puts the eye metres lower, behind a roof). A row that
 * cannot be opened onto its shot is not listed, so what the scene refuses is taken out here.
 * The spots are measured, not guessed: scripts/adversarial/rows.mjs --mask opens every row of
 * a year and writes down the ones that fail (public/viewshed/<landmark>-scene.json).
 */
export function applySceneMask(view: Viewshed, spots: ReadonlyArray<readonly [number, number]>): Viewshed {
  const { header, cells } = view;
  const reachRows = Math.ceil(SCENE_MASK_M / (header.dLat * 111_320));
  for (const [lat, lon] of spots) {
    const row0 = Math.floor((lat - header.latMin) / header.dLat);
    const col0 = Math.floor((lon - header.lonMin) / header.dLon);
    const metresPerCol = header.dLon * 111_320 * Math.cos((lat * Math.PI) / 180);
    const reachCols = Math.ceil(SCENE_MASK_M / metresPerCol);
    for (let row = row0 - reachRows; row <= row0 + reachRows; row++) {
      for (let col = col0 - reachCols; col <= col0 + reachCols; col++) {
        if (row < 0 || col < 0 || row >= header.height || col >= header.width) continue;
        if (Math.hypot((row - row0) * header.dLat * 111_320, (col - col0) * metresPerCol) > SCENE_MASK_M) continue;
        const i = row * header.width + col;
        if (cells[i] === VIEW_VISIBLE) cells[i] = VIEW_BLOCKED;
      }
    }
  }
  return view;
}

const loading = new Map<string, Promise<Viewshed>>();

/**
 * A landmark's viewshed (`fernsehturm`, `siegessaeule`, `brandenburger-tor`: the files in
 * public/viewshed). Fetched once and shared; a failure clears the cache so a later attempt
 * can succeed.
 */
export function loadViewshed(landmark = 'fernsehturm'): Promise<Viewshed> {
  let pending = loading.get(landmark);
  if (!pending) {
    pending = (async () => {
      const headerResponse = await fetch(`/viewshed/${landmark}.json`);
      if (!headerResponse.ok) throw new Error(`viewshed header: HTTP ${headerResponse.status}`);
      const header = (await headerResponse.json()) as ViewshedHeader & { binary: string; sceneMask?: string };
      const dataResponse = await fetch(`/viewshed/${header.binary}`);
      if (!dataResponse.ok) throw new Error(`viewshed data: HTTP ${dataResponse.status}`);
      const view = decodeViewshed(header, new Uint8Array(await dataResponse.arrayBuffer()));
      // What the planner's scene refuses, where there is such a list (the tower has one).
      const mask = header.sceneMask ? await fetch(`/viewshed/${header.sceneMask}`).then((r) => (r.ok ? r.json() : null), () => null) : null;
      return mask?.spots ? applySceneMask(view, mask.spots) : view;
    })().catch((err: unknown) => {
      loading.delete(landmark);
      throw err;
    });
    loading.set(landmark, pending);
  }
  return pending;
}
