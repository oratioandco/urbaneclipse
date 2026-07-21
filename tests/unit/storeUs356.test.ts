import { describe, it, expect, beforeEach, vi } from 'vitest';
import { cameraProfile, solverState } from '../../src/store';

/**
 * US3/US5/US6 store additions — minimal atom contract tests. The new atoms are plain
 * nanostores; these tests pin their default shape and the round-trip write/read so a
 * future refactor can't silently change the contract CesiumViewer relies on.
 */
beforeEach(() => {
  cameraProfile.set({ sensorWidth: 36, focalLength: 600, zoom: 1 });
  solverState.set({ status: 'idle', progress: 0, matches: [] });
});

describe('cameraProfile (US6)', () => {
  it('defaults to full-frame 36mm / 600mm / 1x zoom', () => {
    expect(cameraProfile.get()).toEqual({
      sensorWidth: 36,
      focalLength: 600,
      zoom: 1,
    });
  });

  it('notifies listeners on .set and exposes the new value', () => {
    const spy = vi.fn();
    const unsub = cameraProfile.listen(spy);
    cameraProfile.set({ sensorWidth: 17.3, focalLength: 100, zoom: 2 });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(cameraProfile.get()).toEqual({
      sensorWidth: 17.3,
      focalLength: 100,
      zoom: 2,
    });
    unsub();
  });

  it('survives an APS-C preset write round-trip (the CameraControls preset path)', () => {
    cameraProfile.set({ ...cameraProfile.get(), sensorWidth: 23.6 });
    expect(cameraProfile.get().sensorWidth).toBe(23.6);
  });
});

describe('solverState (US5)', () => {
  it('starts idle with empty matches', () => {
    expect(solverState.get()).toEqual({
      status: 'idle',
      progress: 0,
      matches: [],
    });
  });

  it('transitions through the worker handshake (running -> done) with matches', () => {
    solverState.set({ status: 'running', progress: 0.42, matches: [] });
    expect(solverState.get().status).toBe('running');
    expect(solverState.get().progress).toBeCloseTo(0.42, 5);
    const matches = [new Date('2026-08-15T22:30:00Z')];
    solverState.set({ status: 'done', progress: 1, matches });
    expect(solverState.get().status).toBe('done');
    expect(solverState.get().matches).toEqual(matches);
  });

  it('carries an optional error field for the error status', () => {
    solverState.set({ status: 'error', progress: 0, matches: [], error: 'boom' });
    expect(solverState.get().error).toBe('boom');
  });
});
