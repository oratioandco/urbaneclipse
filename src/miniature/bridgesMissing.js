/**
 * Bridges the city model does not have, or has without a deck one can be stood on. The planner
 * says so where one tries to stand on them, instead of putting the photographer on the terrain
 * under the bridge, or on the nearest street beside it, without a word.
 *
 * Two kinds, both found with scripts/adversarial/bridge.mjs on 2026-11-24:
 *   - no deck in the building model at all (Langenscheidt-, Elsen-, Oberbaumbrücke): one stands
 *     on the bare-earth terrain, which is the rail cutting or the river bank under the bridge;
 *   - a span without its approaches (Böse-, Swinemünder Brücke): the deck ends in the air and
 *     cannot be told from a viaduct over a street, so it is not stood on (decks.js).
 * The cure for the second kind is OpenStreetMap's `bridge` tag in the street data
 * (scripts/build_streets.py); its inputs (data/streets/osm) were not on the machine this was
 * written on. Take a bridge off this list when the model has it.
 *
 * Each box is the bridge's outline in OpenStreetMap (`man_made=bridge`, Nominatim, 2026-11-24):
 * south, north, west, east in degrees, with the way's id.
 */
export const BRIDGES_NOT_IN_MODEL = [
  { name: 'Bösebrücke', way: 380356103, box: [52.5545109, 52.5548866, 13.3971183, 13.3991993] },
  { name: 'Swinemünder Brücke', way: 590865980, box: [52.5477783, 52.5495357, 13.3920172, 13.3940591] },
  { name: 'Langenscheidtbrücke', way: 686721915, box: [52.4882633, 52.4888972, 13.3628928, 13.3639829] },
  { name: 'Elsenbrücke', way: 1017420119, box: [52.4951893, 52.4964897, 13.4623362, 13.4640283] },
  { name: 'Oberbaumbrücke', way: 288514442, box: [52.5011205, 52.5023462, 13.4447993, 13.4465234] },
];

/**
 * Places the deck rule (decks.js) takes for a road bridge that are a railway viaduct: a way
 * runs along under the arches and comes out without a step. Nobody stands on these. Found by
 * `bridge.mjs census` on 2026-11-24 and looked up in OpenStreetMap (Overpass): both are the
 * Stadtbahn viaduct at Savignyplatz, `building=viaduct` (ways 266284848 and 96837199) under
 * `railway=rail, bridge=viaduct` (ways 57727709 and 254133723). Each is the cell's place and a
 * radius in metres. The lasting cure is the same as above: the `bridge` tag, by kind of way.
 */
export const RAIL_VIADUCTS = [
  { name: 'Stadtbahn viaduct, Savignyplatz west', lat: 52.50465, lon: 13.32633, radiusM: 60 },
  { name: 'Stadtbahn viaduct, Lotte-Lenya-Bogen', lat: 52.50509, lon: 13.32914, radiusM: 60 },
];

const METRES_PER_DEG_LAT = 111_320;

/** Whether a place is on one of the railway viaducts listed above. */
export function railViaductAt(lat, lon) {
  return RAIL_VIADUCTS.some((v) => Math.hypot((lat - v.lat) * METRES_PER_DEG_LAT, (lon - v.lon) * METRES_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180)) <= v.radiusM);
}

/**
 * The bridge of the list a place lies on or within `marginM` of (the photographer may already
 * have been moved to the street beside it), or null.
 */
export function missingBridgeAt(lat, lon, marginM = 25) {
  const dLat = marginM / METRES_PER_DEG_LAT;
  const dLon = marginM / (METRES_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180));
  return BRIDGES_NOT_IN_MODEL.find(({ box: [south, north, west, east] }) => lat >= south - dLat && lat <= north + dLat && lon >= west - dLon && lon <= east + dLon) ?? null;
}

/** What the planner says there. */
export const missingBridgeNote = (bridge) => `The ${bridge.name} is not in the model yet. You stand on the ground beside or under it, not on its deck: heights and sightlines from the bridge itself will differ.`;
