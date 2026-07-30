import { describe, it, expect } from 'vitest';
import {
  startRestream,
  stepRestream,
  isRestreaming,
  RESTREAM_GRACE_MS,
  RESTREAM_DEADLINE_MS,
  RESTREAM_SETTLE_FRAMES,
  type RestreamState,
} from '../../src/lib/restreamWatcher';

/**
 * Drives a state through a sequence of {tilesLoaded} samples at 16 ms cadence starting
 * from `t0`, returning the final state. `now` advances by 16 ms per sample; the FIRST
 * sample is at t0 (the start).
 */
function run(t0: number, samples: boolean[]): RestreamState {
  let state: RestreamState = startRestream(t0);
  samples.forEach((tilesLoaded, i) => {
    state = stepRestream(state, { tilesLoaded, now: t0 + i * 16 });
  });
  return state;
}

describe('startRestream', () => {
  it('begins watching with no false seen and no streak', () => {
    const s = startRestream(1000);
    expect(s.kind).toBe('watching');
    expect(isRestreaming(s)).toBe(true);
    expect(s.seenFalse).toBe(false);
    expect(s.lastTrueStreak).toBe(0);
    expect(s.startedAt).toBe(1000);
  });
});

describe('stepRestream — first-frame staleness', () => {
  it('stays watching while only `true` arrives within the grace window (Cesium has not re-evaluated selection yet)', () => {
    // ~10 frames at 16 ms = 160 ms, well inside RESTREAM_GRACE_MS (400 ms).
    const s = run(0, Array(10).fill(true));
    expect(isRestreaming(s)).toBe(true);
  });
});

describe('stepRestream — normal settle', () => {
  it('goes idle after one false then SETTLE_FRAMES consecutive trues', () => {
    const samples = [false, ...Array(RESTREAM_SETTLE_FRAMES).fill(true)];
    const s = run(0, samples);
    expect(s.kind).toBe('idle');
  });
});

describe('stepRestream — flicker tolerance', () => {
  it('does NOT settle on a single true surrounded by falses', () => {
    // false, true (streak=1, <2), false (reset) -> still watching
    const s = run(0, [false, true, false]);
    expect(isRestreaming(s)).toBe(true);
  });

  it('settles only once a sustained streak reaches SETTLE_FRAMES', () => {
    // false, true, false, true, true -> the last two form a streak of 2 -> idle
    const s = run(0, [false, true, false, true, true]);
    expect(s.kind).toBe('idle');
  });
});

describe('stepRestream — no-op reframe (cached view, grace expiry)', () => {
  it('hides the loader when only `true` ever arrives past the grace window', () => {
    // Simulate many `true` samples spanning beyond RESTREAM_GRACE_MS without a single
    // `false`: the new view needed no new tiles, so there is nothing to wait for.
    const t0 = 0;
    let state: RestreamState = startRestream(t0);
    // Advance well past the grace window, all true.
    for (let i = 0; i < 40; i++) {
      state = stepRestream(state, { tilesLoaded: true, now: t0 + i * 16 });
    }
    expect(state.kind).toBe('idle');
  });
});

describe('stepRestream — never-stuck (SwiftShader deadline)', () => {
  it('forces idle once the deadline elapses even if tilesLoaded stays false forever', () => {
    const t0 = 0;
    let state: RestreamState = startRestream(t0);
    // Continuous false across the deadline boundary.
    const pastDeadline = RESTREAM_DEADLINE_MS + 100;
    let now = t0;
    while (now < pastDeadline) {
      state = stepRestream(state, { tilesLoaded: false, now });
      now += 16;
    }
    expect(state.kind).toBe('idle');
  });
});

describe('stepRestream — terminal idle', () => {
  it('is a no-op on an already-idle state', () => {
    const idle: RestreamState = { kind: 'idle' };
    expect(stepRestream(idle, { tilesLoaded: false, now: 999 })).toEqual({ kind: 'idle' });
    expect(stepRestream(idle, { tilesLoaded: true, now: 999 })).toEqual({ kind: 'idle' });
  });
});

describe('constants are sane', () => {
  it('grace is shorter than the deadline, and settling needs at least one frame', () => {
    expect(RESTREAM_GRACE_MS).toBeLessThan(RESTREAM_DEADLINE_MS);
    expect(RESTREAM_SETTLE_FRAMES).toBeGreaterThanOrEqual(1);
  });
});
