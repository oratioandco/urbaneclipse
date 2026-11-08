# Photo landmarks: what people actually shoot with the sun or moon

Merged ranking for Plan 1 of the 2026-11-08 handoff. Four research lenses
(photo-platform volume, editorial guides, communities and spot databases,
alignment geometry) plus a LoD2 tile probe, described under Method below.
Scores are 0-100, anchored to Fernsehturm = 95.

Already modelled: Fernsehturm, Oberbaumbrücke, Frankfurter Tor — and now,
on this branch, the Brandenburger Tor and the Siegessäule (src/miniature/
landmarks.js), the top two that were missing.
The probe found every candidate inside the 9 km tile area, including the
Funkturm, which the geometry lens had placed outside at 11.57 km.

## Ranking

### 1. Fernsehturm — 95 — already modelled

- Why: the dominant Berlin sky motif on every proxy. Wikimedia Commons has
  ~3,400 tower files with sunset and moon subsets in the dozens; a dedicated
  German photo blog article (fokussiert.com) exists solely for planning
  moon-vs-tower shots; a photographer plans full-moon rises behind the sphere
  monthly and sells it as a poster; ~5,800 stock images on Adobe Stock alone.
  It is also the backdrop or alignment target in most other landmarks' shots.
- Camera spots: Treptower Park / Insel der Jugend across the Spree;
  Märkisches Ufer and Fischerinsel for the tower over the river;
  Karl-Marx-Allee looking west; Park Inn roof terrace (tripods allowed, best
  at sunset); Frankfurter Tor (telephoto, tower between the two domes);
  Ebertsbrücke reflections; 1-3 km east for planned moonrise frames.
- Alignment: full-moon rise behind the sphere, computed with PhotoPills/TPE,
  spots shifting each lunation. Sunset silhouettes it from eastern vantages;
  from Oberbaumbrücke (bearing 309.8°) the sun sits behind it ~1 Jun and
  ~9-11 Jul.
- LoD2: done (the scene origin, exact at 0,0).

### 2. Brandenburger Tor — 82

- Why: second-strongest motif on Commons (sunset 46-74 hits, moon 22-23) and
  the core of #berlinhenge: the sun aligned down the east-west axis straight
  through or behind the gate. Flickr feeds show a full recent sample for both
  sunset and moon tags, including curated/Explored work. visitBerlin lists it
  as a sunset tip; the sun-in-the-arch telephoto is a recognised signature.
- Camera spots: Pariser Platz east side (frontal symmetry, empty at sunrise);
  Straße des 17. Juni west side shooting east through the opening at sunrise;
  Ebertstraße for 3/4 dusk frames; telephoto from the eastern pillars down
  Unter den Linden toward the Fernsehturm.
- Alignment: gate axis 83-84° / 263-267°. Sunrise directly behind the gate
  ~30-31 Mar and ~12 Sep; sunset drops behind it from Pariser Platz in summer.
  Moon aligned down the axis recurs monthly.
- LoD2: needs full model. Probe r7288267: gate body is a plain 23 m block;
  colonnade, attica and quadriga are missing. Cut the block roof and model
  the gate to ~20 m, quadriga to 26 m.

### 3. Oberbaumbrücke — 71 — already modelled

- Why: sunset tip 1 in visitBerlin's official top-11 list. Dedicated
  TravelPixelz guide with GPS coordinates for the sun-behind-the-bridge shot;
  PhotoHound spot page; DW Travel sunset coverage; Tagesspiegel recommends it
  for eclipse watching. Commons sunset 27+12 hits, essentially no moon tags,
  but Flickr feeds return an active recent sunset sample. The classic
  two-landmark composition adds the Fernsehturm rising behind it.
- Camera spots: Friedrichshain riverbank between the bridge and the Wall
  Museum (52.502433, 13.445931) for the sun behind the twin towers;
  Warschauer Straße U-Bahn platform; the bridge deck looking west toward
  Mitte; Elsenbrücke for bridge + Molecule Man + tower stacked.
