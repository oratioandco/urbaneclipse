import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  dateTime,
  observerHeight,
  targetHeight,
  isOccluded,
  commitOcclusion,
  setDateTimeScrubbing,
} from '../../src/store';

beforeEach(() => {
  // Reset shared store state between tests.
  commitOcclusion(false);
  observerHeight.set(1.5);
  targetHeight.set(210);
});

describe('store initial values', () => {
  it('has the documented defaults', () => {
    expect(dateTime.get()).toBeInstanceOf(Date);
    expect(observerHeight.get()).toBe(1.5);
    expect(targetHeight.get()).toBe(210);
    expect(isOccluded.get()).toBe(false);
  });
});

describe('isOccluded is read-only', () => {
  it('is exported as a ReadableAtom (type-level read-only; sole writer is commitOcclusion)', () => {
    // Runtime enforcement is via a private source atom + the ReadableAtom type export
    // (see src/store.ts). The behavioural guarantee is covered by the tests below.
    expect(typeof isOccluded.get).toBe('function');
    expect(typeof isOccluded.listen).toBe('function');
  });

  it('commitOcclusion is the only mutation path, with an equality guard', () => {
    const spy = vi.fn();
    const unsub = isOccluded.listen(spy);

    commitOcclusion(true); // value changes -> notify
    expect(isOccluded.get()).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);

    commitOcclusion(true); // unchanged -> NO notify (equality guard)
    expect(spy).toHaveBeenCalledTimes(1);

    commitOcclusion(false); // changes back -> notify
    expect(spy).toHaveBeenCalledTimes(2);

    unsub();
  });
});

describe('dependency-direction invariant (occlusion is independent of time/heights)', () => {
  it('changing dateTime / heights does not touch isOccluded', () => {
    commitOcclusion(false);
    dateTime.set(new Date(9999999999999));
    observerHeight.set(7);
    targetHeight.set(99);
    expect(isOccluded.get()).toBe(false);
  });
});

describe('setDateTimeScrubbing (rAF coalescing)', () => {
  it('collapses a burst of writes into one notify per frame (latest-wins)', () => {
    let rafCb: (() => void) | null = null;
    vi.stubGlobal('requestAnimationFrame', (cb: () => void) => {
      rafCb = cb;
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());

    const spy = vi.fn();
    const unsub = dateTime.listen(spy);

    setDateTimeScrubbing(new Date(1000));
    setDateTimeScrubbing(new Date(2000));
    setDateTimeScrubbing(new Date(3000));

    // Before the frame flushes, nothing has been committed.
    expect(spy).not.toHaveBeenCalled();

    // Flush the frame: latest-wins (3000), exactly one notify.
    expect(rafCb).not.toBeNull();
    rafCb!();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(dateTime.get().getTime()).toBe(3000);

    unsub();
    vi.unstubAllGlobals();
  });
});
