import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { STRAUSBERGER_PLATZ, WEBERWIESE } from '../../src/lib/viewpoints';
import {
  VIEW_BLOCKED,
  VIEW_BUILDING,
  VIEW_VISIBLE,
  applySceneMask,
  decodeViewshed,
  sampleViewshed,
  type ViewshedHeader,
} from '../../src/lib/viewshed';

const header: ViewshedHeader = {
  format: 'urban-eclipse-viewshed',
  version: 1,
  width: 3,
  height: 2,
  latMin: 52,
  lonMin: 13,
  dLat: 0.1,
  dLon: 0.1,
};
const run = (value: number, length: number) => (value << 6) | (length - 1);

describe('decodeViewshed', () => {
  it('expands runs in row order, south to north', () => {
    const view = decodeViewshed(header, Uint8Array.of(run(1, 2), run(2, 3), run(0, 1)));
    expect([...view.cells]).toEqual([1, 1, 2, 2, 2, 0]);
    expect(sampleViewshed(view, 52.05, 13.05)).toBe(VIEW_VISIBLE);
    expect(sampleViewshed(view, 52.15, 13.05)).toBe(VIEW_BUILDING);
    expect(sampleViewshed(view, 52.15, 13.25)).toBe(VIEW_BLOCKED);
  });

  it('reads outside the grid as blocked', () => {
    const view = decodeViewshed(header, Uint8Array.of(run(1, 6)));
    expect(sampleViewshed(view, 51, 13.05)).toBe(VIEW_BLOCKED);
    expect(sampleViewshed(view, 52.05, 14)).toBe(VIEW_BLOCKED);
  });

  it('rejects truncated, overlong and unknown data', () => {
    expect(() => decodeViewshed(header, Uint8Array.of(run(1, 2)))).toThrow(/truncated/);
    expect(() => decodeViewshed(header, Uint8Array.of(run(1, 7)))).toThrow(/longer/);
    expect(() => decodeViewshed({ ...header, version: 2 }, new Uint8Array())).toThrow(/format/);
  });
});

describe('the shipped Fernsehturm viewshed', () => {
  const dir = join(__dirname, '..', '..', 'public', 'viewshed');
  const shipped = JSON.parse(readFileSync(join(dir, 'fernsehturm.json'), 'utf8')) as ViewshedHeader;
  const view = decodeViewshed(shipped, new Uint8Array(readFileSync(join(dir, 'fernsehturm.bin'))));

  it('agrees with the 3D scene at Alexanderplatz', () => {
    expect(sampleViewshed(view, 52.5205, 13.416)).toBe(VIEW_VISIBLE);
  });

  it('agrees with the 3D scene that the old Strausberger Platz pin was blocked', () => {
    expect(sampleViewshed(view, 52.5182, 13.4285)).toBe(VIEW_BLOCKED);
  });

  it('has a clear view from both moved street-level viewpoints', () => {
    for (const viewpoint of [STRAUSBERGER_PLATZ, WEBERWIESE]) {
      expect(sampleViewshed(view, viewpoint.lat, viewpoint.lon)).toBe(VIEW_VISIBLE);
    }
  });
});

describe('applySceneMask: what the planner’s scene refuses is taken out of the viewshed', () => {
  // A grid of 5 m cells, all visible but one building cell.
  const grid = (): ReturnType<typeof decodeViewshed> => {
    const h: ViewshedHeader = { format: 'urban-eclipse-viewshed', version: 1, width: 40, height: 40, latMin: 52.5, lonMin: 13.4, dLat: 5 / 111_320, dLon: 5 / (111_320 * Math.cos((52.5 * Math.PI) / 180)) };
    const view = decodeViewshed(h, Uint8Array.from({ length: 25 }, () => run(1, 64)));
    view.cells[20 * 40 + 22] = VIEW_BUILDING;
    return view;
  };
  const at = (row: number, col: number, view: ReturnType<typeof grid>): [number, number] => [view.header.latMin + (row + 0.5) * view.header.dLat, view.header.lonMin + (col + 0.5) * view.header.dLon];

  it('blocks 25 m round each spot and leaves the rest, and a building a building', () => {
    const view = grid();
    applySceneMask(view, [at(20, 20, view)]);
    expect(sampleViewshed(view, ...at(20, 20, view))).toBe(VIEW_BLOCKED);
    expect(sampleViewshed(view, ...at(20, 24, view))).toBe(VIEW_BLOCKED); // 20 m east
    expect(sampleViewshed(view, ...at(24, 20, view))).toBe(VIEW_BLOCKED); // 20 m north
    expect(sampleViewshed(view, ...at(20, 27, view))).toBe(VIEW_VISIBLE); // 35 m east
    expect(sampleViewshed(view, ...at(24, 24, view))).toBe(VIEW_VISIBLE); // 28 m, across the corner
    expect(sampleViewshed(view, ...at(20, 22, view))).toBe(VIEW_BUILDING);
  });

  it('takes a spot at the grid’s edge or outside it without harm', () => {
    const view = grid();
    applySceneMask(view, [at(0, 0, view), [10, 10]]);
    expect(sampleViewshed(view, ...at(0, 0, view))).toBe(VIEW_BLOCKED);
    expect(sampleViewshed(view, ...at(30, 30, view))).toBe(VIEW_VISIBLE);
  });

  it('the tower’s header names its mask, and the mask is a list of places in Berlin', () => {
    const header = JSON.parse(readFileSync(join('public', 'viewshed', 'fernsehturm.json'), 'utf8'));
    expect(header.sceneMask).toBe('fernsehturm-scene.json');
    const mask = JSON.parse(readFileSync(join('public', 'viewshed', header.sceneMask), 'utf8'));
    expect(Array.isArray(mask.spots)).toBe(true);
    for (const [lat, lon] of mask.spots) {
      expect(lat).toBeGreaterThan(52.43);
      expect(lat).toBeLessThan(52.61);
      expect(lon).toBeGreaterThan(13.26);
      expect(lon).toBeLessThan(13.56);
    }
  });
});
