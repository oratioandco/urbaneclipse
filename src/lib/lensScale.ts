/**
 * Sensor formats, their common lens ranges, and the slider scale for the Adjust controls.
 * Pure, no Cesium.
 *
 * Both sliders are logarithmic because the steps that matter are ratios: 8 to 16 mm is as
 * big a change in framing as 300 to 600 mm, and 1 m to 2 m of eye height matters far more
 * than 40 m to 41 m.
 */
export interface SensorFormat {
  id: string;
  label: string;
  /** Sensor long side, mm. */
  width: number;
  /** Shortest and longest focal lengths commonly available for this format, mm. */
  minFocal: number;
  maxFocal: number;
  /** Labelled marks on the lens scale, mm. */
  focalMarks: readonly number[];
}

export const SENSOR_FORMATS: readonly SensorFormat[] = [
  { id: 'mf', label: 'Medium format', width: 43.8, minFocal: 20, maxFocal: 500, focalMarks: [20, 35, 65, 110, 250, 500] },
  { id: 'ff', label: 'Full-frame', width: 36, minFocal: 12, maxFocal: 800, focalMarks: [12, 24, 50, 135, 300, 800] },
  { id: 'apsc', label: 'APS-C', width: 23.6, minFocal: 8, maxFocal: 600, focalMarks: [8, 16, 35, 85, 200, 600] },
  { id: 'm43', label: 'MFT', width: 17.3, minFocal: 7, maxFocal: 400, focalMarks: [7, 14, 25, 60, 150, 400] },
];

const APS_C = SENSOR_FORMATS.find((f) => f.id === 'apsc') as SensorFormat;

/** The format for a sensor width, falling back to APS-C for a custom width. */
export function sensorFormatFor(width: number): SensorFormat {
  return SENSOR_FORMATS.find((f) => f.width === width) ?? APS_C;
}

export const EYE_MIN_M = 0.5;
export const EYE_MAX_M = 50;
/** Labelled marks on the eye-height scale, m. 1.5 m is a standing photographer. */
export const EYE_MARKS: readonly number[] = [0.5, 1.5, 5, 15, 50];

/** Position of a value along a logarithmic scale, 0 to 1, clamped to the scale. */
export function logPosition(value: number, min: number, max: number): number {
  if (!(value > 0)) return 0;
  const p = Math.log(value / min) / Math.log(max / min);
  return Math.min(1, Math.max(0, p));
}

/** The value at a position along a logarithmic scale. */
export function logValue(position: number, min: number, max: number): number {
  return min * (max / min) ** Math.min(1, Math.max(0, position));
}

/** Focal lengths as lenses are marked: finer steps at the short end, where they matter. */
export function roundFocal(mm: number): number {
  const step = mm < 50 ? 1 : mm < 200 ? 5 : 10;
  return Math.round(mm / step) * step;
}

export function roundEye(m: number): number {
  const step = m < 10 ? 0.5 : 1;
  return Math.round(m / step) * step;
}

/** Focal length that gives a field of view across the sensor's long side. */
export function focalForFov(fovDeg: number, sensorWidth: number): number {
  return sensorWidth / (2 * Math.tan((fovDeg * Math.PI) / 360));
}
