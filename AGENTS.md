# ScriptFlow

Free, fully client-side audio/video transcription tool, monetized via Google AdSense.
This is a **deliberate single-purpose site** — one keyword-matched domain per tool is
the whole SEO strategy. Do NOT add other tools, a multi-tool nav, or links out to
sibling projects (anyconvert, etc). If a second tool idea comes up, it gets its own
standalone project/domain, not a page here.

## What it does

One page (`/`): pick an audio or video file, transcribe it to text entirely on-device
using a small Whisper model running in-browser via WebAssembly. No upload, no backend,
no API key, no per-file cost. Model downloads once (~40–75MB) and is cached by the
browser (IndexedDB) so every transcription after the first works fully offline.

## Stack

- **AstroJS** (static output) + **Tailwind v4** (`@tailwindcss/vite` plugin, imported
  in `src/styles/global.css`)
- **@xenova/transformers** (Whisper `tiny.en`) — client-side transcription, loaded
  inside a plain (non-bundled) Web Worker at `public/transcribe-worker.js` via a CDN
  ESM import (jsDelivr), since Astro's Vite pipeline never processes `public/`.
- No ffmpeg.wasm, no image codecs (libheif/utif2/gifenc) — this tool doesn't need them.
  Only install what a given tool actually uses; don't cargo-cult the full anyconvert
  dependency list into a single-purpose project.
- **@astrojs/sitemap** for `sitemap-index.xml`.
- **Netlify** hosting.

## Design system (mandatory — do not deviate)

Premium cream/gold aesthetic, deliberately NOT the generic white/cyan AI-tool look:

- Background: `#FAF6EC` (warm cream)
- Card/surface: `#FFFFFF`, border `#E8DFC8` (warm, not gray)
- Headings text: `#2B2013` (warm espresso brown, not pure black)
- Body text: `#5C4F3D` (warm brown-gray)
- Accent/CTA/links/active state: `#C9982E` (warm gold), hover `#B8860B` (darker gold)
- Fonts: **Fraunces** (Google Font, soft-serif/display) for all headings — loaded via
  `<link>` in `Layout.astro`'s `<head>`, `font-display: swap`. **Inter** (Google Font)
  for body/labels/buttons/UI. Headings use weight 600–700 with slightly negative
  letter-spacing for a tightened, premium look.
- Generous whitespace, soft shadows only (never harsh), rounded-xl corners, no
  gradients, no dark mode toggle — cream-only is the whole point.

Tokens live in `src/styles/global.css` under `@theme` (`--color-cream`,
`--color-surface`, `--color-border-warm`, `--color-espresso`, `--color-brown`,
`--color-gold`, `--color-gold-dark`, `--font-display`, `--font-body`). Prefer the
arbitrary-value Tailwind classes (`text-[#2B2013]` etc.) already used throughout
`src/pages/*.astro` and `src/layouts/Layout.astro` to stay consistent with the
existing code rather than introducing a second token naming scheme.

## Structure

- `src/layouts/Layout.astro` — shared shell: simple header (brand name only, no nav to
  other tools by design), footer (About/Privacy/FAQ + copyright), SEO meta tags.
- `src/pages/index.astro` — the tool. File input → decode to 16kHz mono PCM via
  `OfflineAudioContext` → post to `/transcribe-worker.js` → Whisper pipeline →
  transcript textarea, with copy + download-as-.txt actions.
- `src/pages/about.astro`, `privacy.astro`, `faq.astro`, `404.astro` — required
  AdSense-eligibility pages, linked from both the homepage body and the footer.
- `public/transcribe-worker.js` — the Whisper worker (CDN ESM import of
  `@xenova/transformers`, since files in `public/` are never processed by Vite).
- `public/robots.txt`, `public/ads.txt` (placeholder — replace with the real AdSense
  publisher line once approved).

## Security

Any user-controlled text (e.g. selected filename) that could ever be routed through
`innerHTML` must go through an `escapeHtml()`-style helper first (see the helper at
the top of the `<script>` block in `src/pages/index.astro`). Currently the filename
display uses `textContent`, which is already safe, but the escape helper is applied
anyway as defense-in-depth and as the canonical pattern to copy if this code is ever
adapted to use `innerHTML`.

## Dev / test

- `npm run dev -- --port 4332` (or via `.claude/launch.json`'s `scriptflow` config) —
  runs on port **4332** (anyconvert owns 4325, reelshift owns 4333; keep ScriptFlow on
  its own port since sibling tool projects may be running concurrently). The port is
  intentionally NOT hardcoded into the `dev`/`preview` npm scripts (matching
  anyconvert's convention) so `launch.json`'s `-- --port 4332` is the single source of
  truth and doesn't collide with a second `--port` flag baked into the script itself.
- File-input-driven tools can't be tested with a real OS file picker in headless
  Playwright. Test by constructing a `File` via `new File([blob], name, {type})`,
  wrapping it in a `DataTransfer`, setting `input.files = dt.files`, dispatching a
  `change` event, then calling `document.getElementById('transcribe-btn').click()`
  directly (coordinate-based clicks get intercepted by the Astro dev toolbar overlay).
- Check `preview_console_logs` at `level: 'all'` when debugging the worker — some
  failures only surface inside the worker/progress callback, not as a top-level page
  error.

## iCloud sync hygiene

This project lives in iCloud Drive (`~/iCloud/website/scriptflow`). `node_modules` is
renamed to `node_modules.nosync` with a symlink back to `node_modules` so iCloud does
not try to sync build-tool dependency trees (it chokes on the file count). `.next`
doesn't apply here (Astro, not Next), but the same principle holds for `.astro/` and
`dist/` — device-local, not synced meaningfully, already gitignored.

`tsconfig.json`'s `exclude` array includes **both** `"node_modules"` and
`"node_modules.nosync"` — `tsc`/`astro check` does not recognize the `.nosync` suffix
as implicitly excluded, so without the explicit entry `astro check` crashes trying to
type-check into the dependency tree.

## Deploy

Netlify site: **scriptflow-875** (`scriptflow` was already taken on Netlify, which
auto-suffixed it) — **https://scriptflow-875.netlify.app**. Site ID is in
`.netlify/state.json`. Deployed via:

```bash
source ~/.claude/credentials/netlify.env
export NETLIFY_AUTH_TOKEN=$NETLIFY_API_KEY
netlify deploy --prod --dir=dist
```

Run `npm run build` first and confirm no errors before deploying.

## Single-purpose site strategy

This is intentional, not an oversight: ScriptFlow has no nav or footer links to any
other tool, no shared multi-tool homepage, and no "AnyConvert" branding anywhere. The
strategy across this site family is one narrow, keyword-matched tool per domain (this
one: transcription), each independently indexable and rankable, rather than one big
multi-tool hub. Do not merge this back into anyconvert or add tool-switcher UI.
