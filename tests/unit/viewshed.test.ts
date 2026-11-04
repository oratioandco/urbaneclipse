import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  VIEW_BLOCKED,
  VIEW_BUILDING,
  VIEW_VISIBLE,
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

  it('agrees with the 3D scene that the Strausberger Platz pin is blocked', () => {
    expect(sampleViewshed(view, 52.5182, 13.4285)).toBe(VIEW_BLOCKED);
  });
});
