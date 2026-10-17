# GIVE WAY design system, round 4

The source of truth is the Figma file `HSRZm9qfJcg0n6gkeGVie1`: variables (Primitives, Theme with Night and Day modes, Dimensions), text styles, effect styles, the component library and the Round 4 page. `npm run tokens` turns `design/figma-variables.json` into `src/styles/tokens.css`. Components use semantic tokens only.

## Principles

- Black chrome, one accent. The top bar of every view is near-black (`--chrome`) in both themes. Royal blue (`--accent`) marks primary actions, selection, focus and links, and nothing else.
- Color carries state, not decoration. Risk colors appear only on risk bands, status marks, zones and the forecast. Every status also has a word or an icon.
- Hierarchy from weight, size and the three text colors (`--text`, `--muted`, `--faint`), not from boxes. Sections are separated by spacing and one hairline, never a card inside a card.
- Light and dark are both designed. Dark surfaces get lighter as they rise; light surfaces rise with layered shadows.

## Color

Built in OKLCH, stored as hex. Neutrals are tinted toward hue 262 so the grays feel cool and deliberate.

| Role | Night | Day |
|---|---|---|
| `--bg` app background | Gray dark 1 `#080a0e` | Gray light 2 `#f5f7f9` |
| `--panel` rails, desk | Gray dark 2 | Gray light 1 |
| `--raised` popovers, sheets, cards | Gray dark 3 | white |
| `--sunken` inputs | Gray dark 1 | Gray light 3 |
| `--hover`, `--selected` | Gray dark 4, Blue dark 3 | Gray light 4, Blue light 3 |
| `--line`, `--line-strong` | Gray dark 6, 7 | Gray light 6, 7 |
| `--text`, `--muted`, `--faint` | Gray dark 12, 11, 9 | Gray light 12, 11, 9 |
| `--accent`, `--accent-hover` | Blue dark 9 `#386be2`, 10 | Blue light 9 `#2c5fdd`, 10 |
| `--accent-text`, `--accent-subtle` | Blue dark 11, 3 | Blue light 11, 3 |
| `--chrome`, `--on-chrome` | `#090c11`, `#eff0f3` | same |

Risk: `--risk-low` gray, `--risk-medium` amber, `--risk-serious` orange, `--risk-high` red, `--risk-critical` crimson, matched in OKLCH lightness and slightly dimmer at night. `--tide` is kept as an alias of the accent for older rules.

## Type

IBM Plex Sans for the interface, IBM Plex Mono with tabular numbers for times, coordinates, odds, scores and counts. Minimum 13 px.

| Style | Size / line | Weight |
|---|---|---|
| Display (headline) | 24 / 30, -1% | 600 |
| Title (decision) | 20 / 26 | 600 |
| Heading (section) | 16 / 22 | 600 |
| Body, Body strong | 14 / 20 | 400, 500 |
| Small, Label | 13 / 18, 13 / 16 | 400, 500 |
| Instruction (phone) | 22 / 28, +1% | 600 |
| Data XL, Data, Mono small | 32 / 36, 14 / 20, 13 / 18 | Mono |

## Space, radius, elevation, motion

- Spacing 2, 4, 8, 12, 16, 20, 24, 32, 40, 48, 64. Space inside a group is smaller than space between groups.
- Radius 4 on controls, 6 on popovers, menus, callouts and phone buttons, 8 on sheets and the phone sheet, 0 on rails and bands.
- Elevation: `--shadow-1` rest cards, `--shadow-2` popovers and floating tools, `--shadow-3` sheets, drawers and alerts. Shadows are tinted with the ink color.
- Motion: 120, 180 and 240 ms with `--ease-out`; drawers use `--drawer`. Only opacity and transform animate. Reduced motion is honored.

## Components

- Buttons: primary is a solid accent with one per region; secondary is a raised neutral with a strong hairline; quiet is transparent until hover. Heights 32 and 44.
- Inputs are sunken with a strong hairline; focus is an accent border plus a soft accent ring.
- Segmented controls sit on a sunken track; the selected segment is raised.
- Tabs: muted text, selected text in `--text` with a 2 px accent underline.
- Status marks are 8 px squares with 2 px corners in the risk color, placed before the boat or ship name. Colored side stripes are not used.
- Risk band: full width, risk color, warning icon, level word and score.
- Popovers, menus, tooltips, callouts and the presenter float on `--raised` with a hairline and `--shadow-2`.

## Never

Gradients, glow, glass, gradient text, pills or chips around words, eyebrow labels, badges, count bubbles, emoji, decorative icons, nested cards, colored side stripes, centered app layouts, bounce easing, and `transition: all`.
