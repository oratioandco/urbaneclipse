# Feature Specification: Telephoto Line-of-Sight Planner ("Plaster Void")

**Feature Branch**: `001-telephoto-los-planner`

**Created**: 2026-07-20

**Status**: Draft

**Input**: User description: "A web-based 3D geospatial planning tool for extreme telephoto photography that calculates precise line-of-sight occlusion and celestial (Sun/Moon) alignments between an observer and a target structure, rendered in a stylized 'plaster/clay model' aesthetic, with a reverse-ephemeris solver to find alignment dates."

## User Scenarios & Testing *(mandatory)*

<!--
  User stories are ordered by priority. Each is an independently testable
  slice: implementing just P1 yields a viable MVP (a working occlusion
  checker). The "Plaster Void" aesthetic is treated as a first-class
  feature (P2), not optional polish.
-->

### User Story 1 - Line-of-Sight Occlusion Assessment (Priority: P1)

As an extreme-telephoto photographer, I want to place an observer and a
target structure at adjustable heights and immediately see whether the
sightline between them is blocked by intervening buildings, so that I
know whether a planned long-distance shot is physically possible before
traveling to the location.

**Why this priority**: This is the core physics the tool exists to answer
— "is the shot blocked?" Every other capability builds on a real scene
with a real sightline.

**Independent Test**: Place the observer at Lichtenberger Brücke (1.5 m)
and the target at the Berliner Fernsehturm (~210 m); verify the tool
shows a clear sightline and reports "unobstructed." Move the observer
behind a taller intervening building and verify it reports "blocked."

**Acceptance Scenarios**:

1. **Given** an observer and target placed in the scene, **When** the user
   adjusts the observer or target height, **Then** the sightline occlusion
   recomputes and the visual indicator updates within a perceivably
   immediate response.
2. **Given** an unobstructed sightline, **When** an intervening building
   grows tall enough to cross the line, **Then** the indicator switches
   from "clear" to "blocked."
3. **Given** a blocked sightline, **When** the user raises the target
   height above the intervening obstacle, **Then** the indicator switches
   back to "clear."

---

### User Story 2 - Plaster Void Visual Aesthetic (Priority: P2)

As a photographer, I want the scene to look like a pure white plaster/clay
architectural model floating in a hazy, grainy studio void — not a
conventional satellite map — so the tool has a distinctive, art-directed
identity that isolates pure geometry and light.

**Why this priority**: The aesthetic is an explicitly required, defining
product feature. It differentiates the tool from every GIS map and centers
attention on form and shadow.

**Independent Test**: Open the scene; confirm buildings render as uniform
matte-white geometry, there is no map imagery, sky, or realistic
atmosphere, the background is a soft hazy void, and the overall read is
"physical architectural plaster model."

**Acceptance Scenarios**:

1. **Given** the scene is loaded, **When** rendered, **Then** buildings
   appear as uniform matte white with no satellite/road imagery and no
   realistic sky box or atmosphere.
2. **Given** distant geometry, **When** viewed, **Then** it fades into a
   soft, depth-based haze so the scene reads as a model in fog rather than
   an infinite landscape.
3. **Given** the scene, **When** rendered, **Then** a subtle film grain is
   present, reinforcing the physical-model/studio feel.

---

### User Story 3 - Temporal Celestial Lighting (Priority: P3)

As a photographer, I want to set any date and time and see the sun and
moon positions and resulting shadows update in real time, so I can preview
the exact light for a planned shoot moment.

**Why this priority**: Light direction and shadow length make or break a
telephoto architectural shot; scrubbing time is essential to planning.

**Independent Test**: Set the date/time to a known Berlin sunrise; verify
the sun sits low in the east and shadows extend long to the west. Scrub
forward to solar noon; verify shadows shorten.

**Acceptance Scenarios**:

1. **Given** a selected date/time, **When** the user scrubs the time,
   **Then** the sun's position and all building/terrain shadows update in
   real time without a perceivable hitch.
2. **Given** a nighttime date/time, **When** the sun is below the horizon,
   **Then** the scene reflects low-light conditions consistent with the
   moon's presence.
3. **Given** any date/time, **When** rendered, **Then** the sun/moon
   azimuth and altitude correspond to the correct ephemeris for Berlin's
   latitude at that moment.

---

### User Story 4 - Golden & Blue Hour Timeline (Priority: P4)

