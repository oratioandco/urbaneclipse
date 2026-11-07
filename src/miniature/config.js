/** Settings, some open to the address for testing (?shadow=, ?budget=, ?mirror=, ?samples=). */

export const params = new URLSearchParams(location.search);
/** The city's geometry, built by scripts/miniature and served from a volume. Bump the version on a rebuild. */
export const CITY = '/city/';
export const CITY_VERSION = '?v=1';
export const isPhone = Math.min(innerWidth, innerHeight) < 600;
export const SHADOW_SIZE = Number(params.get('shadow')) || (isPhone ? 2048 : 4096);
export const TRIANGLE_BUDGET = Number(params.get('budget')) || (isPhone ? 1_200_000 : 5_000_000);
/** A level is good enough once its error covers fewer pixels than this. */
export const ERROR_PX = 1.5;
export const LIGHT_DISTANCE = 30_000;
export const VIEW_RADIUS = 12_000;
export const MIRROR_SCALE = Number(params.get('mirror') ?? 0.5);
/** Buildings further from water than this cannot show in its reflection from these views. */
export const REFLECTION_REACH_M = 280;
