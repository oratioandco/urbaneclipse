/**
 * Structured logger for pipeline / occlusion / solver events (T060).
 *
 * Design constraints (see specs/001-telephoto-los-planner/tasks.md T060):
 *  - No PII: callers pass structured `data` describing values already public to the
 *    scene (heights, dates, angles, counts) — never user identity, IP, tokens, etc.
 *  - Level-based (debug/info/warn/error), emits structured LogEvent objects, not
 *    interpolated strings — consumers (a future remote sink, test spies) get shape.
 *  - Silenceable in production: defaults to 'warn' when `import.meta.env.PROD` is
 *    true (Vite/Astro build), 'debug' otherwise; always overridable via
 *    setLogLevel/silence for tests and explicit opt-in debugging.
 *  - Safe to import from BOTH worker and main-thread contexts: no DOM globals
 *    (window/document/localStorage) are referenced — only `console`, which exists
 *    in both Web Worker and main-thread realms.
 *  - Dependency-free, small: a level filter + a swappable sink, nothing else.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/** A single structured log event. Never put PII in `data`. */
export interface LogEvent {
  level: LogLevel;
  /** Subsystem the event originates from, e.g. 'store' | 'occlusion' | 'solver' | 'pipeline'. */
  scope: string;
  /** Short, stable event name, e.g. 'rehydrate-failed' | 'validation-rejected'. */
  event: string;
  /** Structured, non-PII payload (numbers/strings/booleans describing scene state). */
  data?: Record<string, unknown>;
  /** Milliseconds since epoch, captured at emit time. */
  at: number;
}

export type LogSink = (e: LogEvent) => void;

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

function detectDefaultLevel(): LogLevel {
  try {
    // import.meta.env is a Vite/Astro build-time construct; guard for any other runtime.
    const env = (import.meta as unknown as { env?: { PROD?: boolean } }).env;
    if (env?.PROD) return 'warn';
  } catch {
    // import.meta unavailable (e.g. some worker bundlers) — fall through to default.
  }
  return 'debug';
}

function defaultSink(e: LogEvent): void {
  const line = `[${e.level}] ${e.scope}:${e.event}`;
  const payload = e.data ?? {};
  /* eslint-disable no-console */
  if (e.level === 'error') console.error(line, payload);
  else if (e.level === 'warn') console.warn(line, payload);
  else console.log(line, payload);
  /* eslint-enable no-console */
}

let currentLevel: LogLevel = detectDefaultLevel();
let silenced = false;
let sink: LogSink = defaultSink;

/** Set the minimum level that is emitted (events below this level are dropped). */
export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

export function getLogLevel(): LogLevel {
  return currentLevel;
}

/** Silence (or un-silence) all emission regardless of level. Used in production/tests. */
export function silence(v = true): void {
  silenced = v;
}

export function isSilenced(): boolean {
  return silenced;
}

/** Replace the sink (e.g. a test spy, or a future remote log shipper). Pass `null` to restore the console sink. */
export function setLogSink(next: LogSink | null): void {
  sink = next ?? defaultSink;
}

function emit(level: LogLevel, scope: string, event: string, data?: Record<string, unknown>): void {
  if (silenced) return;
  if (LEVEL_ORDER[level] < LEVEL_ORDER[currentLevel]) return;
  sink({ level, scope, event, data, at: Date.now() });
}

/** Structured logger — one call per event, no string concatenation. */
export const log = {
  debug(scope: string, event: string, data?: Record<string, unknown>): void {
    emit('debug', scope, event, data);
  },
  info(scope: string, event: string, data?: Record<string, unknown>): void {
    emit('info', scope, event, data);
  },
  warn(scope: string, event: string, data?: Record<string, unknown>): void {
    emit('warn', scope, event, data);
  },
  error(scope: string, event: string, data?: Record<string, unknown>): void {
    emit('error', scope, event, data);
  },
};