As a photographer, I want a color-coded daily timeline showing golden and
blue hour windows, so I can target the most photogenic light.

**Why this priority**: Golden and blue hours are the highest-value shooting
windows; surfacing them on the time control directs the user straight to
the best moments.

**Independent Test**: Select a date; confirm the timeline marks a
golden-hour band (amber) around sunrise/sunset and a blue-hour band (blue)
around twilight, and that moving the time slider into a band highlights it.

**Acceptance Scenarios**:

1. **Given** a selected date and location, **When** the timeline renders,
   **Then** it marks golden hour and blue hour windows for that day.
2. **Given** the time slider, **When** positioned within a golden/blue
   hour, **Then** that band is visually highlighted.
3. **Given** different times of year, **When** the date changes, **Then**
   the golden/blue hour windows shift to match seasonal daylight.

---

### User Story 5 - Reverse Ephemeris Alignment Search (Priority: P5)

As a photographer, I want to ask "when will the moon (or sun) appear
behind the target at the right angle?" over a date range and get back the
exact dates — so I can plan rare alignment shots (e.g., full moon behind
the Fernsehturm).

**Why this priority**: Celestial alignments are rare and hard to find by
hand; a solver that finds them is a high-value, differentiating capability.

**Independent Test**: Run a search for "moon behind the Fernsehturm" over a
one-month range; confirm the solver returns specific dates/times and that
at each returned time the moon's azimuth/altitude is within tolerance of
the target line.

**Acceptance Scenarios**:

1. **Given** a target body (sun/moon), a required azimuth/altitude, and a
   date range, **When** the user runs the search, **Then** the solver
   returns the date(s)/time(s) where the body matches the required angles
   within tolerance.
2. **Given** a running search, **When** it executes, **Then** the UI stays
   responsive (the heavy compute does not freeze the page).
3. **Given** a range with no alignment, **When** the search completes,
   **Then** the tool clearly reports that no matching dates were found.

---

### User Story 6 - Camera/Lens Framing Preview (Priority: P6)

As a photographer, I want to choose my camera sensor, focal length, and
zoom and see an accurate preview of the framing/composition I would
actually capture, so I can plan lens choice and framing in advance.

**Why this priority**: Extreme telephoto framing is extremely sensitive to
focal length; previewing the real field of view prevents showing up with
the wrong lens.

**Independent Test**: Select a full-frame sensor and 600 mm lens pointed at
the target; confirm the previewed frame tightly frames the target structure
as it would in-camera. Switch to 200 mm; confirm the target shrinks to a
wider composition.

**Acceptance Scenarios**:

1. **Given** camera parameters (sensor, focal length, zoom), **When** set,
   **Then** the preview reflects the corresponding field of view.
2. **Given** a longer focal length, **When** selected, **Then** the framing
   narrows (target appears larger), matching real-world telephoto behavior.
3. **Given** the preview, **When** the user adjusts framing parameters,
   **Then** the composition updates to reflect the new field of view.

---

### Edge Cases

- What happens when the observer and target coincide or are extremely close
  (a degenerate sightline)?
- How does the tool report results when no celestial alignment exists in
  the searched range?
- How is occlusion reported when the sightline grazes (is tangent to) a
  building edge — a borderline case?
- What does the tool show when the selected time places the sun/moon below
  the horizon?
- How does the tool behave when the required building data has not yet been
  converted/loaded (data-procurement prerequisites incomplete)?
- What happens when the terrain/building-data access token is missing or
  invalid?
- How does the tool perform with very large building datasets (pan/zoom
  responsiveness)?
- How does the tool handle a reverse-search range so large that solve time
  becomes excessive?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST display an interactive 3D model of the Berlin
  cityscape (buildings + terrain) that the user can orbit, pan, and zoom.
- **FR-002**: The system MUST let the user define an observer point and a
  target point, each with an independently adjustable height above the
  ground/terrain.
- **FR-003**: The system MUST render a visual sightline between observer and
  target whose appearance indicates whether the path is blocked.
- **FR-004**: The system MUST compute whether the direct line between the
  observer eyepoint and the target point is occluded by any building or
  terrain between them, and MUST surface the result (blocked vs. clear) to
  the user.
- **FR-005**: The system MUST let the user set an arbitrary date and time
  and MUST position the sun and moon in the scene to match the real
  ephemeris for Berlin at that moment.