- Alignment: bridge runs roughly N-S, so low sun backlights it from the east
  bank around the equinoxes; blue-hour floodlights and U1 light trails after.
  The bridge axis toward the tower (309.8°) is the highest-yield moon
  alignment in the city: moonsets behind the tower recur monthly near dec +22.
- LoD2: done (bridge and domes live since commit 21a741a).

### 4. Siegessäule — 66

- Why: the other half of Berlinhenge. The sun setting at bearing 266.6° puts
  the disc directly on the golden Victoria at 67 m, shot from the
  Brandenburger Tor end of Straße des 17. Juni, documented by DW Travel and
  #berlinhenge scouting posts. Tag counts undersell it (Commons sunset 13,
  Flickr 0 recent) because people tag the street or "Berlin", not the column;
  ~424 Adobe Stock results for "Straße des 17. Juni" support the axis motif.
  The thin lathe-profile silhouette suits sun/moon-on-statue telephoto work.
- Camera spots: Straße des 17. Juni 1.2-2 km east of Großer Stern looking
  west (sun on Goldelse); Großer Stern roundabout; from the column's own
  platform looking east to the Fernsehturm (no tripods); Drachenberg for the
  skyline-with-column sunrise view.
- Alignment: sunset on the statue ~15-16 Mar and ~27-28 Sep; moonsets at the
  same azimuth recur monthly, giving many more moon-on-column chances per
  year than sun. No established moon-behind-Goldelse tradition yet — a
  candidate novel motif for the planner.
- LoD2: needs full model. Probe way 718035022: everything (base, colonnade
  with height tags to 45.5 m) flattened to exactly 25 m. Build a lathe
  profile like the Fernsehturm, to 67 m with the Victoria.

### 5. Berliner Dom — 59

- Why: one of Berlin's most-photographed silhouettes. Commons sunset 24+27
  hits; Flickr feeds return a full recent sunset sample; dedicated 9-spot
  guide; almost always composed with the Fernsehturm directly behind it, so
  it doubles as the second subject in tower shots. Moon-behind-dome
  compositions are common in stock and social imagery.
- Camera spots: Lustgarten front-on (sunrise lights the facade); Monbijou-
  brücke and Monbijoupark; Schlossbrücke and Ebertsbrücke for dome + tower
  stacks and Bode Museum reflections; the tree line for the dome-framed
  tower-ball telephoto.
- Alignment: from western vantages looking ESE (~110-122°), moonrise passes
  behind the dome monthly and sunrise recurs ~14 Feb and ~27 Oct. Direct
  sun-behind-dome is rare — the Dom is more a lit subject than a disc target.
- LoD2: needs cut + model. Probe way 313670734: body only at 43.4 m; the
  entire 114 m dome and lantern are missing. Cut the flat roof and model
  drum, dome and lantern.

### 6. Reichstag — 53

