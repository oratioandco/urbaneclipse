# Urban Eclipse handoff, 2026-11-04

Start here for the next session. This file is untracked, like the older handoff beside it, which is from
2026-07-31 and out of date.

## Live state

- Primary URL: https://urbaneclipse.oratio.co/ (Let's Encrypt, valid until 2027-02-02)
- Old URL, kept so existing links work: https://plastervoid-n.2.28.29.90.sslip.io/
- Coolify app "Plaster Void", uuid `dcqd5hrcyrnfnlvqmhk4et6r`, context `cax21`
- Live build: `a844a5e`. Later commits on `main` only touch the README and screenshot.

## Commands

- Use Node 22 (`.nvmrc`); Astro refuses to start on Node 20.
- `npm test` for unit tests. `astro dev` reports the server that is already running, if there is one
  (on 2026-11-04 it was http://127.0.0.1:4323).
- Deploy: push to `main`, then run `coolify deploy uuid dcqd5hrcyrnfnlvqmhk4et6r --context cax21`.
  Pushing alone does not build.
- A deploy on 2026-11-04 failed at the clone with `Permission denied (publickey)`. The retry worked,
  with no changes. Check the deploy status rather than assuming it worked.
- WebGL capture needs a headed browser: `chromium.launch({ headless: false, args: ['--use-angle=metal'] })`.
  Headless swiftshader times out.

## Changed in the last session

- Button rows in the panels now wrap (`.pv-btn-row` in `src/styles/global.css`).
- "Reset viewpoint & target" is now "Reset view & target", because the old label was wider than the panel.
- At 1600x900, 1280x800 and 390x844, no button passes its panel edge.
- `docs/images/urban-eclipse-lichtenberger-bruecke.jpg` was captured from the new domain. The same image is
  used in the `oratioandco` profile as `assets/readme/source/urban-eclipse.jpg`, so replace both.

## Seen but not fixed

- The target marker in the top-view map sits on top of the "Berlin" label.
- In the Placement panel, field labels and values wrap unevenly ("Lichtenberger / Brücke",
  "surveyed / viewpoint").
- At 1600x900 the right rail's text ends right at the Solar Day panel; the rail scrolls for the rest.
- The left rail also scrolls: its lower controls, such as the sensor buttons and framing, start out of view.
