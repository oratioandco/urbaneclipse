import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { log, setLogLevel, getLogLevel, silence, isSilenced, setLogSink } from '../../src/lib/log';

/**
 * T060 — structured logger contract. No DOM assumptions (safe from worker + main
 * thread); level-filtered; silenceable; emits structured objects, not strings.
 */

describe('log (structured logger)', () => {
  const originalLevel = getLogLevel();

  beforeEach(() => {
    silence(false);
    setLogLevel('debug');
  });

  afterEach(() => {
    setLogSink(null);
    silence(false);
    setLogLevel(originalLevel);
  });

  it('emits a structured LogEvent object (not a string) to the sink', () => {
    const spy = vi.fn();
    setLogSink(spy);

    log.info('store', 'rehydrated', { hasCameraProfile: true });

    expect(spy).toHaveBeenCalledTimes(1);
    const evt = spy.mock.calls[0][0];
    expect(evt).toMatchObject({
      level: 'info',
      scope: 'store',
      event: 'rehydrated',
      data: { hasCameraProfile: true },
    });
    expect(typeof evt.at).toBe('number');
  });

  it('supports debug/info/warn/error levels', () => {
    const spy = vi.fn();
    setLogSink(spy);

    log.debug('solver', 'chunk', {});
    log.info('solver', 'started', {});
    log.warn('occlusion', 'tiles-not-loaded', {});
    log.error('pipeline', 'convert-failed', {});

    expect(spy).toHaveBeenCalledTimes(4);
    expect(spy.mock.calls.map((c) => c[0].level)).toEqual(['debug', 'info', 'warn', 'error']);
  });

  it('filters events below the configured level', () => {
    const spy = vi.fn();
    setLogSink(spy);
    setLogLevel('warn');

    log.debug('solver', 'chunk', {});
    log.info('solver', 'started', {});
    log.warn('occlusion', 'tiles-not-loaded', {});
    log.error('pipeline', 'convert-failed', {});

    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy.mock.calls.map((c) => c[0].level)).toEqual(['warn', 'error']);
  });

  it('is silenceable regardless of level', () => {
    const spy = vi.fn();
    setLogSink(spy);
    silence(true);

    log.error('pipeline', 'convert-failed', {});

    expect(spy).not.toHaveBeenCalled();
    expect(isSilenced()).toBe(true);
  });

  it('falls back to the console sink when the sink is cleared', () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    setLogSink(null);

    log.info('store', 'noop', {});

    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it('has no DOM globals in its dependency surface (importable outside a browser)', () => {
    // The module itself must not reference window/document/localStorage at import
    // time; if it did, importing it in this node-environment test would already
    // have thrown before reaching this assertion.
    expect(typeof log.debug).toBe('function');
  });
});
