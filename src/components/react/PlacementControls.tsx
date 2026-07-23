/**
 * PlacementControls — the map-first workflow: switch between MAP and PREVIEW, and
 * place the observer and target by clicking the scene.
 *
 * The plaster model IS the map, so MAP mode is a top-down view of the same geometry
 * the solver reasons about — what you click is exactly what gets computed.
 *
 * Pure presentation + store wiring; NO Cesium import (Constitution Principle I).
 */
import { useStore } from '@nanostores/react';
import {
  viewMode,
  pickMode,
  observerPosition,
  targetPosition,
  setObserverPosition,
  setTargetPosition,
  searchArea,
  setSearchArea,
  AREA_RADIUS_MIN_M,
  AREA_RADIUS_MAX_M,
  type PickMode,
} from '../../store.js';
import { VIEWPOINTS, DEFAULT_VIEWPOINT } from '../../lib/viewpoints.js';
import { TARGET_DEFAULT } from '../../lib/berlin.js';

export interface PlacementControlsProps {
  /** Set when a click missed the model or landed outside Berlin. */
  pickError?: string;
  /** Surface elevation source for the observer, surfaced so accuracy is never implied. */
  observerSurfaceSource?: 'viewpoint' | 'terrain' | 'fallback';
}

const SOURCE_COPY: Record<string, string> = {
  viewpoint: 'surveyed viewpoint',
  terrain: 'DGM1 terrain',
  fallback: 'assumed Berlin mean',
};