- **FR-006**: The system MUST render shadows that update in real time as the
  date/time changes.
- **FR-007**: The system MUST display a daily timeline that marks golden
  hour and blue hour windows for the selected date and location.
- **FR-008**: The system MUST let the user search, over a date range, for
  the dates/times when a chosen celestial body (sun or moon) appears at a
  required azimuth and altitude, and MUST return the matching date(s)/
  time(s).
- **FR-009**: The system MUST present reverse-search results as concrete,
  readable date(s)/time(s).
- **FR-010**: The system MUST let the user choose camera framing parameters
  (sensor size, focal length, zoom) and MUST preview the approximate
  real-world framing/composition those parameters produce.
- **FR-011**: The system MUST render the scene in a monochrome white
  "plaster/clay model" aesthetic in a soft hazy void, with no satellite/
  road map imagery, sky box, or realistic atmosphere — visually distinct
  from a conventional GIS map.
- **FR-012**: The system MUST perform heavy 3D rendering and long-running
  solve work off the main interface thread so that controls, timeline, and
  results remain responsive.
- **FR-013**: The system MUST clearly report when required external
  resources (building data, terrain service) are missing or unavailable,
  rather than failing silently.

### Key Entities *(include if feature involves data)*

- **Observer**: a standing point (location) with an adjustable eye height
  above ground.
- **Target**: a structure or point (location) with an adjustable reference
  height above ground.
- **Sightline**: the segment between the observer eyepoint and the target
  point, with a derived occluded/clear state.
- **CelestialBody**: the sun or moon, with a computed azimuth and altitude
  at a given time and location.
- **AlignmentWindow**: a date/time at which a celestial body matches a
  required set of angles (within tolerance).
- **CameraProfile**: sensor size, focal length, and zoom defining a field
  of view.
- **BuildingGeometry**: the 3D building/terrain model used for occlusion
  and rendering.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A photographer can determine whether a building blocks the
  sightline between two chosen points within 30 seconds of opening the tool.
- **SC-002**: For any date/time selected, the scene's lighting and shadows
  reflect the correct sun position for Berlin's latitude (verifiable
  against a known ephemeris).
- **SC-003**: The reverse-search returns alignment dates accurate to within
  1 minute of the true alignment time.
- **SC-004**: The golden/blue hour timeline correctly marks the
  photographic golden and blue hours for the selected date (verifiable
  against published sunrise/sunset/twilight tables for Berlin).
- **SC-005**: The camera/lens preview approximates the real-world framing a
  photographer obtains with the chosen gear, with a field of view matching
  the selected focal length on the selected sensor.
- **SC-006**: A first-time viewer recognizes the rendered scene as a "white
  plaster model in a hazy void" rather than a conventional satellite map
  (validated by visual review).
- **SC-007**: Scrubbing the time slider updates shadows within a perceivably
  immediate response on a standard modern machine.
- **SC-008**: A reverse-search over a one-month range completes without
  freezing the user interface.

## Assumptions

<!--
  Reasonable defaults chosen where the feature description did not specify
  details. No item below lacks a sensible default; none require blocking
  clarification before planning.
-->

- **v1 is scoped to Berlin (Mitte + Lichtenberg).** The required building
  data is procured for those districts, so v1 ships Berlin-only. Arbitrary,
  user-chosen worldwide locations are out of scope for v1 (the "e.g." in the
  objective refers to the default Berlin pair, not a global selector).
- The user manually downloads the LoD2 CityGML building data and supplies a
  hosted-terrain/tile-service access token; the tool does not auto-procure
  either resource.
- The tool is a single-user, client-heavy web application with no accounts
  or authentication.
- An internet connection is required (terrain service + data tiling).
- Default observer example: Lichtenberger Brücke; default target: Berliner
  Fernsehturm (~5.5 km away, ~210 m tall).
- Default observer height: 1.5 m (tripod); default target reference height:
  ~210 m.
- The reverse-search iterates at 1-minute resolution with a ±0.5° angular
  tolerance.
- The reverse-search UI initially operates from a fixed/hardcoded parameter
  set (a "mock" search bar); full free-form querying may follow in a later
  iteration.
- The plaster aesthetic, real-time shadow rendering, and time-driven
  lighting are hard requirements, not optional polish.
- The heavy 3D rendering is isolated from the page's server-side rendering
  so it only ever runs in the browser.
