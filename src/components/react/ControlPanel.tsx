/**
 * ControlPanel — plaster-void overlay for the line-of-sight controls.
 *
 * Rendered INSIDE the CesiumViewer island (not its own `client:only` island) so it
 * shares the same React tree + the same browser-only lifecycle. Reads/writes the
 * shared nanostores in src/store.ts:
 *   - dateTime       (US3 datetime-local input; scrub via setDateTimeScrubbing while
 *                     the picker is open, commit on blur / change)
 *   - observerHeight (slider, 0.5..50 m above ellipsoid)
 *   - targetHeight   (slider, 1..400 m above ellipsoid)
 *   - isOccluded     (read-only display: CLEAR / BLOCKED)
 *
 * T059 (FR-013): the occlusion verdict is only trustworthy once the 3D Tiles scene
 * has actually streamed. The island owns that knowledge and passes it down as
 * `scenePhase`; until it is 'ready' the panel says so IN WORDS rather than showing a
 * confident "CLEAR" derived from an empty scene, and an 'error' phase surfaces the
 * failure text instead of a blank verdict.
 *
 * Pure presentation + store wiring — NO Cesium import (Constitution Principle I).
 */
import { useStore } from '@nanostores/react';
import {
  dateTime,
  observerHeight,
  targetHeight,
  isOccluded,
  setDateTimeScrubbing,
} from '../../store.js';

/**
 * Lifecycle of the 3D Tiles scene, as observed by the CesiumViewer island.
 *   connecting — Cesium3DTileset.fromUrl has not resolved yet
 *   streaming  — tileset added to the scene, tiles still loading (occlusion unknown)
 *   ready      — tiles loaded AND an occlusion result has been committed
 *   error      — the tileset could not be fetched/parsed (missing building data)
 */
export type ScenePhase = 'connecting' | 'streaming' | 'ready' | 'error';

export interface ControlPanelProps {
  /** Defaults to 'ready' so the component is usable standalone (tests, storybook). */
  scenePhase?: ScenePhase;
  /** Human-readable failure text when scenePhase === 'error'. */
  sceneError?: string;
  /** True when the scene has been streaming unusually long — surfaced as a warning. */
  sceneSlow?: boolean;
  /**
   * Set when the DGM1 ground heightmap could not be loaded, so heights fall back to
   * the Berlin mean. Surfaced in words: a sightline computed from assumed ground can
   * be several metres out, and must not look as authoritative as a real sample.
   */
  groundWarning?: string;
  /** Where the drawn sun/moon is. Absent in map mode. */
  discState?: {
    altitude: number;
    azimuth: number;
    angularDiameterDeg: number;
    visible: boolean;
  };
  /** Which body the preview is drawing. */
  body?: 'sun' | 'moon';
}

/**
 * Round-trip helpers between a JS Date and an <input type="datetime-local"> value.
 * The input's .value is a "local time" string with NO timezone marker
 * (e.g. "2026-07-21T13:45"); we interpret it as UTC to keep the store TZ-stable.
 * (Display-only consumers can format toISOString for explicitness; the store carries
 * an absolute instant either way.)
 */
function dateToLocalInput(d: Date): string {
  // YYYY-MM-DDTHH:MM, all in UTC. Cheap manual format avoids toISOString's trailing 'Z'
  // (which the input rejects) and any local-timezone drift.
  const iso = d.toISOString(); // YYYY-MM-DDTHH:MM:SS.sssZ
  return iso.slice(0, 16);
}
function localInputToDate(s: string): Date {
  // The input never includes seconds or ms; parse as UTC by appending 'Z'. If the user
  // cleared the field, fall back to "now" so the store never holds an Invalid Date.
  if (!s) return new Date();
  return new Date(`${s}:00Z`);
}

