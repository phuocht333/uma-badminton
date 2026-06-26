---
version: alpha
name: design-system
description: AI product UI/UX system. Tokens + components (glass-card, prompt-bar, command-palette, streaming indicator, gradient-orb hero) for any AI product surface. Engineer-minimal — off-white canvas, violet accent, Geist + Instrument Serif. Use when building, restyling, or reviewing AI UI. Triggers: design, style, UI, UX, Tailwind, color, typography, layout, component, theme, dark mode, spacing, glass, glow.

colors:
  ink: "#0A0A0A"
  ink-soft: "#171717"
  ink-deeper: "#050505"
  body: "#404040"
  body-strong: "#262626"
  muted: "#737373"
  muted-soft: "#A3A3A3"
  hairline: "#E5E5E5"
  hairline-soft: "#F2F2F2"
  hairline-strong: "#D4D4D4"
  canvas: "#FAFAF9"
  canvas-soft: "#FFFFFF"
  canvas-deep: "#0A0A0A"
  canvas-deeper: "#050505"
  surface-card: "#FFFFFF"
  surface-strong: "#F5F5F4"
  surface-glass: "rgba(255, 255, 255, 0.55)"
  surface-glass-dark: "rgba(23, 23, 23, 0.55)"
  surface-dark: "#0A0A0A"
  surface-dark-elevated: "#171717"
  surface-dark-soft: "#1F1F1F"
  on-ink: "#FAFAFA"
  on-dark: "#FAFAFA"
  on-dark-soft: "#A3A3A3"
  on-dark-muted: "#737373"
  accent: "#7C3AED"
  accent-soft: "#A78BFA"
  accent-deep: "#5B21B6"
  accent-on: "#FFFFFF"
  accent-tint: "#F5F3FF"
  accent-tint-dark: "rgba(124, 58, 237, 0.12)"
  accent-glow: "rgba(124, 58, 237, 0.35)"
  signal-cyan: "#06B6D4"
  signal-warm: "#F97316"
  semantic-error: "#DC2626"
  semantic-success: "#10B981"
  semantic-warn: "#F59E0B"
  semantic-info: "#3B82F6"
  gradient-mesh-a: "#7C3AED"
  gradient-mesh-b: "#06B6D4"
  gradient-mesh-c: "#F97316"
  score-strong: "#10B981"
  score-mid: "#F59E0B"
  score-weak: "#DC2626"

typography:
  display-mega: { fontFamily: "'Geist', system-ui, sans-serif", fontSize: 80px, fontWeight: 600, lineHeight: 0.98, letterSpacing: -2.4px }
  display-xl:   { fontFamily: "'Geist', system-ui, sans-serif", fontSize: 56px, fontWeight: 600, lineHeight: 1.05, letterSpacing: -1.68px }
  display-lg:   { fontFamily: "'Geist', system-ui, sans-serif", fontSize: 40px, fontWeight: 600, lineHeight: 1.1,  letterSpacing: -1.2px }
  display-md:   { fontFamily: "'Geist', system-ui, sans-serif", fontSize: 32px, fontWeight: 600, lineHeight: 1.15, letterSpacing: -0.96px }
  display-sm:   { fontFamily: "'Geist', system-ui, sans-serif", fontSize: 24px, fontWeight: 600, lineHeight: 1.25, letterSpacing: -0.48px }
  serif-italic: { fontFamily: "'Instrument Serif', 'Times New Roman', serif", fontWeight: 400, fontStyle: italic, letterSpacing: 0 }
  title-md:     { fontFamily: "'Geist', system-ui, sans-serif", fontSize: 18px, fontWeight: 500, lineHeight: 1.4 }
  title-sm:     { fontFamily: "'Geist', system-ui, sans-serif", fontSize: 16px, fontWeight: 500, lineHeight: 1.5 }
  body-md:      { fontFamily: "'Geist', system-ui, sans-serif", fontSize: 16px, fontWeight: 400, lineHeight: 1.6 }
  body-sm:      { fontFamily: "'Geist', system-ui, sans-serif", fontSize: 14px, fontWeight: 400, lineHeight: 1.55 }
  caption:      { fontFamily: "'Geist', system-ui, sans-serif", fontSize: 13px, fontWeight: 400, lineHeight: 1.5 }
  caption-mono: { fontFamily: "'Geist Mono', ui-monospace, monospace", fontSize: 13px, fontWeight: 400, lineHeight: 1.5 }
  label-mono:   { fontFamily: "'Geist Mono', ui-monospace, monospace", fontSize: 11px, fontWeight: 500, lineHeight: 1.0, letterSpacing: 0.6px, textTransform: uppercase }
  kbd-mono:     { fontFamily: "'Geist Mono', ui-monospace, monospace", fontSize: 12px, fontWeight: 500, lineHeight: 1.0, letterSpacing: 0.4px }
  button:       { fontFamily: "'Geist', system-ui, sans-serif", fontSize: 14px, fontWeight: 500, lineHeight: 1.0 }
  code:         { fontFamily: "'Geist Mono', ui-monospace, monospace", fontSize: 14px, fontWeight: 400, lineHeight: 1.6 }

