/**
 * Where a landmark's sphere can be seen from eye height. Pure, no Cesium, no fetch.
 *
 * Built offline by scripts/build_viewshed.py from the LoD2 buildings. It knows nothing
 * about trees or street furniture, so "visible" means no building is in the way.
 */
export const VIEW_BLOCKED = 0;
export const VIEW_VISIBLE = 1;
export const VIEW_BUILDING = 2;

export type ViewState = typeof VIEW_BLOCKED | typeof VIEW_VISIBLE | typeof VIEW_BUILDING;

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

let loading: Promise<Viewshed> | null = null;

/** Fetch once and share. A failure clears the cache so a later attempt can succeed. */
export function loadViewshed(): Promise<Viewshed> {
  loading ??= (async () => {
    const headerResponse = await fetch('/viewshed/fernsehturm.json');
    if (!headerResponse.ok) throw new Error(`viewshed header: HTTP ${headerResponse.status}`);
    const header = (await headerResponse.json()) as ViewshedHeader & { binary: string };
    const dataResponse = await fetch(`/viewshed/${header.binary}`);
    if (!dataResponse.ok) throw new Error(`viewshed data: HTTP ${dataResponse.status}`);
    return decodeViewshed(header, new Uint8Array(await dataResponse.arrayBuffer()));
  })().catch((err: unknown) => {
    loading = null;
    throw err;
  });
  return loading;
}
