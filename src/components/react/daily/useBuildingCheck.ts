/** Checks a list of passes against the 3D scene, without holding up the frame rate. */
import { useEffect, useState } from 'react';
import type { SceneApi } from '../CesiumViewer.js';

interface Pass {
  peak: number;
  bodyAz: number;
  bodyAlt: number;
}

/**
 * Which passes have buildings covering the disc, by their peak time. Null until checked.
 * `rangeM` limits how far the check looks; without it, it stops short of the landmark.
 */
export function useBuildingCheck(
  api: SceneApi | null,
  passes: readonly Pass[] | null,
  ready: boolean,
  rangeM?: number,
): Set<number> | null {
  const [hidden, setHidden] = useState<Set<number> | null>(null);
  useEffect(() => {
    setHidden(null);
    if (!api || !passes || !ready) return;
    let cancelled = false;
    const found = new Set<number>();
    let i = 0;
    let unknown = 0;
    const step = (): void => {
      if (cancelled) return;
      const until = performance.now() + 8;
      while (i < passes.length && performance.now() < until) {
        const verdict = api.bodyBlocked(passes[i].bodyAz, passes[i].bodyAlt, rangeM);
        if (verdict === 'blocked') found.add(passes[i].peak);
        if (verdict === 'unknown') unknown++;
        i++;
      }
      if (i < passes.length) {
        requestAnimationFrame(step);
      } else if (unknown === passes.length && passes.length > 0) {
        // Tiles were still streaming: nothing was decided, so look again shortly.
        i = 0;
        unknown = 0;
        window.setTimeout(step, 500);
      } else {
        setHidden(new Set(found));
      }
    };
    requestAnimationFrame(step);
    return () => {
      cancelled = true;
    };
  }, [api, passes, ready, rangeM]);
  return hidden;
}
