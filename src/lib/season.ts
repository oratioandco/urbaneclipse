/**
 * The leaf season, in one place. Berlin's broadleaf street trees are taken to be in full leaf
 * from May to October, bare from December to March, and to turn through April and November
 * (half out on 15 April, half gone on 15 November). The planner's scene draws them so
 * (src/miniature/trees.js: a bare crown is drawn at 18 % of its width), the sight-line check
 * measures them so (src/miniature/shotVisibility.js), and a row's words follow: "street trees
 * in the way" in leaf, "bare trees in the frame" out of it (src/miniature/dayShots.js).
 * Conifers keep their crowns all year.
 */

/** 1 in leaf, 0 bare: December to March bare, ramping through April and November. */
export function leafOn(date: Date): number {
  const month = date.getUTCMonth();
  const day = date.getUTCDate() / 30;
  if (month >= 4 && month <= 9) return 1;
  if (month === 3) return Math.min(1, day);
  if (month === 10) return Math.max(0, 1 - day);
  return 0;
}

/** Whether the trees count as in leaf at an instant: from mid-April to mid-November. */
export const inLeaf = (t: number): boolean => leafOn(new Date(t)) >= 0.5;

/** A broadleaf crown's drawn width as a share of its listed one, for a leaf amount. */
export const crownShare = (leaf: number): number => 0.18 + 0.82 * leaf;