- Why: largest raw Commons volume of all candidates ("Reichstag" Berlin moon
  214, sunset 154), with genuine motif files ("Full Moon over the Reichstag
  building in Berlin"), but full-text search also matches Spree-bank
  government-quarter panoramas, so the effective volume is lower. visitBerlin
  and berlin-tickets document the west-facing dome glass catching sunset.
  Communities treat it mostly as a vantage/interior subject.
- Camera spots: Platz der Republik west lawn for sunset behind the west
  facade; Spree banks at Paul-Löbe-Haus and Gustav-Heinemann-Brücke;
  Scheidemannstraße; from the dome ramp looking west at sunset (reservation,
  no tripods).
- Alignment: sunset drops behind the dome from Platz der Republik within
  about a week of both equinoxes; moonset behind the dome recurs monthly.
  Weak as a henge target: it sits 0.29 km north of the 17. Juni axis, so the
  street-alignment shot only glances it.
- LoD2: needs cut + model. Probe relation r2201742: building capped at
  35.2 m (real 47-48 m) and the glass cupola (to ~75 m) missing entirely.

### 7. Frankfurter Tor — 48 — already modelled

- Why: the eastern gateway of Berlin's strongest street-henge axis
  (Karl-Marx-Allee/Frankfurter Allee, named by CityHenge). PhotoHound and
  photo blogs document the composition: the Fernsehturm aligned almost
  exactly between the two 66 m towers looking west, best at sunset with a
  telephoto. Platform tag counts found almost nothing (Commons sunset 0),
  which undersells a well-documented spot — the score is a compromise.
- Camera spots: Karl-Marx-Allee median at the Tor looking west (towers frame
  the tower); mid-Allee looking east at the twin towers; from the Südturm
  platform; U-Bahn walkway for the vista.
- Alignment: KMA axis 111.8°/288.5°. Sunset down the alley toward the city
  ~17-18 Apr and ~24-25 Aug; sunrise between/behind the towers ~13-14 Feb and
  ~26-27 Oct; moon between the towers recurs monthly.
- LoD2: done (domes live since commit 21a741a).

### 8. Molecule Man — 40

- Why: small landmark, high share of sky motifs — sunset shots are a large
  fraction of everything shot there (9 of ~117 Commons files; Flickr returns
  a full 20-item recent sample for moleculeman+sunset, as many as the tower).
  A German blog post is titled "Sonnenuntergang am Molecule Man"; stock
  archives carry dedicated sunset images from the Elsenbrücke.
- Camera spots: Elsenbrücke looking west (statue mid-river, skyline behind);
  Spree banks at Puschkinallee/Tamara-Danz-Straße; Insel der Jugend;
  kayak/boat level for water reflections.
- Alignment: backlit sunset silhouette from the Elsenbrücke is the
  established shot; summer sunsets can drop directly behind the figure.
  Geometry caveat: its bearing from Oberbaumbrücke (25.4°) is below the solar
  sunrise minimum, so the sun can never rise behind it from the bridge.
- LoD2: needs full model. Probe: nothing in the tiles at all (artwork node in
  open water, 30 m OSM height tag). A thin sculpture — suits a custom mesh
  or lathe like the Fernsehturm.

### 9. Kaiser-Wilhelm-Gedächtniskirche — 35

- Why: the broken-silhouette ruin is a stock staple at dusk and PhotoHound
  keeps a rated spot page, but aligned sun/moon shots are rare — it is a
  blue-hour lit subject first. Modest platform volume (Commons sunset ~10,
  moon ~0).
- Camera spots: Breitscheidplatz steps; Tauentzienstraße looking west from
  Wittenbergplatz (the ruin closing the vista); Monkey Bar / Bikini Berlin
  terrace looking over the Zoo.
- Alignment: Tauentzien/Budapester axis bearing ~253°. Sunset at that azimuth
  recurs ~mid-Feb and ~late Oct; moonsets monthly near dec -14. Workable
  geometry (71 m ruin from ~1 km), undocumented as a tradition.
- LoD2: mostly adequate. Probe way 15218373: ruin at 61.6 m vs real 71 m,
  broken top simplified — check the silhouette, maybe hand-cut the top; the
  53.5 m new church is present.

### 10. Rotes Rathaus — 29

- Why: a fixture of Mitte skyline shots but almost always as the foreground
  under the Fernsehturm 0.5 km away, which steals the disc. Thin standalone
  sun/moon volume (Commons sunset 10, moon 1).
- Camera spots: Marx-Engels-Forum and Neptunbrunnen looking east (Rathaus
  with tower rising behind); Spree/Monbijoubrücke axis; Humboldt Forum
  rooftop.
- Alignment: bearing 252.5° from the tower — sunset there recurs ~mid-Feb and
  ~late Oct, but the Fernsehturm usually holds the disc first. Practical
  shots are moon-over-town-hall from the Spree bridges, redundant with the
  Dom axis 250 m away.
- LoD2: adequately represented. Probe relation r4211905: central tower fully
  present at 83.7 m (74 m tower plus Rathausmann). No work needed.

### 11. Marienkirche — 25

- Why: only appears as the gothic foreground under the Fernsehturm
  (a Commons category "Remote views of Berliner Fernsehturm and Marienkirche"
  holds 96 files). No standalone alignment tradition; name ambiguity (Lübeck)
  depresses counts further.
- Camera spots: Alexanderplatz by the Weltzeituhr; Karl-Liebknecht-Straße;
  Rotes Rathaus forecourt; Park Inn roof for the church + tower at sunset.
- Alignment: sunset at its azimuth (~280° from the tower) falls on the same
  dates as the Berlinhenge sunrise, but any disc landing here can be re-aimed
  400 m at the Fernsehturm for a stronger shot. Low marginal value.
- LoD2: mostly adequate. Probe way 474111581: church and tower at 78.5 m,
  ~13 m short of the 92 m spire top — consider topping up.

### 12. Gasometer Schöneberg — 22

- Why: an Instagram/street-photography twilight subject with official sunset
  access (EUREF-Campus roof tours), but as an alignment target from the
  ground the evidence is two Commons moon files. Scores lean on geometry.
- Camera spots: Torgauer Straße for the silhouette; streets around
  An der Gasanstalt; long-lens from Kreuzberg hills with the Fernsehturm
  stacked 5 km beyond.
- Alignment: from the east it sits at 220-235°, near the winter-solstice
  sunset minimum — low winter sun behind a fat cylinder is genuinely good
  geometry; moonsets there recur around winter full moons. No community
  precedent found; would be an original planner motif.
- LoD2: mostly adequate. Probe relation r13132134: cylinder present at
  65.6 m, 12 m short of the 78 m roof — raise/round the top if it features.

### 13. Park Inn (Alexa) — 21

- Why: known almost exclusively as a vantage, not a subject. The rooftop
  terrace is one of Berlin's top sunset photo locations (tripods allowed),
  but no posts align the sun or moon behind the slab itself, and the flat
  form is a poor disc backdrop next to the tower 330 m away.
- Camera spots: as vantage, the roof terrace at sunset (also its role in the
  planner); as subject, from the Karl-Marx-Allee axis behind the Weltzeituhr.
- Alignment: bearing 59.3° from the tower, marginally inside the solar
  sunrise band (~early May / ~early Aug); moonrise monthly. Geometrically
  possible, photographically unpopular.
- LoD2: adequately represented. Probe way 23723125: full 126.4 m slab. No
  work needed.

### 14. Funkturm — 21

- Why: a historic photo subject (Moholy-Nagy 1928, ~1,900 stock results) but
  essentially no sun/moon alignment documentation anywhere. It appears as a
  foreground/side element in Drachenberg sunrise panoramas and Messe aerials.
- Camera spots: Drachenberg (Teufelsberg) for sunrise panoramas; Messe
  S-Bahn bridge over Jafféstraße; AVUS grandstand; Masurenallee.
- Alignment: a tower-to-tower sunrise shot (Funkturm in front, Fernsehturm
  11.6 km behind, az 81.7°, ~1-2 Apr / ~9-10 Sep) is geometrically real and
  would need both towers modelled and clean air; nobody is documented
  shooting it routinely.
- LoD2: present but coarse. Probe way 30926247: a 134.4 m solid mast form
  (real 147-150 m), only 46 verts — the lattice silhouette is simplified.
  The probe corrects the handoff: it IS inside the area (|x| = 8914 < 9400).
  Check the eye-level look; likely needs a lathe/model to sell the
  legs-and-basket silhouette.

### 15. Treptowers — 20

- Why: the 125 m high-rise appears as a background block in Treptower Park
  and Elsenbrücke sunset shots, rarely as the named subject. No moonrise or
  photo-guide entries found.
- Camera spots: Elsenbrücke shooting west (towers at frame edge with
  Molecule Man); Treptower Park Spree bank; Schillingbrücke.
- Alignment: bearing 130.3° from the Fernsehturm sits at the winter-solstice
  edge of the sunrise range — a sunrise-behind-the-tower shot is only
  marginally possible in early December and January; moonrise at that
  azimuth recurs monthly near dec -22 and is the realistic shot.
- LoD2: adequately represented. Probe way 23971473: the 125 m tower fully
  present at 128.1 m with its 47.7 m neighbours. No work needed.

## Sources

Editorial and guides:

- https://www.visitberlin.de/en/blog/top-11-locations-sunset-berlin
- https://www.travelpixelz.com/blog/photographing-berlin-tv-tower
- https://www.travelpixelz.com/blog/photographing-oberbaum-bridge
- https://www.travelpixelz.com/blog/photographing-brandenburg-gate
- https://synke-unterwegs.de/sonnenuntergang-berlin
- https://www.tagesspiegel.de/berlin/tipps-zur-sonnenfinsternis-und-den-perseiden-in-berlin-von-wo-aus-sich-die-besonderen-himmelsereignisse-am-besten-beobachten-lassen-15934242.html
- https://www.berlin-tickets.com/reichstag/photos
- https://www.berlin.de/tourismus/fotos/sehenswuerdigkeiten-fotos/1355474-1355138.gallery.html?page=1

Spot databases and communities:

- https://www.photohound.co/spot/oberbaumbrucke-2107
- https://www.photohound.co/spot/frankfurter-tor-1003733
- https://www.photohound.co/spot/elsenbrucke-2117
- https://www.photohound.co/spot/kaiser-wilhelm-memorial-church-new-2111
- https://cityhenge.com/cities/berlin
- https://www.reddit.com/r/berlin/comments/i3fdwr/mond_hinterm_fernsehturm_30720
- https://www.reddit.com/r/berlinpics/comments/1nwkmjv/berliner_fernsehturm_berlin_tv_tower_and_the
- https://printler.com/de/poster/88358
- https://commons.wikimedia.org/wiki/Category:Remote_views_of_Berliner_Fernsehturm_and_Marienkirche

Platform-volume probes (representative queries):

- https://fokussiert.com/mondfotos-in-berlin-krater-neben-dem-fernsehturm
- https://commons.wikimedia.org/w/api.php?action=query&list=search&srsearch=%22Brandenburger%20Tor%22%20sunset&srnamespace=6
- https://commons.wikimedia.org/w/api.php?action=query&list=search&srsearch=%22Reichstag%22%20Berlin%20moon&srnamespace=6
- https://www.flickr.com/services/feeds/photos_public.gne?tags=fernsehturm,sunset&tagmode=all&format=json
- https://www.flickr.com/services/feeds/photos_public.gne?tags=moleculeman,sunset&tagmode=all&format=json
- https://stock.adobe.com/search?k=%22stra%C3%9Fe%20des%2017%20juni%22
- https://www.instagram.com/explore/tags/berlinhenge/

## Method

Four independent research lenses were merged: (1) photo-platform volume
(Wikimedia Commons full-text file search counts with sampled-title noise
checks, Flickr public-feed tag-presence checks, Adobe Stock as a proxy);
(2) editorial guides (visitBerlin, TravelPixelz, synke-unterwegs,
Tagesspiegel, berlin.de); (3) communities and spot databases (Reddit,
PhotoHound, PIXEO, CityHenge, print sales); (4) alignment geometry (spherical
bearings, sun/moon rise-set azimuth ranges for Berlin lat 52.52, alignment
dates per axis, 9 km tile-area check). Scores were averaged across lenses
and then weighted toward concrete evidence — dedicated guides, spot pages,
named alignment traditions — over generic list mentions. That raised
Siegessäule and Frankfurter Tor (street-axis motifs that tag counts miss) and
lowered Reichstag, Park Inn and Funkturm (raw volume inflated by full-text
noise or vantage fame). The LoD2 state comes from a tile probe:
`scripts/miniature/check_landmark_lod.mjs` (commit b5d3fd1, branch
experiment-miniature-city), which decodes the LOD0 vertex buffers of each
landmark's covering tiles, fetches footprints from the OSM API 0.6 map
endpoint, and reports max vertex height per footprint. Known gaps: Flickr's
public feed caps at 20 items (presence only, not counts); 500px and
PhotoPills/TPE communities were unreachable; moon-shot volumes are
undercounted relative to Instagram planning culture; Gasometer, Treptowers,
Park Inn, Marienkirche and Rotes Rathaus rest mostly on the geometry lens.