rounded: { none: 0px, xs: 4px, sm: 6px, md: 8px, lg: 12px, xl: 16px, xxl: 24px, pill: 9999px, full: 9999px }
spacing: { xxs: 4px, xs: 8px, sm: 12px, base: 16px, md: 20px, lg: 24px, xl: 32px, xxl: 48px, xxxl: 64px, section: 96px, hero: 128px }

motion:
  duration-fast: 120ms
  duration-base: 200ms
  duration-slow: 320ms
  duration-stream: 800ms
  ease-out:        "cubic-bezier(0.22, 1, 0.36, 1)"
  ease-in-out:     "cubic-bezier(0.65, 0, 0.35, 1)"
  ease-emphasized: "cubic-bezier(0.16, 1, 0.3, 1)"

elevation:
  flat:        "none"
  hairline:    "0 0 0 1px {colors.hairline}"
  drop-soft:   "0 4px 16px rgba(10, 10, 10, 0.04)"
  drop-card:   "0 8px 24px rgba(10, 10, 10, 0.06)"
  drop-modal:  "0 24px 48px rgba(10, 10, 10, 0.18)"
  glow-accent: "0 0 0 4px {colors.accent-glow}"
  glow-soft:   "0 0 32px {colors.accent-glow}"
  inset-edge:  "inset 0 1px 0 rgba(255, 255, 255, 0.06)"

blur:
  glass: "blur(16px) saturate(160%)"
  hero:  "blur(80px)"

