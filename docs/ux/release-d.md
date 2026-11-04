# Release D: clarity, reliability and a modern design

Screenshots: `release-d/before-*.png` (the app at `32534fe`) and `release-d/after-*.png`, both at
390 × 844 with the same seeded data (`tests/releaseddata.js`: a busy day plus one failed workflow,
an automation that failed on its own, a verified result, a paused and a running workflow with a
guide being followed inside it, a standalone guide run and a rule). `after-dark-*` are the dark
theme at 360 × 800.

## Design choice

Two directions were compared on the real screens at Android sizes:

1. **The pixel look, refined**: thinner outlines and the plain font. Still a heavy outline round
   every card, chip and button, offset shadows, a saturated palette in which everything competes,
   and a wide display font that forces tiny heading sizes. Status colour was carried by bright
   fills (yellow, pink, green), so a list of rows read as a wall of buttons.
2. **Calm productivity** (chosen): neutral surfaces, one accent, hairline separators, the system
   UI font. It is denser without being cramped, scans faster (hierarchy comes from type weight
   and space rather than borders), keeps status meaning in words with colour as support, and
   needs no web-font download (better offline and first paint).

## Tokens (`styles.css`, `:root`)

| Role | Light | Dark |
| --- | --- | --- |
| Page `--bg` | `#f5f6f8` | `#12161c` |
| Surface `--panel` / quiet fill `--panel-2` | `#ffffff` / `#eef1f4` | `#1b2129` / `#252c36` |
| Text `--ink` / secondary `--muted` | `#1f2a3d` (13:1) / `#586274` (5.7:1) | `#e7ebf0` / `#a3adba` |
| Dividers `--line` / outlines `--edge` / fields `--edge-strong` | `#e3e7ec` / `#d3d9e1` / `#7f8a99` (3:1) | `#2b333e` / `#364050` / `#7a8596` |
| Accent `--accent` (primary actions, selection) | `#2c6e79` (white text 5.8:1) | `#5fb3bf` (dark text 7.4:1) |
| Success / warning / error / waiting / info | `#276d43` / `#8a5a00` / `#b2443a` / `#a54a17` / `#2f63a3`, each with a `-soft` fill (≥ 4.5:1 on it) | lighter tones on deep fills |
| Focus ring `--focus` | 2px solid accent, 2px offset | `#7cc6d1` |

Tag swatches keep their stored names (`var(--pink)` and so on, since tags save the colour by name)
as mid tones under dark text. Spacing follows 4 / 8 / 12 / 16 / 24px; radius 12px (cards), 8px
(controls), 5px (tags); elevation is a 1px shadow on cards and a soft shadow on sheets and toasts.

## Type

The system UI stack (`system-ui, -apple-system, Segoe UI, Roboto…`) on five steps: 13 (labels,
badges), 14 (metadata), 16 (body), 18 (section heads), 22 (page titles), with tabular figures for
numbers. **Larger text** (Settings > Appearance) moves every step up by 2px. The old pixel/plain font
setting is read as standard text (nothing to undo); colours (system / light / dark) are unchanged.

## Components

- **Buttons**: one filled primary (`.btn.green`, the accent) per screen or card; `.btn.blue` a
  tonal accent; `.btn` a neutral secondary; `.btn.pink` a quiet warning (error tint). A row's own
  action in a list is tonal. 44px high (40px for `.sm`).
- **Chips** are pills; the selected one takes the accent's soft fill and outline (or the tag's
  colour). **Tags** are small tinted labels, each with a word.
- **Rows** in a list are separated by hairlines inside one card; no card inside a card.
- **Fields** have a 3:1 outline, 44px height, the accent on focus.
- **Tab bar**: five tabs that fit at 360px (they scroll at 320px), the current one in the accent's
  soft fill.

## Information architecture

- **Header**: full on Today and Focus; elsewhere one line (`Now: task · step` as a way back, the
  running timer's clock, label and Pause when there is one, search and sync). 137px → 62px at
  360–412px widths, so about 75px of the first screen comes back on Knowledge, Review and Settings.
- **Settings**: an index of seven groups, each a page (Sync and account; Appearance and this
  device; Tags; Rules; Automations and integrations; Backup and restore; Health check). Rules are
  two taps from anywhere, with no scrolling (the old page was 2020px long at 390px).
- **Forecast**: headline, an overload line, the radar, the picked day, then one finding with its
  action; the rest under *More suggestions*, the unestimated tasks behind a fold.
- **Processes**: *Needs attention* (failed runs) apart from *In progress*; a guide followed inside
  a process shows through that process; a name search and a state filter.