export default function PlacementControls({
  pickError,
  observerSurfaceSource,
}: PlacementControlsProps = {}): JSX.Element {
  const mode = useStore(viewMode);
  const pick = useStore(pickMode);
  const obs = useStore(observerPosition);
  const tgt = useStore(targetPosition);
  const area = useStore(searchArea);

  const arm = (which: Exclude<PickMode, 'none'>): void => {
    // Placing requires seeing the map; switch there automatically rather than arming
    // a pick the user cannot aim.
    if (viewMode.get() !== 'map') viewMode.set('map');
    pickMode.set(pickMode.get() === which ? 'none' : which);
  };

  const selectViewpoint = (id: string): void => {
    const vp = VIEWPOINTS.find((v) => v.id === id);
    if (!vp) return;
    setObserverPosition({ lat: vp.lat, lon: vp.lon, viewpointId: vp.id, label: vp.name });
    pickMode.set('none');
  };

  const reset = (): void => {
    selectViewpoint(DEFAULT_VIEWPOINT.id);
    setTargetPosition({
      lat: TARGET_DEFAULT.lat,
      lon: TARGET_DEFAULT.lon,
      label: 'Berliner Fernsehturm',
    });
  };

  const fmt = (p: { lat: number; lon: number }) =>
    `${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}`;

  return (
    <section className="pv-panel" data-testid="placement-controls">
      <header className="pv-panel__head">
        <h2 className="pv-panel__title">
          <span className="pv-panel__index">00</span>Placement
        </h2>
        <span className="pv-panel__meta">{mode === 'map' ? 'map' : 'preview'}</span>
      </header>

      <div className="pv-btn-row">
        <button
          type="button"
          onClick={() => viewMode.set('map')}
          className={`pv-btn ${mode === 'map' ? 'pv-btn--primary' : 'pv-btn--quiet'}`}
          aria-pressed={mode === 'map'}
        >
          Map
        </button>
        <button
          type="button"
          onClick={() => {
            pickMode.set('none');
            viewMode.set('preview');
          }}
          className={`pv-btn ${mode === 'preview' ? 'pv-btn--primary' : 'pv-btn--quiet'}`}
          aria-pressed={mode === 'preview'}
        >
          Preview
        </button>
      </div>

      <dl className="pv-readout">
        <div className="pv-readout__row">
          <dt className="pv-label">Observer</dt>
          <dd className="pv-value">{obs.label ?? fmt(obs)}</dd>
        </div>
        <div className="pv-readout__row">
          <dt className="pv-label">&nbsp;</dt>
          <dd className="pv-value">{fmt(obs)}</dd>
        </div>
        {observerSurfaceSource ? (
          <div className="pv-readout__row">
            <dt className="pv-label">Elevation from</dt>
            <dd className="pv-value">
              {SOURCE_COPY[observerSurfaceSource] ?? observerSurfaceSource}
            </dd>
          </div>
        ) : null}
        <div className="pv-readout__row">
          <dt className="pv-label">Target</dt>
          <dd className="pv-value">{tgt.label ?? fmt(tgt)}</dd>
        </div>
        <div className="pv-readout__row">
          <dt className="pv-label">&nbsp;</dt>
          <dd className="pv-value">{fmt(tgt)}</dd>
        </div>
      </dl>

      {/* Curated clean-sightline viewpoints — the quickest way to a good shot, and how
          you "jump to" a spot the solver found. */}
      <div className="pv-field">
        <div className="pv-field__line">
          <span className="pv-label">Viewpoint</span>
        </div>
        <select
          className="pv-select"
          aria-label="Camera viewpoint"
          value={obs.viewpointId ?? ''}
          onChange={(e) => selectViewpoint(e.currentTarget.value)}
        >
          {obs.viewpointId === undefined && <option value="">Custom (placed)</option>}
          {VIEWPOINTS.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
        </select>
      </div>

      <div className="pv-btn-row">
        <button
          type="button"
          onClick={() => arm('observer')}
          className={`pv-btn ${pick === 'observer' ? 'pv-btn--primary' : 'pv-btn--quiet'}`}
          aria-pressed={pick === 'observer'}
        >
          {pick === 'observer' ? 'Click map…' : 'Place observer'}
        </button>
        <button
          type="button"
          onClick={() => arm('target')}
          className={`pv-btn ${pick === 'target' ? 'pv-btn--primary' : 'pv-btn--quiet'}`}
          aria-pressed={pick === 'target'}
        >
          {pick === 'target' ? 'Click map…' : 'Place target'}
        </button>
      </div>

      {/* SEARCH AREA — "anywhere I can reach", which is what actually unlocks the
          solver's where-to-stand answer. A centre plus radius, because that is how
          reach is described in practice and it is far quicker to place than a polygon. */}
      <div className="pv-btn-row">
        <button
          type="button"
          onClick={() => arm('area')}
          className={`pv-btn ${pick === 'area' ? 'pv-btn--primary' : 'pv-btn--quiet'}`}
          aria-pressed={pick === 'area'}
        >
          {pick === 'area' ? 'Click map…' : area ? 'Move area' : 'Set search area'}
        </button>
        {area && (
          <button
            type="button"
            onClick={() => setSearchArea(null)}
            className="pv-btn pv-btn--quiet"
          >
            Clear
          </button>
        )}
      </div>

      {area && (
        <div className="pv-field">
          <div className="pv-field__line">
            <span className="pv-label">Area radius</span>
            <span className="pv-value">{area.radiusM.toFixed(0)} m</span>
          </div>
          <input
            className="pv-range"
            type="range"
            aria-label="Search area radius in metres"
            min={AREA_RADIUS_MIN_M}
            max={AREA_RADIUS_MAX_M}
            step={25}
            value={area.radiusM}
            onChange={(e) =>
              setSearchArea({ center: area.center, radiusM: parseFloat(e.currentTarget.value) })
            }
          />
          <div className="pv-scale">
            <span>{AREA_RADIUS_MIN_M}</span>
            <span>{AREA_RADIUS_MAX_M} m</span>
          </div>
        </div>
      )}

      <div className="pv-btn-row">
        <button type="button" onClick={reset} className="pv-btn pv-btn--quiet">
          Reset viewpoint & target
        </button>
      </div>

      {pick !== 'none' && (
        <div className="pv-msg" role="status">
          <strong className="pv-msg__title">
            {pick === 'area'
              ? 'Placing the search area'
              : `Placing the ${pick === 'observer' ? 'observer' : 'target'}`}
          </strong>
          {pick === 'area'
            ? 'Click the map to centre your reachable area, then set its radius. The solver will look for compositions you can actually walk to.'
            : 'Click anywhere on the model to place it. Elevation is read from the DGM1 terrain automatically. Click the button again to cancel.'}
        </div>
      )}

      {/* A pick that misses must say so — silently ignoring the click reads as a
          broken button (FR-013). */}
      {pickError ? (
        <div className="pv-msg pv-msg--warn" role="alert">
          <strong className="pv-msg__title">Pick not registered</strong>
          {pickError}
        </div>
      ) : null}

      {/* Freely placed observers lose the surveyed deck elevation, which is an 8.8 m
          difference on the Lichtenberger Brücke — worth stating plainly. */}
      {obs.viewpointId === undefined && observerSurfaceSource === 'terrain' ? (
        <div className="pv-msg" role="status">
          <strong className="pv-msg__title">Standing on terrain</strong>
          This observer uses the bare-earth terrain model. If you are actually on a
          bridge, roof or platform, the real eye height is higher — on the Lichtenberger
          Brücke the deck sits 8.8 m above the ground beneath it.
        </div>
      ) : null}
    </section>
  );
}
