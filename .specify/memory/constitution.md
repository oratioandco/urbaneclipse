<!--
  ============================================================
  SYNC IMPACT REPORT
  ============================================================
  Version change: (unratified template) → 1.0.0 → 1.0.1 → 1.1.0
  Bump rationale: 1.0.0 = initial ratification (MAJOR). 1.0.1 (PATCH,
    2026-07-20) = REPO_INIT resolved after `git init` (root commit
    abfa806 on main). 1.1.0 (MINOR, 2026-07-20) = Technology & Stack
    Constraints materially revised: scoped web-only (mobile removed),
    stack confirmed from the founding feature "Plaster Void" (Astro,
    React, CesiumJS, suncalc, nanostores, Tailwind), design language
    corrected to the project's plaster aesthetic, agent-env artifact
    removed. STACK_CONFIRM resolved.

  Principles established (all new):
    I.   Test-Driven Development (NON-NEGOTIABLE)
    II.  Defensive Programming
    III. Build, Test, Verify (NON-NEGOTIABLE)
    IV.  Never Assume — Research Before Acting
    V.   Infrastructure as Code — /infra + Coolify
    VI.  Git Discipline

  Sections established:
    - Core Principles (6)
    - Technology & Stack Constraints   (web-only; confirmed from the
      founding feature "Plaster Void" in v1.1.0)
    - Development Workflow & Quality Gates
    - Governance

  Templates requiring updates:
    - .specify/templates/plan-template.md      ✅ aligned (Constitution
      Check gate reads constitution dynamically)
    - .specify/templates/spec-template.md      ✅ aligned (MUST language +
      NEEDS CLARIFICATION markers match Principle IV)
    - .specify/templates/tasks-template.md     ✅ aligned (tests-first
      ordering + "verify tests fail before implementing" match I & III)
    - .specify/templates/checklist-template.md ✅ no constitution refs

  Follow-up TODOs:
    - RESOLVED 2026-07-20 (REPO_INIT): Repository initialized — root
      commit abfa806 on main, .gitignore in place.
    - RESOLVED 2026-07-20 (STACK_CONFIRM): Stack confirmed from the
      founding feature "Plaster Void" (specs/001-telephoto-los-planner);
      section scoped to web-only in v1.1.0.
  ============================================================
-->

# Urban Eclipse Constitution

## Core Principles

### I. Test-Driven Development (NON-NEGOTIABLE)

Every unit of behavior is specified by a failing test before any
production code is written to satisfy it. The Red-Green-Refactor cycle
is strictly enforced for all non-trivial logic.

- Tests MUST be written first, reviewed/approved, and confirmed to FAIL
  before implementation begins.
- No production code is merged unless it is covered by a passing test
  that would have failed without it.
- Bug fixes MUST begin with a reproducing test (Red), then the fix
  (Green).
- Refactor only while tests stay green; behavior change and refactor
  MUST NOT be mixed in one step.

**Rationale**: The cheapest moment to fix a defect is the instant it is
conceived. Tests are the executable specification; writing them first
makes the specification concrete and verifiable rather than aspirational.

### II. Defensive Programming

All code is written assuming its inputs, environment, and dependencies
will fail in adversarial ways. Correctness does not depend on
cooperation from callers, users, or external systems.

- Validate every input at trust boundaries (public APIs, network,
  user input, file/DB reads). Internal code MAY trust typed contracts.
- Fail fast and explicitly. No silent swallows of errors; every caught
  exception MUST be logged, rethrown, or translated into a deliberate,
  documented default.
- Make illegal states unrepresentable: prefer sum types, guards, and
  assertions over comments that say "must not be null".
- Fail closed by default: on error, default to the safe state (deny,
  no-op, empty) rather than the permissive one.
- Handle the null/empty/overflow/timeout/parse-failure path in every
  branch that can produce it.

