/**
 * Guards for the pick classifier — the component that decides whether ANYTHING
 * occludes.
 *
 * It was wrong for the entire life of the feature and nothing caught it, because it
 * lived inside a module that reads `window.Cesium` at import time and so could not be
 * unit-tested at all. Buildings classified as 'other' and never occluded;
 * tests/e2e/us1-occlusion.spec.ts (SC-001) failed on exactly that.
 *
 * Every fixture below is the SHAPE OBSERVED FROM THE LIVE SCENE via
 * scene.drillPickFromRay against the real Berlin tileset — not an invention of what
 * Cesium ought to return. That is the whole point: the old checks were written against
 * a plausible-looking shape that Cesium never produces for these tiles.
 */
import { describe, it, expect } from 'vitest';
import { classifyPick, LANDMARK_PICK_ID } from '../../src/lib/pickKind.js';

describe('classifyPick', () => {
  it('classifies a real b3dm building hit as an occluder', () => {
    // Captured live. Note what is absent: no `.tileset`, no `.getContent`, plain Object
    // constructor — the three things the old implementation tested for. These tiles
    // carry no batch table, so Cesium builds this object instead of a
    // Cesium3DTileFeature.
    const buildingHit = {
      content: {},
      primitive: { isCesium3DTileset: true },
      detail: {},
      id: undefined,
    };
    expect(classifyPick(buildingHit)).toBe('building');
  });

  it('does not regress to the checks that silently failed', () => {
    // Explicitly assert the old heuristics would NOT have matched, so nobody "restores"
    // them believing they were sufficient.
    const buildingHit: Record<string, unknown> = {
      content: {},
      primitive: { isCesium3DTileset: true },
      detail: {},
    };
    expect(buildingHit.tileset).toBeUndefined();
    expect(typeof buildingHit.getContent).not.toBe('function');
    expect(buildingHit.constructor?.name).toBe('Object');
    // ...and yet it must still classify as a building.
    expect(classifyPick(buildingHit)).toBe('building');
  });

  it('still handles a batched Cesium3DTileFeature, if a batch table is ever added', () => {
    expect(classifyPick({ tileset: {}, primitive: { isCesium3DTileset: true } })).toBe('building');
    expect(classifyPick({ getContent: () => ({}) })).toBe('building');
  });

  it('treats the globe as NON-occluding', () => {
    // A globe hit arrives with object === undefined: it issues no pickId. It must never
    // read as an occluder — the photographer stands ON the terrain, so a naive
    // "undefined means terrain" rule would report the ground under the observer's feet
    // as blocking the view.
    expect(classifyPick(undefined)).toBe('other');
    expect(classifyPick(null)).toBe('other');
  });

  it('treats the parametric Fernsehturm as the TARGET, not an obstacle', () => {
    // A ray aimed at the tip necessarily grazes the shaft and antenna below it. If the
    // landmark occluded, every sightline to the app's default target would be
    // permanently self-blocked.
    const landmarkHit = { primitive: {}, id: LANDMARK_PICK_ID };
    expect(classifyPick(landmarkHit)).toBe('other');
  });

  it('keeps the landmark non-occluding even ahead of a tileset-shaped primitive', () => {
    // Ordering guard: the landmark check must win, or a future change to how the
    // primitive is built could flip the default sightline to permanently occluded.
    expect(
      classifyPick({ id: LANDMARK_PICK_ID, primitive: { isCesium3DTileset: true } }),
    ).toBe('other');
  });

  it('never lets helper geometry occlude the sightline it belongs to', () => {
    // The line-of-sight polyline lies EXACTLY along the pick ray, and the observer
    // marker sits at its origin — both are hit every single time. Captured live.
    const polylineHit = { primitive: { constructor: { name: 'Primitive' } }, id: {} };
    const markerHit = { primitive: { constructor: { name: 'PointPrimitive' } }, collection: {}, id: {} };
    expect(classifyPick(polylineHit)).toBe('other');
    expect(classifyPick(markerHit)).toBe('other');
  });

  it('is total — never throws on unexpected input', () => {
    for (const v of [0, '', 'building', NaN, [], () => {}, { primitive: null }, { primitive: {} }]) {
      expect(() => classifyPick(v)).not.toThrow();
      expect(['building', 'terrain', 'other']).toContain(classifyPick(v));
    }
  });
});