components:
  top-nav:           { backgroundColor: "{colors.surface-glass}", backdropFilter: "{blur.glass}", textColor: "{colors.ink}", typography: "{typography.title-sm}", height: 64px, borderBottom: "1px solid {colors.hairline}" }
  command-palette:   { backgroundColor: "{colors.surface-glass}", backdropFilter: "{blur.glass}", textColor: "{colors.ink}", typography: "{typography.body-md}", rounded: "{rounded.xl}", border: "1px solid {colors.hairline}", boxShadow: "{elevation.drop-modal}", width: 640px, triggerHint: "⌘K" }
  button-primary:    { backgroundColor: "{colors.ink}", textColor: "{colors.on-ink}", typography: "{typography.button}", rounded: "{rounded.md}", padding: "10px 16px", height: 40px }
  button-accent:     { backgroundColor: "{colors.accent}", textColor: "{colors.accent-on}", typography: "{typography.button}", rounded: "{rounded.md}", padding: "10px 16px", height: 40px, hoverBoxShadow: "{elevation.glow-soft}" }
  button-ghost:      { backgroundColor: transparent, textColor: "{colors.ink}", typography: "{typography.button}", rounded: "{rounded.md}", padding: "9px 15px", height: 40px, border: "1px solid {colors.hairline-strong}" }
  button-icon:       { backgroundColor: transparent, textColor: "{colors.body}", rounded: "{rounded.full}", size: 36px }
  link-inline:       { textColor: "{colors.ink}", underline: "{colors.muted-soft}", hoverUnderline: "{colors.accent}" }
  hero-band:         { backgroundColor: "{colors.canvas}", textColor: "{colors.ink}", typography: "{typography.display-mega}", padding: "{spacing.hero} 0", ambientBackground: "gradient-orb" }
  gradient-orb:
    layers:
      - "radial-gradient(40% 60% at 20% 0%, {colors.gradient-mesh-a} 0%, transparent 60%)"
      - "radial-gradient(35% 50% at 80% 10%, {colors.gradient-mesh-b} 0%, transparent 60%)"
      - "radial-gradient(45% 60% at 60% 100%, {colors.gradient-mesh-c} 0%, transparent 60%)"
    filter: "{blur.hero}"
    opacity: 0.35
    opacityDark: 0.55
  section-band:      { backgroundColor: "{colors.canvas}", padding: "{spacing.section} 0" }
  section-band-soft: { backgroundColor: "{colors.surface-strong}", padding: "{spacing.section} 0" }
  card:              { backgroundColor: "{colors.surface-card}", textColor: "{colors.ink}", rounded: "{rounded.lg}", padding: "{spacing.lg}", border: "1px solid {colors.hairline}" }
  card-hover:        { boxShadow: "{elevation.drop-soft}", transform: "translateY(-2px)", borderColor: "{colors.hairline-strong}" }
  glass-card:        { backgroundColor: "{colors.surface-glass}", backdropFilter: "{blur.glass}", textColor: "{colors.ink}", rounded: "{rounded.xl}", padding: "{spacing.lg}", border: "1px solid {colors.hairline}", boxShadow: "{elevation.inset-edge}" }
  feature-card:      { backgroundColor: "{colors.surface-card}", rounded: "{rounded.lg}", aspectRatio: "4/3", border: "1px solid {colors.hairline}" }
  pill:              { backgroundColor: "{colors.surface-strong}", textColor: "{colors.body-strong}", typography: "{typography.caption-mono}", rounded: "{rounded.pill}", padding: "4px 10px" }
  badge-mono:        { backgroundColor: transparent, textColor: "{colors.muted}", typography: "{typography.label-mono}", border: "1px solid {colors.hairline}", rounded: "{rounded.pill}", padding: "3px 8px" }
  badge-accent:      { backgroundColor: "{colors.accent-tint}", textColor: "{colors.accent-deep}", typography: "{typography.label-mono}", rounded: "{rounded.pill}", padding: "3px 10px" }
  citation-chip:     { backgroundColor: "{colors.surface-strong}", textColor: "{colors.body-strong}", typography: "{typography.kbd-mono}", rounded: "{rounded.sm}", padding: "2px 6px", border: "1px solid {colors.hairline}", interactive: true }
  kbd:               { backgroundColor: "{colors.surface-card}", textColor: "{colors.body-strong}", typography: "{typography.kbd-mono}", border: "1px solid {colors.hairline-strong}", borderBottomWidth: 2px, rounded: "{rounded.xs}", padding: "2px 6px" }
  timeline-item:     { typography: "{typography.body-md}", yearTypography: "{typography.label-mono}", rule: "1px solid {colors.hairline}", nodeSize: 8px, nodeColor: "{colors.accent}", nodeGlow: "{elevation.glow-soft}" }
  input-text:        { backgroundColor: "{colors.surface-card}", textColor: "{colors.ink}", typography: "{typography.body-md}", rounded: "{rounded.md}", padding: "10px 14px", height: 44px, border: "1px solid {colors.hairline-strong}", borderFocus: "1px solid {colors.accent}", glowFocus: "{elevation.glow-accent}" }
  textarea-prose:    { backgroundColor: "{colors.surface-card}", typography: "{typography.code}", rounded: "{rounded.md}", padding: "16px", minHeight: 240px, border: "1px solid {colors.hairline-strong}", borderFocus: "1px solid {colors.accent}" }
  prompt-bar:        { backgroundColor: "{colors.surface-glass}", backdropFilter: "{blur.glass}", rounded: "{rounded.xl}", padding: "12px 16px", border: "1px solid {colors.hairline}", boxShadow: "{elevation.drop-card}", sticky: bottom }
  streaming-indicator: { cursorColor: "{colors.accent}", cursorBlink: 720ms, shimmerGradient: "linear-gradient(90deg, transparent, {colors.accent-glow}, transparent)", shimmerDuration: 1400ms }
  kpi-tile:          { backgroundColor: "{colors.surface-card}", rounded: "{rounded.lg}", padding: "{spacing.lg}", border: "1px solid {colors.hairline}", valueTypography: "{typography.display-md}", labelTypography: "{typography.label-mono}", deltaTypography: "{typography.caption-mono}" }
  result-card:       { backgroundColor: "{colors.surface-card}", rounded: "{rounded.lg}", padding: "{spacing.lg}", border: "1px solid {colors.hairline}" }
  tab-bar:           { typography: "{typography.title-sm}", activeUnderline: "2px solid {colors.ink}", activeColor: "{colors.ink}", inactiveColor: "{colors.muted}" }
  modal:             { backgroundColor: "{colors.surface-glass}", backdropFilter: "{blur.glass}", rounded: "{rounded.xl}", padding: "{spacing.xl}", boxShadow: "{elevation.drop-modal}", border: "1px solid {colors.hairline}" }
  toast:             { backgroundColor: "{colors.ink}", textColor: "{colors.on-ink}", typography: "{typography.body-sm}", rounded: "{rounded.md}", padding: "10px 14px", boxShadow: "{elevation.drop-card}" }
  footer:            { backgroundColor: "{colors.canvas}", textColor: "{colors.body}", typography: "{typography.body-sm}", padding: "64px 48px", borderTop: "1px solid {colors.hairline}" }
---

# AI Product UI/UX System

Frontmatter = canonical tokens. Body = how to apply.

## Role

Act as expert UI/UX engineer. Creative *within* the system, never outside. Best practices first. Careful, correct, consistent.

Process when invoked:
1. **Read tokens before writing CSS.** No raw hex, px, ms outside `tailwind.config` — pick from frontmatter.
2. **Reach for existing component first.** If none fits, compose from primitives (card + glass + pill + …). Never one-off.
3. **Apply rules in "Rules", "A11y", "Perf budget".** No exception without stated reason.
4. **Self-review against "Done check"** before declaring done. Walk the list.
5. **Creative latitude lives in layout, motion, composition** — never in raw color, type size, spacing values. Novelty = how primitives combine, not new primitives.

Defaults when ambiguous:
- Light mode + violet accent + Geist stack.
- Card `lg`, button `md`, glass `xl`.
- Hairline border > shadow.
- 1 primary CTA per band.
- Mobile-first 360.