**Rationale**: Urban Eclipse ships components that interact with
untrusted external data. Defensive code localizes failures so a single
bad input degrades one request instead of corrupting state or crashing
the system.

### III. Build, Test, Verify (NON-NEGOTIABLE)

A change is not done when the code is written; it is done only when it
builds cleanly, passes the full test suite, and is verified against its
acceptance criteria. No work is declared complete on assumption.

- The project MUST build reproducibly from a clean checkout before any
  change is marked complete.
- The full test suite MUST pass locally (and in CI when available)
  before commit/merge. Skips and exclusions MUST be explicit and
  justified in the commit message.
- Every change MUST be verified against its acceptance scenarios in
  spec.md — run it, observe it, and confirm the documented outcome.
- "It should work" is not verification. Produce the command, the
  output, and the observed result.

**Rationale**: Unverified changes are the dominant source of regressions
and false-confidence. Making build + test + verify a hard gate converts
"done" from a feeling into evidence.

### IV. Never Assume — Research Before Acting

When a fact, API, dependency, behavior, or integration detail is
uncertain, the agent MUST research and confirm it before writing code
that depends on it. Unknowns are surfaced, not papered over.

- Before importing a library or calling an API, confirm it exists, the
  version is correct, and the documented behavior matches the assumed
  usage. Verify against `package.json` / `pubspec.yaml` / `Package.swift`
  or official docs — never assume a dependency is installed.
- Unknowns MUST be made explicit via `NEEDS CLARIFICATION` markers in
  specs/plans rather than guessed and silently baked into code.
- When blocked on a genuine external unknown, research it (docs, web,
  source) first; only escalate to the user when research is exhausted.
- State assumptions explicitly when they cannot be avoided, and flag
  them for review.

**Rationale**: Most integration defects come from an unstated
assumption that was never checked. Requiring research-before-coding
turns hidden assumptions into explicit, reviewable decisions.

### V. Infrastructure as Code — /infra + Coolify

All deployment infrastructure is managed as code via the `/infra` skill
(Hetzner + Coolify + Tailscale). Coolify is the deployment target. No
manual, unreproducible server configuration is permitted.

- Every shippable service MUST have a defined deployment path to
  Coolify (build context, Dockerfile or buildpack, env, health check).
- Infrastructure changes MUST be made through the `/infra` workflow and
  recorded — not by hand on a live server. Snowflake servers are
  prohibited.
- Secrets MUST be provided via Coolify environment variables / secret
  management, never committed to the repository.
- Every deployed service MUST expose a health/readiness check and
  meaningful logs.

**Rationale**: Reproducible, codified infrastructure is the difference
between a service that can be rebuilt in minutes after failure and one
that lives only in one person's head.

### VI. Git Discipline

Version control follows trunk-based, reviewable, atomic practices. The
repository history is a readable narrative of the project.

- One logical change per commit; commits are atomic and independently
  revertible.
- Commit messages follow Conventional Commits (`feat:`, `fix:`,
  `docs:`, `refactor:`, `test:`, `chore:`, `ci:`) with an imperative
  subject and a body explaining why.
- Feature work happens on a branch; `main`/`trunk` is kept green and
  deployable. No direct large changes to `main`.
- A `.gitignore` MUST be in place before the first commit; secrets,
  build artifacts, and editor/OS files MUST never be committed.
- Small, frequent commits are preferred over large end-of-day dumps.

**Rationale**: A clean, reviewable history makes bugs bisectable,
changes revertible, and collaboration safe.

## Technology & Stack Constraints

> Urban Eclipse is a **web-only** project. The stack below is confirmed
> by the founding feature, the Telephoto Line-of-Sight Planner
> ("Plaster Void", `specs/001-telephoto-los-planner`), and is locked:
> do not deviate without a documented technical blocker. Mobile/native
> targets are out of scope.

- **Application framework**: Astro. Pages are server-rendered shells;
  interactive UI ships as Astro Islands hydrated client-side only.
