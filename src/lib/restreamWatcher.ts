/**
 * Pure state machine for the post-reframe "tiles re-streaming" loader.
 *
 * WHY THIS EXISTS
 * ---------------
 * The scene-phase plumbing in CesiumViewer (`connecting → streaming → ready`) is a
 * ONE-SHOT initial-load lifecycle: nothing ever demotes it back to `streaming` after
 * the first `ready`. So when a solver result (or the Map→Preview toggle) instantly
 * reframes the camera from a top-down map view to a street-level telephoto shot, the
 * 3D Tiles selection is invalidated and re-streams — but the phase stays `ready` and
 * the frame is empty with NO indication. This module turns Cesium's `tileset.tilesLoaded`
 * boolean into a brief, never-stuck "Framing the shot…" loader that covers exactly that
 * window.
 *
 * WHY IT IS PURE (Constitution Principle I — TDD)
 * -----------------------------------------------
 * Every consumer of `tilesLoaded` in this codebase (the initial-load gate in
 * CesiumViewer, the occlusion validity check in lineOfSight.ts) trusts the same
 * boolean, polled per rAF — Cesium 1.143 emits no `tilesLoaded` event. The rAF loop and
 * the React `setState` live in CesiumViewer (untestable without a mocked WebGL viewer);
 * the DECISION of "show / keep / hide the loader" is pure, takes `now` as an argument,
 * and is fully Vitest-covered here with no browser, no Cesium, no WebGL.
 *
 * THE THREE SWIFTSHADER REALITIES THE STATE MACHINE ABSORBS
 * ---------------------------------------------------------
 *  1. FIRST-FRAME STALENESS. `tilesLoaded` reads `true` for 1–2 frames after a reframe
 *     before Cesium re-evaluates the tile selection. A naive "poll until true" would
 *     settle instantly and the loader would never show. We therefore require at least
 *     one observed `false` (`seenFalse`) before a `true` counts toward settling.
 *  2. FLICKER. The boolean can bounce `true → false → true` as tiles process. Settling
 *     requires `RESTREAM_SETTLE_FRAMES` consecutive `true` samples.
 *  3. NEVER-SETTLE (software rendering). Under SwiftShader the screen-space error can
 *     take many seconds or, pathologically, never settle. `RESTREAM_DEADLINE_MS` forces
 *     the loader hidden regardless — a stuck spinner is worse than no spinner, and the
 *     scene keeps rendering whatever it has. The grace window (`RESTREAM_GRACE_MS`)
 *     symmetrically hides the loader when a reframe needed no new tiles (all `true`,
 *     never a `false`) so cached views don't flash a spinner.
 */

/** `tilesLoaded` has not yet been seen false: still deciding whether a re-stream began. */
export interface RestreamWatching {
  readonly kind: 'watching';
  /** Has at least one `false` sample been observed since the watch started? */
  readonly seenFalse: boolean;
  /** Consecutive `true` samples seen AFTER the first `false`. */
  readonly lastTrueStreak: number;
  /** `now` at the moment the watch started (ms). */
  readonly startedAt: number;
}

export type RestreamState =
  | { readonly kind: 'idle' }
  | RestreamWatching;

/**
 * No `false` observed within this window (ms) after a reframe means the new view needed
 * no new tiles — hide the loader rather than flashing it for cached views.
 */
export const RESTREAM_GRACE_MS = 400;

/**
 * Hard ceiling (ms) the loader may stay visible. Software rendering can leave the
 * screen-space error unsettled for a long time; never pin the user behind a spinner.
 */
export const RESTREAM_DEADLINE_MS = 8000;

/** Consecutive `true` samples required (after the first `false`) to consider it settled. */
export const RESTREAM_SETTLE_FRAMES = 2;

/** A single observation polled each animation frame. */
export interface RestreamSample {
  /** The live value of `Cesium3DTileset.tilesLoaded`. */
  readonly tilesLoaded: boolean;
  /** `performance.now()` at the sample (ms). Passed in so the reducer is pure/testable. */
  readonly now: number;
}

/** Begin watching for a re-stream. `now` is the start timestamp (ms). */
export function startRestream(now: number): RestreamWatching {
  return { kind: 'watching', seenFalse: false, lastTrueStreak: 0, startedAt: now };
}

/**
 * Advance the state machine one sample.
 *
 * Returns the next state. A return to `{ kind: 'idle' }` means "stop watching and hide
 * the loader" — either it settled, the deadline expired, or no re-stream actually began.
 */
export function stepRestream(state: RestreamState, sample: RestreamSample): RestreamState {
  if (state.kind === 'idle') return state;

  // Never pin the loader: past the deadline we hide it regardless of the queue.
  if (sample.now - state.startedAt > RESTREAM_DEADLINE_MS) {
    return { kind: 'idle' };
  }

  // A `false` means tiles ARE being requested/processed — a real re-stream is underway.
  if (!sample.tilesLoaded) {
    return { kind: 'watching', seenFalse: true, lastTrueStreak: 0, startedAt: state.startedAt };
  }

  // `true` but we never saw a `false`: Cesium has not re-evaluated the selection yet.
  // Wait one grace window for that to happen; if it never does, no re-stream was needed.
  if (!state.seenFalse) {
    return sample.now - state.startedAt > RESTREAM_GRACE_MS
      ? { kind: 'idle' }
      : state;
  }

  // `true` after a `false`: count a streak. Settle once it is sustained.
  const streak = state.lastTrueStreak + 1;
  return streak >= RESTREAM_SETTLE_FRAMES
    ? { kind: 'idle' }
    : { kind: 'watching', seenFalse: true, lastTrueStreak: streak, startedAt: state.startedAt };
}

/** True while the loader should be visible (a re-stream appears to be in progress). */
export function isRestreaming(state: RestreamState): boolean {
  return state.kind === 'watching';
}
