# Design

## Theme

Dark, engineered. The primary use case is a desk session — often screen-shared or recorded —
watching a real job execute. Deep tinted charcoal, not pure black, so it survives video
compression and doesn't crush shadow detail on a recording.

## Color Strategy

**Restrained.** Tinted neutrals carry the whole interface; one accent color is used with
intent (primary actions, the active nav item, the logo, and — doing double duty — the
semantic "pass" state) and never exceeds roughly 10% of any screen. Status semantics beyond
"pass" (fail, warning, running) get their own small, distinct hues so meaning never collapses
onto the brand color. No gradients, no color-as-decoration.

## Palette (OKLCH)

All neutrals tinted toward hue 250 (faint cool blue) at chroma 0.005–0.012 — never `#000`/`#fff`.

| Token | Value | Use |
|---|---|---|
| `--bg` | `oklch(16% 0.01 250)` | App background |
| `--surface` | `oklch(20% 0.012 250)` | Cards, panels, table rows |
| `--surface-raised` | `oklch(24% 0.013 250)` | Hover/active surface, popovers |
| `--border` | `oklch(30% 0.012 250 / 0.6)` | Hairline borders (1px, always full border not side-stripe) |
| `--text` | `oklch(92% 0.005 250)` | Primary text |
| `--text-muted` | `oklch(68% 0.01 250)` | Secondary text, labels, timestamps |
| `--text-faint` | `oklch(50% 0.01 250)` | Placeholder, disabled |
| `--accent` | `oklch(78% 0.15 70)` | Primary buttons, active nav, logo mark, focus ring |
| `--accent-strong` | `oklch(70% 0.16 70)` | Accent hover/pressed |
| `--accent-tint` | `oklch(78% 0.15 70 / 0.14)` | Accent background wash (active nav row, selected chip) |
| `--status-pass` | `--accent` (semantic reuse) | SLO pass, healthy, non-breaking |
| `--status-fail` | `oklch(65% 0.19 25)` | SLO fail, breaking change, error |
| `--status-warn` | `oklch(78% 0.14 85)` | Degraded, partial |
| `--status-running` | `oklch(72% 0.13 235)` | In-progress (cool blue, distinct from accent) |

Status colors are always paired with an icon + text label, never color alone (WCAG, and
colorblind-safe).

## Typography

Three deliberate families, each earning a role — not one font doing everything:

- **Headings — Space Grotesk.** Geometric, slightly technical, gives pages a distinct
  identity without shouting. Weight 600/500.
- **Body/UI — Inter.** Maximum legibility at small sizes for forms, nav, table text. Weight
  400/500.
- **Metrics & code — JetBrains Mono.** Every latency number, status code, endpoint path,
  timestamp, and diff line. Tabular figures so p50/p95/p99 columns actually align — this is
  the detail that makes the tool feel engineered rather than templated.

Scale (1.333 ratio, capped): 13 / 14 / 16 / 20 / 26 / 34px. Body line length capped ~70ch on
report/prose text (not tables).

## Layout

Left icon+label rail (not a hamburger, not a top nav bar with everything crammed in) —
persistent because users move between the three agents constantly. Content area: generous
outer padding (32-48px desktop), varied internal rhythm (not one uniform gap everywhere).
Cards reserved for genuinely bounded units — a single job, a single metric group, a single
discovered endpoint. Lists of jobs are real tables, not a stack of identical cards. No nested
cards, ever.

## Elevation

Dark surfaces separate by lightness step + a 1px hairline border, not heavy drop shadow.
One soft, low-opacity shadow (`0 8px 24px oklch(0% 0 0 / 0.35)`) reserved for genuinely
floating elements (popovers, the toast/notice on job completion) — not on every card.

## Motion

Ease-out-quart/quint only, no bounce/elastic. Durations: 120ms micro (hover/focus), 200ms
state change (step completes, tab switches), 400ms for the logo mark's one-time draw-in on
load. Respects `prefers-reduced-motion` — logo animation and page transitions collapse to an
instant/opacity-only fallback. Motion is reserved for communicating a state change (a step
just went from running → completed, a new SSE event arrived) — never decorative looping.

## Components

- **Buttons**: 8px radius, solid accent fill for primary, hairline-bordered ghost for
  secondary, text-only for tertiary. No pill shape.
- **Status pill**: icon + label, 6px radius, tinted background at 12% of the status color.
- **Cards**: 10px radius, `--surface` fill, 1px `--border`, no side-stripe accents.
- **Tables**: hairline row dividers, monospace for any numeric/id/path column, hover row
  raises to `--surface-raised`.
- **Inputs**: 8px radius, hairline border, accent-colored focus ring (2px, offset).
- **Logo**: a geometric "W" mark built from the same accent color, animates as a single
  stroke draw-in on first load (SVG `stroke-dashoffset`), then stays static — not a looping
  animation.
