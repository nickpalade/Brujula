# Brújula — Design Philosophy Options

Three directions built around **granate** (dark red / garnet), the working
brand color. Open each `option-*.html` in a browser — they're self-contained
(no webfonts, no CDN, nothing external: **if the design needs the internet,
it's the wrong design for this product**).

| File | Direction | One-liner |
|---|---|---|
| `option-1-sala-de-crisis.html` | **Sala de Crisis** | Dark command-center. Near-black UI, granate as the brand thread, information glows. For long night shifts. |
| `option-2-granate-institucional.html` | **Granate Institucional** | Light, humanitarian-official. Paper background, deep granate authority. Feels like an institution you trust. |
| `option-3-brujula-field.html` | **Brújula Field** | Utilitarian field tool. Cool dark slate + granate, oversized touch targets, sunlight-legible. Built for gloves and cracked screens. |

## Shared principles (whichever option wins)

1. **Offline is a design constraint, not just a tech one.** System font stack
   only (`system-ui`), zero external assets, SVG icons inline.
2. **Granate is the brand, not the alarm.** Critical urgency must never be
   confused with brand color. Each option solves this differently — check the
   urgency ladder in each tile before choosing.
3. **The agent's reasoning is the hero.** Cards always show *why* (dedup
   reason, match reason). The design gives that text room.
4. **One design system, two postures.** Same tokens on the Command Post
   (dense, multi-column) and the field client (single column, fat targets).
5. **Respectful gravity.** This handles a real tragedy: no playful
   illustration, no gamification, no confetti on confirm.

## How to choose

Look at each option and ask: *would a coordinator trust it at 4 a.m.? can a
responder use it one-handed in the sun? does critical read as critical from
2 meters away?* Pick one, then Nick lifts its `:root` token block into the
React app as CSS variables — every tile uses the same variable names
(`--bg, --surface, --ink, --brand, --critical, --high, --medium, --low, ...`)
so the choice is a copy-paste, not a rebuild.
