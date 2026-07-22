/**
 * Map-first placement state tests.
 *
 * The guard that matters here is coordinate plausibility. A Cesium ray-pick that
 * misses all geometry can return a point on the far side of the globe; accepting it
 * would silently relocate the whole scene with no explanation to the user.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  viewMode,
  pickMode,
  observerPosition,
  targetPosition,
  setObserverPosition,
  setTargetPosition,
  isPlausibleBerlinPosition,
} from '../../src/store.js';

const BRIDGE = { lat: 52.5113, lon: 13.4988 };
const TOWER = { lat: 52.520815, lon: 13.409419 };

beforeEach(() => {
  observerPosition.set({ ...BRIDGE, viewpointId: 'lichtenberger-bruecke' });
  targetPosition.set({ ...TOWER });
  viewMode.set('preview');
  pickMode.set('none');
});

describe('isPlausibleBerlinPosition', () => {
  it('accepts real Berlin locations', () => {
    expect(isPlausibleBerlinPosition(BRIDGE)).toBe(true);
    expect(isPlausibleBerlinPosition(TOWER)).toBe(true);
  });

  it('rejects points outside Berlin', () => {
    expect(isPlausibleBerlinPosition({ lat: 48.8566, lon: 2.3522 })).toBe(false); // Paris
    expect(isPlausibleBerlinPosition({ lat: 0, lon: 0 })).toBe(false); // null island
    expect(isPlausibleBerlinPosition({ lat: -33.9, lon: 151.2 })).toBe(false); // Sydney
  });

  it('rejects non-finite coordinates', () => {
    // A ray-pick that hits nothing yields NaN components.
    expect(isPlausibleBerlinPosition({ lat: NaN, lon: 13.4 })).toBe(false);
    expect(isPlausibleBerlinPosition({ lat: 52.5, lon: Infinity })).toBe(false);
  });
});

describe('setObserverPosition / setTargetPosition', () => {
  it('commits a plausible position and reports success', () => {
    expect(setObserverPosition({ lat: 52.52, lon: 13.42 })).toBe(true);
    expect(observerPosition.get().lat).toBeCloseTo(52.52, 6);
  });

  it('rejects an implausible position and leaves the store untouched', () => {
    const before = observerPosition.get();
    expect(setObserverPosition({ lat: 0, lon: 0 })).toBe(false);
    expect(observerPosition.get()).toEqual(before);
  });

  it('rejects NaN without corrupting the scene', () => {
    const before = targetPosition.get();
    expect(setTargetPosition({ lat: NaN, lon: NaN })).toBe(false);
    expect(targetPosition.get()).toEqual(before);
  });

  it('carries a viewpoint id through, so the deck override still applies', () => {
    setObserverPosition({
      lat: 52.5113,
      lon: 13.4988,
      viewpointId: 'lichtenberger-bruecke',
      label: 'Lichtenberger Brücke',
    });
    expect(observerPosition.get().viewpointId).toBe('lichtenberger-bruecke');
  });

  it('a freely picked position has NO viewpoint id, so terrain is used', () => {
    setObserverPosition({ lat: 52.52, lon: 13.42 });
    expect(observerPosition.get().viewpointId).toBeUndefined();
  });
});

describe('view and pick modes', () => {
  it('defaults to preview with picking disabled', () => {
    expect(viewMode.get()).toBe('preview');
    expect(pickMode.get()).toBe('none');
  });

  it('round-trips both modes', () => {
    viewMode.set('map');
    pickMode.set('observer');
    expect(viewMode.get()).toBe('map');
    expect(pickMode.get()).toBe('observer');
    pickMode.set('target');
    expect(pickMode.get()).toBe('target');
  });
});