Stop + ask only if:
- Brand voice unspecified AND need accent swap (violet/cyan/orange).
- Surface type unclear (landing vs dashboard vs agent UI) AND component choice differs.
- Token gap real (need value not in frontmatter — propose addition, don't improvise).

Otherwise: ship.

## Code principles

Every component written here = production-grade. Non-negotiable.

- **SOLID** — Single responsibility (component does one thing). Open/closed (props extend, internals don't change). Liskov (any conforming child swaps in). Interface segregation (no fat prop bags — split into typed unions). Dependency inversion (accept handlers/data via props, don't reach for globals).
- **DRY** — 2nd repeat → extract. 3rd → name + document. Shared logic in `lib/` or hooks. Never copy-paste styles between components — compose primitives.
- **YAGNI** — no speculative props/variants/slots. No `size: 'xs' | 'sm' | 'md' | 'lg' | 'xl'` if only `md` + `lg` ship. Add the day you need it.
- **Modular** — one component per file. Named exports (no default). Co-locate `Component.tsx` + `Component.test.tsx` + `Component.stories.tsx` + `types.ts`. Barrel `index.ts` per folder.
- **Reusable** — props over hardcoded strings. Tokens over magic numbers. Composition over inheritance. `children` + `asChild` over rigid layout slots. Polymorphic `as` prop where shape allows.
- **Maintainable** — fns <40 lines. Files <300 lines. Cyclomatic complexity <10. No nested ternaries >2 deep. Pure render fns — side effects in `useEffect`/handlers only.
- **Human-readable** — names: variables = nouns (`activeTab`), fns = verbs (`handleSubmit`, `formatVnd`), booleans = `is`/`has`/`should` (`isStreaming`). No abbreviations except `id`/`idx`/`el`/`ref`/`fn`. Comments explain *why*, never *what* — code says *what*.
- **Type-safe** — `strict: true`. No `any`. Discriminated unions for variants. `as const` for token tables. Infer over annotate where ergonomic.
- **Testable** — pure props in, JSX out. No internal Date.now()/random — inject. Each component renders in isolation w/o providers (or wrap once at root).
- **Secure** — never `dangerouslySetInnerHTML` without DOMPurify. Escape all user content. Auth tokens in httpOnly cookies, never `localStorage`. No secrets in client bundle (env prefix `NEXT_PUBLIC_*` audited). External links: `rel="noopener noreferrer"` on `target="_blank"`. CSP headers strict (`default-src 'self'`, no `unsafe-inline` — use nonce). Validate file uploads (type + size + dims). Form input: validate client *and* server. Lockfile committed, deps audited (`pnpm audit` clean). Image src allowlist via `next.config.js`. No eval, no `new Function`. `iframe` → `sandbox` attr.

## Consistency contract

Every screen passes this scan before done. Inconsistency = bug.

- **One accent per surface.** No mixing violet + cyan. One palette, cascaded.
- **One radii tier per row.** Don't mix `md` button + `xl` button side-by-side.
- **One elevation tier per role.** All cards = hairline default OR all = drop-soft on hover. Never half-and-half.
- **One type rhythm.** h2 = `display-lg` everywhere on a page. h3 = `display-md`. Lock it.
- **One spacing pulse.** Sections all `section` 96 (or all 64 on tablet). Never 96 → 80 → 96 in same flow.
- **One glass policy.** AI regions only. No glass on body cards "for variety".
- **One focus ring.** Same accent + offset across every interactive el.
- **One motion vocabulary.** Hover 200ms, reveal 320ms, stream 720/1400ms — same across components.
- **Naming parity.** If `score-strong` is green elsewhere, it's green here. No local overrides.

Before shipping: scan once for these eight. Fix before claiming done.

## Aesthetic

Engineer-minimal + AI ambient warmth.

- Off-white #FAFAF9 + ink #0A0A0A. Off-white reads "considered" not clinical.
- Single violet #7C3AED. AI-only: focus ring, streaming cursor, primary CTA, timeline node. Never decoration.
- Glass = AI-active regions (palette, prompt-bar, sticky nav). Solid = static content.
- Geist = display + body. Geist Mono = engineer voice (paths, indices, kbd). Instrument Serif italic = ≤1 word/page.
- Hairlines (1px #E5E5E5) carry structure. Drop shadow = hover/modal only. Glow = focus + primary AI CTA hover only.

Light + dark parity. 3 accent palettes. `prefers-reduced-motion` + `prefers-reduced-transparency` + `forced-colors` first-class.

## Colors

### Surface
| Token | Hex | Use |
|---|---|---|
| `canvas` | #FAFAF9 | Page floor |
| `canvas-soft` | #FFFFFF | Card-on-canvas |
| `canvas-deep` | #0A0A0A | Dark page floor |
| `surface-card` | #FFFFFF | Card body |
| `surface-strong` | #F5F5F4 | Alt band, pill bg, kbd bg |
| `surface-glass` | rgba(255,255,255,0.55) | AI region |
| `surface-glass-dark` | rgba(23,23,23,0.55) | Dark glass |
| `surface-dark-elevated` | #171717 | Card on dark canvas |

### Text + line
| Token | Hex | Use |
|---|---|---|
| `ink` | #0A0A0A | Primary text, primary-button bg |
| `body` | #404040 | Running prose |
| `body-strong` | #262626 | Body emphasis |
| `muted` | #737373 | Caption, date, inactive tab |
| `hairline` | #E5E5E5 | 1px divider, default border |
| `hairline-strong` | #D4D4D4 | Input border, hover-emphasis |
| `on-ink` | #FAFAFA | Text on ink button |
| `on-dark` | #FAFAFA | Dark-mode primary text |

### Accent (single)
| Token | Hex | Use |
|---|---|---|
| `accent` | #7C3AED | CTA, focus ring, streaming cursor, timeline node |
| `accent-soft` | #A78BFA | Accent CTA hover |
| `accent-deep` | #5B21B6 | Mono eyebrow on light bg, text on tint |
| `accent-tint` | #F5F3FF | Active row fill, success-toast inline |
| `accent-glow` | rgba(124,58,237,0.35) | Focus ring shadow, hover halo, hero ambient |

**Hard rule:** ≤3 accent moments per page. Count.

### Signal / Score / Semantic
- `signal-cyan` #06B6D4 — secondary AI signal: streaming highlight, citation hover.
- `signal-warm` #F97316 — gradient-mesh tertiary. Never raw text color.
- Score: `strong` #10B981 / `mid` #F59E0B / `weak` #DC2626. Gauge / severity / verdict only.
- Semantic: `error` #DC2626 / `success` #10B981 / `warn` #F59E0B / `info` #3B82F6.

### Accent swaps
3 palettes. One per surface, never two.
- Violet #7C3AED — default, agentic.
- Cyan #06B6D4 — dev tool.
- Orange #F97316 — editorial.

Swap = change `accent.DEFAULT` + `accent.glow` together. Cascade.

## Typography

Stack: Geist (display+body), Geist Mono (engineer), Instrument Serif (editorial italic, 1 word/page).

| Token | Size | Weight | Use |
|---|---|---|---|
| `display-mega` | 80 | 600 | Hero h1 — once/page |
| `display-xl` | 56 | 600 | Subsidiary hero |
| `display-lg` | 40 | 600 | Section h2 |
| `display-md` | 32 | 600 | Sub-section h3, KPI value |
| `display-sm` | 24 | 600 | Card-group title |
| `title-md` | 18 | 500 | Component title |
| `title-sm` | 16 | 500 | Form/list label |
| `body-md` | 16 | 400 | Default running |
| `body-sm` | 14 | 400 | Footer, secondary |
| `caption` | 13 | 400 | Photo caption |
| `caption-mono` | 13 | 400 | Tech tag, file path, citation |
| `label-mono` | 11 | 500 caps | Eyebrow, year, KPI label, `[01]` index |
| `kbd-mono` | 12 | 500 | `⌘K`, citation `[3]`, hotkey |
| `button` | 14 | 500 | All CTAs |
| `code` | 14 | 400 | Inline code, prose textarea |

Rules:
- Display weight max 600. Geist 600 plenty.
- Display = neg letter-spacing (-0.48 → -2.4px). Tighter at larger.
- Body line-height locked 1.6.
- Mono label = ALL CAPS + 0.6px tracking. Engineer voice only — index, year, path, kbd, breadcrumb, KPI label.
- Italic serif = 1 word/page. Never heading alone, never paragraph.
- Self-host via `next/font` (Geist + Geist Mono + Instrument Serif). `font-display: swap`. Preload 400/500/600 woff2. → no FOIT, low CLS.

## Layout

4px base. `xxs` 4 / `xs` 8 / `sm` 12 / `base` 16 / `md` 20 / `lg` 24 / `xl` 32 / `xxl` 48 / `xxxl` 64 / `section` 96 / `hero` 128.

Grid:
- Max width 1200px (`max-w-6xl`). Center.
- Gutter 24px desktop / 16px mobile.
- Card grid: 3-up desktop / 2-up tablet / 1-up mobile.
- Section pad: 96 desktop / 64 tablet / 48 mobile. Hero: 128 desktop.

Whitespace bigger than feels right + 8px more. Hairlines do structure. Glass floats — extra breathing room.

Mobile first 360. Test 360 / 768 / 1024 / 1440. Mobile: hero `display-mega` → `display-lg`. Section pad → 48. Grid → 1-up. Glass → solid if requested.

Use `min-h-svh`/`dvh` (small/dynamic viewport units) on hero + sticky bottom → no Safari chrome jump. Container queries for cards in flex slots → respond to container, not viewport.

## Elevation

Three tiers: hairline → drop → glow. Map to *role*.

| Token | Treatment | Use |
|---|---|---|
| `flat` | none | Body band on canvas |
| `hairline` | 1px `hairline` | Card border, divider — default |
| `drop-soft` | 0 4px 16px rgba(10,10,10,.04) | Card hover |
| `drop-card` | 0 8px 24px rgba(10,10,10,.06) | Sticky toast, elevated prompt-bar |
| `drop-modal` | 0 24px 48px rgba(10,10,10,.18) | Modal, palette, dropdown |
| `glow-accent` | 0 0 0 4px accent-glow | Focus ring |
| `glow-soft` | 0 0 32px accent-glow | Primary-CTA hover halo, timeline node, hero |
| `inset-edge` | inset 0 1px 0 rgba(255,255,255,.06) | Glass cut-edge |

No big shadow on cards default. Glow lives where AI lives.

### Glass

Glass = translucent + 16px blur + 160% saturation + 1px hairline + inset highlight.

```css
background: var(--surface-glass);            /* rgba(255,255,255,0.55) */
backdrop-filter: blur(16px) saturate(160%);
-webkit-backdrop-filter: blur(16px) saturate(160%);
border: 1px solid var(--hairline);
box-shadow: inset 0 1px 0 rgba(255,255,255,0.06);

@media (prefers-reduced-transparency: reduce) {
  background: var(--surface-card);
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
}
@media (forced-colors: active) {
  background: Canvas;
  border-color: CanvasText;
  backdrop-filter: none;
}
```

Use: prompt-bar, palette, sticky nav, modal, dropdown. Never: body cards, hero h1 bg, footer, primary buttons.

Perf budget: `backdrop-filter` is GPU-heavy. Cap ~3 active glass surfaces in viewport. Never animate the filter value → repaints. `will-change: backdrop-filter` only while interactive, drop after.

Always `-webkit-` + standard prefix. Solid fallback under `prefers-reduced-transparency`.

## Shapes

| Token | px | Use |
|---|---|---|
| `xs` | 4 | Inline tag, kbd |
| `sm` | 6 | Compact row, citation chip |
| `md` | 8 | Form input, button |
| `lg` | 12 | Card, dialog block |
| `xl` | 16 | Modal, palette, large card, glass-card, prompt-bar |
| `xxl` | 24 | Hero panel, KPI cluster |
| `pill` | 9999 | Pill badge, skill chip |
| `full` | 9999 | Avatar, icon button |

Default card `lg`. Default button `md`. Glass `xl`. Pill = chip/badge only, never button. Don't mix radii in one row.

## Motion

- Hover/focus 200ms `ease-out`.
- Section reveal 320ms `ease-emphasized`, 8px translate, fires once on enter (`IntersectionObserver`, `threshold: 0.15`).
- Page transition 200ms opacity fade. No slide.
- Streaming: cursor blink 720ms, shimmer 1400ms.
- Glow halo: 320ms in / 200ms out.
- Reveal cascade: 60ms stagger.
- Animate only `transform` + `opacity`. Never `width/height/top/left` → layout thrash.
- `prefers-reduced-motion: reduce` → kill transforms + shimmer. Keep cursor blink (signals active stream — a11y need).

## Components

### Top Nav (64px sticky)
Glass after 8px scroll (always-glass on admin). Left: brand + role tag (`label-mono`). Right: anchors, `⌘K` kbd, dark toggle. First child = skip-link (`a[href="#main"]`, off-screen until focus).

### Command Palette (`⌘K`)
Glass card, 640px, centered modal. Mono input top, results below: icon + label + right-aligned `kbd-mono`. Highlight = `accent-tint` bg, no border change. Empty = single muted caption. `role="dialog" aria-modal="true"`. Trap focus on open. ESC closes. Arrow keys navigate via `aria-activedescendant`. Restore focus to trigger on close.

### Hero Band
128/96 padding. `gradient-orb` ambient at 0.35 light / 0.55 dark behind h1. H1 = `display-mega`; ≤1 word italic-serif. Sub = `body-md`, max 60ch. ≤2 CTAs: `button-accent` (primary, glow halo on hover) + `button-ghost`. Optional `label-mono` eyebrow. SSR h1 + sub → fast LCP. Reserve hero height → no CLS.

### Section Header
`label-mono` eyebrow `accent-deep` (e.g. `[02] · WORK`). `display-lg` h2, 8px gap. Optional `body-md` muted sub.

### Glass Card
`surface-glass` + 16px blur + hairline + inset top edge. AI-output containers, agent panels, settings groups, model pickers.

### Feature / Project Card
4:3 image top, body pad bottom. `title-md`, `pill` row, `body-sm` desc. Hover: lift 2px + `drop-soft` + border `hairline-strong`. Click → modal/external. Image: `loading="lazy"`, `decoding="async"`, explicit `width`/`height` (or CSS aspect-ratio) → no CLS.

### Pill / Skill Chip
`surface-strong` bg, `caption-mono`, pill radius, 4×10. Wraps free.

### Citation Chip `[3]`
Inline `kbd-mono` on `surface-strong`, `rounded.sm`. Hover: accent border + tooltip with source. Click: scroll-to-ref or external. Use `<a>` not `<span>` — keyboard focusable for free.

### Timeline
Vertical 1px hairline rail. 8px circular accent node + `glow-soft`. Year = `label-mono` muted. Role = `title-md`. Sub = `caption-mono` accent. Desc = `body-md`, 60ch. Mark up as `<ol>` — order matters semantically.

### KPI Tile
`surface-card`, `rounded.lg`, `lg` pad, hairline. Top: `label-mono` muted. Mid: `display-md` ink (number). Bottom: `caption-mono` delta + arrow, color `score-strong`/`score-weak`. Pair color w/ ↑↓ glyph — color never sole signal.

### AI Prompt Bar
Sticky-bottom on agent/studio/chat. Glass `rounded.xl`. Textarea + send (`button-accent` arrow / `button-icon`). Suggestion chips above use `pill`: short verbs ("Summarize", "Draft", "Refactor", "Explain", "Translate"). Streaming response in floating panel above bar. `position: sticky; bottom: env(safe-area-inset-bottom)` + `dvh` → mobile keyboard safe. Textarea auto-grow, max 8 lines.

### Streaming Indicator
Cursor: 2px × 1em, accent, blink 720ms. Skeleton: `accent-glow → transparent` sweep, 1400ms. Stop both on done → replace with content. Wrap region in `role="status" aria-live="polite" aria-busy="true"`. Flip `aria-busy` false on done.

### Result Card (AI output)
Optional KPI/score gauge left (240×240 SVG ring, color from score band). Right: verdict badge (`badge-accent` positive / amber mid / red weak), key bullets, evidence quotes (italic `body-sm`), `button-ghost` action row (Copy, Share). Verdict carries a word — color never sole signal.

### Tab Bar
Horizontal. Active = 2px ink underline. Inactive = muted. Mobile scrolls horizontal — no collapse. `role="tablist"`, each tab `role="tab" aria-selected`. Arrow keys move, Home/End jump, Enter activates.

### Form Inputs
Min 44px height, 14px h-pad. Focus: 1px accent border + 4px `accent-glow` ring offset. Error: 1px `semantic-error` border + caption error below. `<label>` always visible — never placeholder-as-label. `aria-invalid="true"` + `aria-describedby` → error msg id. Inline validation on blur, not keystroke.

### Footer
3 col desktop (Where / Social / Contact), 1 col mobile. Hairline-top. `body-sm` muted.

## Rules

Do:
- One bold thing per page: hero italic-serif word OR gradient orb OR streaming hero. Pick one.
- Whitespace bigger than feels right + 8px.
- Accent ≤3/page. Count.
- Mono = engineer voice only. Index, year, path, tag, citation, kbd.
- Hairline > shadow. Drop only on hover/modal. Glow only on focus + primary AI CTA hover.
- Body line-height 1.6 always.
- Glass where AI lives. Not everywhere.
- 1 primary CTA/band. Ink-pill OR accent-pill, not both.
- Light + dark parity. Glass auto-swaps.
- Mobile first 360 → 1440.
- Honor `prefers-reduced-motion` + `prefers-reduced-transparency` + `forced-colors`.

Don't:
- Rainbow palette. One accent.
- Italic-serif sentence. 1 word.
- Accent on body text. Body = ink/body.
- Mono paragraphs.
- Section pad <64px desktop.
- Multiple primary CTAs/band.
- Font-weight ≥700.
- Hover-only affordance on touch.
- Mixed radii in one row.
- 2px+ borders.
- Glass on glass.
- Glow halo on every button.
- Streaming animation past completion.
- Gradient orb in card backgrounds. Hero only.
- `backdrop-filter` without `-webkit-` prefix.

## A11y

- Body contrast ≥7:1 (ink on canvas = 19.5:1).
- Accent on canvas = 6.6:1 (passes large/UI text). White on accent = 5.8:1 (AA Large).
- Focus ring visible on every interactive el. 2px accent outline + 2px offset OR `glow-accent` shadow ring. Never bare `outline: none`.
- Tap target ≥44×44px.
- Heading order strict: 1 h1, h2 per section, no skip levels.
- Color never sole signal: gauges = number + verdict word, streaming = `role="status"` + visible cursor, deltas = ↑↓ glyph + color.
- Honor `prefers-reduced-motion`, `prefers-reduced-transparency`, `forced-colors` (Windows high contrast — use `system-ui` colors: `Canvas`, `CanvasText`, `Highlight`).
- Glass passes contrast on median underlying bg. Test against canvas + canvas-deep.
- Modals: focus trap, ESC close, return focus to trigger on close, `aria-modal="true"`.
- Live regions: stream `aria-live="polite"`, errors `aria-live="assertive"`, toasts `aria-live="polite"` w/ `role="status"`.
- `<html lang>` matches content (`vi` for Vietnamese surfaces).
- All icons w/ semantic meaning get `aria-label`. Decorative icons `aria-hidden="true"`.
- Error msgs use semantic `role="alert"` only when interruptive. Inline form errors prefer `aria-describedby`.

## Perf budget

- LCP <2.5s — SSR hero, preload Geist-Bold woff2, no client-side font swap.
- CLS <0.1 — explicit dims on images, reserve hero height, no late-injected banners.
- INP <200ms — debounce streaming UI updates 16ms (rAF), virtualize long result lists.
- TBT <200ms — defer non-critical JS, code-split palette + modal.
- Backdrop-filter: ≤3 in viewport, never animated.
- Total CSS <50kb gzipped, total fonts <200kb (3 families × 2 weights subset).

## Done check

- [ ] Lighthouse perf ≥95 desktop, ≥90 mobile
- [ ] Lighthouse a11y = 100
- [ ] CLS <0.1, LCP <2.5s, INP <200ms
- [ ] Light + dark tested
- [ ] Breakpoints 360 / 768 / 1024 / 1440 tested
- [ ] Focus ring on every interactive el; tab order logical
- [ ] `prefers-reduced-motion` path tested (no shimmer/transforms)
- [ ] `prefers-reduced-transparency` path tested (glass → solid)
- [ ] `forced-colors` path tested (Windows high contrast)
- [ ] Keyboard-only walkthrough passes (palette, modal, tabs, forms)
- [ ] Screen reader walkthrough passes (VoiceOver mac / NVDA win)
- [ ] No raw hex outside `tailwind.config` (`grep '#[0-9A-Fa-f]\{6\}' src/components` empty)
- [ ] No font-weight >600 on display
- [ ] Italic serif ≤1/page
- [ ] Accent ≤3 violet moments/page (manual scan)
- [ ] Glass ≤1 per visual stack
- [ ] Streaming stops on done; `aria-busy` flips
- [ ] Citation chips keyboard focusable + tooltip
- [ ] Images `loading="lazy"` + explicit dims
- [ ] Fonts `font-display: swap` + preload
- [ ] `<html lang>` matches content language

## Tailwind snippet

```ts
// tailwind.config.ts excerpt — feed token frontmatter into theme.extend
import type { Config } from 'tailwindcss';

export default {
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        ink: { DEFAULT: '#0A0A0A', soft: '#171717', deeper: '#050505' },
        body: { DEFAULT: '#404040', strong: '#262626' },
        muted: { DEFAULT: '#737373', soft: '#A3A3A3' },
        hairline: { DEFAULT: '#E5E5E5', soft: '#F2F2F2', strong: '#D4D4D4' },
        canvas: { DEFAULT: '#FAFAF9', soft: '#FFFFFF', deep: '#0A0A0A', deeper: '#050505' },
        'surface-card': '#FFFFFF',
        'surface-strong': '#F5F5F4',
        'surface-glass': 'rgba(255,255,255,0.55)',
        'surface-glass-dark': 'rgba(23,23,23,0.55)',
        'surface-dark': { DEFAULT: '#0A0A0A', elevated: '#171717', soft: '#1F1F1F' },
        'on-ink': '#FAFAFA',
        'on-dark': { DEFAULT: '#FAFAFA', soft: '#A3A3A3', muted: '#737373' },
        accent: {
          DEFAULT: '#7C3AED', soft: '#A78BFA', deep: '#5B21B6',
          on: '#FFFFFF', tint: '#F5F3FF', glow: 'rgba(124,58,237,0.35)',
        },
        signal: { cyan: '#06B6D4', warm: '#F97316' },
        semantic: { error: '#DC2626', success: '#10B981', warn: '#F59E0B', info: '#3B82F6' },
        score: { strong: '#10B981', mid: '#F59E0B', weak: '#DC2626' },
      },
      fontFamily: {
        sans: ['Geist', 'system-ui', 'sans-serif'],
        mono: ['Geist Mono', 'ui-monospace', 'monospace'],
        serif: ['Instrument Serif', 'Times New Roman', 'serif'],
      },
      borderRadius: { xs: '4px', sm: '6px', md: '8px', lg: '12px', xl: '16px', xxl: '24px' },
      spacing: { section: '96px', hero: '128px' },
      boxShadow: {
        'drop-soft': '0 4px 16px rgba(10,10,10,0.04)',
        'drop-card': '0 8px 24px rgba(10,10,10,0.06)',
        'drop-modal': '0 24px 48px rgba(10,10,10,0.18)',
        'glow-accent': '0 0 0 4px rgba(124,58,237,0.35)',
        'glow-soft': '0 0 32px rgba(124,58,237,0.35)',
        'inset-edge': 'inset 0 1px 0 rgba(255,255,255,0.06)',
      },
      backdropBlur: { glass: '16px', hero: '80px' },
      backdropSaturate: { glass: '160%' },
      backgroundImage: {
        'gradient-orb':
          'radial-gradient(40% 60% at 20% 0%, #7C3AED 0%, transparent 60%),' +
          'radial-gradient(35% 50% at 80% 10%, #06B6D4 0%, transparent 60%),' +
          'radial-gradient(45% 60% at 60% 100%, #F97316 0%, transparent 60%)',
      },
      keyframes: {
        'cursor-blink': { '0%,49%': { opacity: '1' }, '50%,100%': { opacity: '0' } },
        shimmer: { '0%': { backgroundPosition: '-200% 0' }, '100%': { backgroundPosition: '200% 0' } },
      },
      animation: {
        'cursor-blink': 'cursor-blink 720ms steps(2) infinite',
        shimmer: 'shimmer 1400ms linear infinite',
      },
    },
  },
} satisfies Config;
```