export default function ControlPanel({
  scenePhase = 'ready',
  sceneError,
  sceneSlow = false,
  groundWarning,
  discState,
  body = 'sun',
}: ControlPanelProps = {}): JSX.Element {
  const oh = useStore(observerHeight);
  const th = useStore(targetHeight);
  const occluded = useStore(isOccluded);
  const dt = useStore(dateTime);

  // --- T059: the verdict is a three-state, not a boolean ---------------------
  const verdict =
    scenePhase === 'ready' ? (occluded ? 'blocked' : 'clear') : 'unknown';
  const verdictText =
    verdict === 'blocked' ? 'Blocked' : verdict === 'clear' ? 'Clear' : 'Unknown';
  const verdictHint =
    verdict === 'blocked'
      ? 'geometry hit'
      : verdict === 'clear'
        ? 'path open'
        : scenePhase === 'error'
          ? 'no data'
          : 'awaiting tiles';

  return (
    <section className="pv-panel" data-testid="control-panel">
      <header className="pv-panel__head">
        <h2 className="pv-panel__title">
          <span className="pv-panel__index">01</span>Line of sight
        </h2>
        <span className="pv-panel__meta">Berlin</span>
      </header>

      {/* US3 — date/time scrub. While typing, scrub via setDateTimeScrubbing (rAF
          coalesced, no spam); on a final commit (change event), set directly. The
          CesiumViewer island listens to dateTime and pushes it into viewer.clock so
          Cesium's sun/shadows follow suncalc time (Strategy B). */}
      <div className="pv-field">
        <div className="pv-field__line">
          <span className="pv-label">Instant</span>
          <span className="pv-value pv-value--sub">
            {dt.toISOString().slice(11, 16)} UTC
          </span>
        </div>
        <input
          className="pv-input"
          type="datetime-local"
          aria-label="Date and time (UTC)"
          value={dateToLocalInput(dt)}
          onInput={(e) =>
            setDateTimeScrubbing(localInputToDate(e.currentTarget.value))
          }
          onChange={(e) => dateTime.set(localInputToDate(e.currentTarget.value))}
        />
      </div>

      <div className="pv-field">
        <div className="pv-field__line">
          <span className="pv-label">Eye above deck</span>
          <span className="pv-value">{oh.toFixed(1)} m</span>
        </div>
        <input
          className="pv-range"
          type="range"
          aria-label="Observer height in metres"
          min={0.5}
          max={50}
          step={0.5}
          value={oh}
          onChange={(e) => observerHeight.set(parseFloat(e.currentTarget.value))}
        />
        <div className="pv-scale">
          <span>0.5</span>
          <span>50 m</span>
        </div>
      </div>

      <div className="pv-field">
        <div className="pv-field__line">
          <span className="pv-label">Target above base</span>
          <span className="pv-value">{th.toFixed(0)} m</span>
        </div>
        <input
          className="pv-range"
          type="range"
          aria-label="Target height in metres"
          min={1}
          max={450}
          step={1}
          value={th}
          onChange={(e) => targetHeight.set(parseFloat(e.currentTarget.value))}
        />
        <div className="pv-scale">
          <span>1</span>
          <span>450 m</span>
        </div>
      </div>

      <div
        className={`pv-status pv-status--${verdict}`}
        role="status"
        aria-live="polite"
      >
        <span className="pv-status__dot" aria-hidden="true" />
        <span className="pv-status__text">{verdictText}</span>
        <span className="pv-status__hint">{verdictHint}</span>
      </div>

      {/* T059 — never a silent/blank verdict: say why it is not decided. */}
      {scenePhase === 'error' && (
        <div className="pv-msg pv-msg--error" role="alert">
          <strong className="pv-msg__title">Building data unavailable</strong>
          The 3D Tiles building set could not be loaded, so occlusion cannot be
          evaluated. Check that the tileset is published and reachable, then reload.
          {sceneError ? (
            <span className="pv-msg__detail">{sceneError}</span>
          ) : null}
        </div>
      )}

      {(scenePhase === 'connecting' || scenePhase === 'streaming') && (
        <div className={`pv-msg ${sceneSlow ? 'pv-msg--warn' : ''}`} role="status">
          <strong className="pv-msg__title">
            {scenePhase === 'connecting' ? 'Requesting tileset' : 'Streaming tiles'}
          </strong>
          {sceneSlow
            ? 'Tiles are taking unusually long to arrive. The sightline verdict stays UNKNOWN until the buildings have streamed — check the network tab if this persists.'
            : 'The sightline verdict stays UNKNOWN until the building geometry has streamed in.'}
        </div>
      )}

      {/* The disc is the whole point of the preview, so when it is NOT on screen the
          reason must be explicit — "below the horizon" and "something broke" would
          otherwise look identical. */}
      {discState ? (
        discState.visible ? (
          <dl className="pv-readout">
            <div className="pv-readout__row">
              <dt className="pv-label">{body === 'sun' ? 'Sun' : 'Moon'}</dt>
              <dd className="pv-value">
                {discState.azimuth.toFixed(1)}° / {discState.altitude.toFixed(2)}°
              </dd>
            </div>
            <div className="pv-readout__row">
              <dt className="pv-label">Apparent size</dt>
              <dd className="pv-value">{discState.angularDiameterDeg.toFixed(3)}°</dd>
            </div>
          </dl>
        ) : (
          <div className="pv-msg" role="status">
            <strong className="pv-msg__title">
              {body === 'sun' ? 'Sun' : 'Moon'} is below the horizon
            </strong>
            At this time it sits {Math.abs(discState.altitude).toFixed(1)}° under the
            horizon, so nothing is drawn. Scrub the time or pick a search result.
          </div>
        )
      ) : null}

      {/* Ground elevation is load-bearing: heights are measured from the terrain, so a
          missing heightmap silently shifts the whole sightline. Say so explicitly. */}
      {groundWarning ? (
        <div className="pv-msg pv-msg--warn" role="status">
          <strong className="pv-msg__title">Approximate ground elevation</strong>
          Terrain heights could not be loaded, so the observer and target sit on an
          assumed Berlin mean rather than measured ground. Heights may be several
          metres out.
          <span className="pv-msg__detail">{groundWarning}</span>
        </div>
      ) : null}
    </section>
  );
}
