# Product

## Register

product

## Users

Engineering and platform teams running Wally: admins and managers who trigger and monitor
automated agent runs (load testing, third-party tool integration discovery, API lifecycle
diffing), and viewers (stakeholders, other engineers) who watch runs and read reports. Used
at a desk, often screen-shared or recorded for a demo/review, watching a live job progress
in real time rather than skimming a static report after the fact.

## Product Purpose

Wally is a multi-agent automation platform. Each agent does one real job end to end:

- **Load Testing** — runs a real k6 load test against a target and reports p50/p95/p99,
  throughput, and SLO pass/fail.
- **Integration** — given any tool or API name, fetches its real public OpenAPI spec (if one
  exists), discovers its endpoints and response shapes, tests a live endpoint, and registers it.
- **API Lifecycle** — fetches an API's current spec, diffs it against the last time Wally
  checked it, and classifies changes as breaking or non-breaking.

Success looks like: a viewer can watch a run go from queued to completed with visible,
real-time progress, and the finished report reads as trustworthy — because the numbers and
endpoints shown are genuinely fetched/tested, never fabricated placeholders.

## Brand Personality

Precise, confident, effortless. The tone of a well-run engineering org: no bravado, no
decoration for its own sake, everything on screen earns its place. It should feel like the
kind of internal tool a serious infra team builds for itself, not a marketing site pretending
to be a product.

## Anti-references

Generic "AI-generated SaaS template" look: default dark-blue-and-purple gradients, hero-metric
cards with big numbers and no context, identical icon-in-a-box card grids, gradient text,
side-stripe accent borders, bouncy/elastic animation. Explicitly rejected by the user as
"bad and generic and AI generated."

## Design Principles

1. **Show real work happening, not a spinner.** Every agent step is visible progress (queued →
   running → done), because the whole point of these agents is that they do genuine, sometimes
   slow, verifiable work — the UI should never make that feel instant or fake.
2. **Honesty over decoration.** When an agent can't find something real (no public spec, no
   diff history yet), say so plainly instead of dressing up an empty/negative result.
3. **One confident accent, used with intent.** A single signature color for primary actions,
   active state, and pass/fail semantics — not a rainbow of "friendly" UI colors.
4. **Density with room to breathe.** This is a data-dense ops tool, but generous spacing and
   clear type hierarchy keep it from feeling like a cramped admin panel.
5. **Motion explains state changes, it doesn't perform.** Transitions communicate that
   something just happened (a step completed, a value updated) — no motion that exists purely
   for flourish.

## Accessibility & Inclusion

WCAG AA contrast minimum across both the dark theme's text/background pairs and all status
colors (pass/fail/warning must be distinguishable without relying on color alone — pair with
icon/label). Respect `prefers-reduced-motion` for all transitions and the logo animation.