- **UI components**: React, mounted via `client:only` so no component
  HTML is ever produced on the server.
- **3D / WebGL engine**: CesiumJS. All 3D components MUST be strictly
  isolated from server-side rendering (client-only island).
- **Ephemeris**: `suncalc` for Sun/Moon azimuth, altitude, and
  photographic-hour phases.
- **State management**: `nanostores` (with its React binding) as the
  cross-island state layer.
- **Styling**: Tailwind CSS.
- **Language**: TypeScript end-to-end.
- **Design language**: art-directed, non-realistic "plaster / clay
  model" aesthetic — monochrome white geometry in a hazy, grainy void,
  never a conventional satellite/GIS map look. Per-feature art direction
  (colors, shader intent) lives in the feature spec.
- **Dependencies**: New dependencies MUST be justified (purpose,
  maintenance status, license) and verified present in the manifest
  before use (Principle IV). Prefer the standard library and existing
  dependencies over new ones.

## Development Workflow & Quality Gates

The workflow operationalizes the Core Principles as enforceable gates.

- **Spec gate**: Work begins from a spec (`/speckit-specify`). No code
  without an accepted specification of the behavior.
- **Plan gate** (`/speckit-plan`): A Constitution Check MUST pass before
  Phase 0 research and be re-checked after Phase 1 design.
- **TDD gate**: For each user story, tests are written first and
  confirmed RED before implementation (Principle I). The tasks template
  encodes "Verify tests fail before implementing."
- **Build-Test-Verify gate**: Before any task, checkpoint, or merge is
  declared complete — build, run the full test suite, and verify
  against acceptance scenarios (Principle III). Output the evidence.
- **Research gate**: Any `NEEDS CLARIFICATION` must be resolved or
  explicitly deferred with owner + date before the dependent code is
  written (Principle IV).
- **Deploy gate**: A service is "done" only when it is deployed to
  Coolify via `/infra` with a passing health check (Principle V).
- **Stop-at-checkpoint**: At each user-story checkpoint, validate the
  story independently before proceeding to the next priority.

## Governance

This constitution supersedes all other ad-hoc practices for Urban
Eclipse. It is the single source of truth for project non-negotiables.

- **Supremacy**: Where any doc, decision, or habit conflicts with this
  constitution, the constitution wins until it is formally amended.
- **Amendment procedure**: Any principle change MUST be (1) proposed
  with rationale, (2) reviewed, (3) reflected here with a version bump,
  and (4) followed by a migration note for any in-flight work that the
  change affects.
- **Versioning policy** (semantic):
  - **MAJOR**: a principle is removed, replaced, or redefined in a
    backward-incompatible way.
  - **MINOR**: a new principle or materially expanded section is added.
  - **PATCH**: clarifications, wording, typo, or non-semantic refinements.
- **Compliance review**: Every plan, spec, and PR MUST verify
  conformance with the Core Principles. Violations MUST either be fixed
  or recorded in the plan's Complexity Tracking table with a justified
  rationale and a rejected-simpler-alternative note.
- **Complexity must be justified**: Any deviation from these principles
  requires explicit justification — never silent.
- **Runtime guidance**: Use the `/speckit-*` commands and `/infra` skill
  for the canonical workflows; this file is the contract they enforce.

**Open follow-ups** (tracked here until resolved):

- `RESOLVED 2026-07-20 (REPO_INIT)`: Repository initialized — root commit
  `abfa806` on `main`, `.gitignore` in place. Principle VI now applies.
- `RESOLVED 2026-07-20 (STACK_CONFIRM)`: Stack confirmed from the founding
  feature "Plaster Void" (`specs/001-telephoto-los-planner`); Technology
  & Stack Constraints scoped to web-only (v1.1.0).

**Version**: 1.1.0 | **Ratified**: 2026-07-20 | **Last Amended**: 2026-07-20
