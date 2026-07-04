# Brújula — Logo Animation Prompts (needle spin 0° → 180° → 360°)

Two-step pipeline: **(1)** generate the rotation keyframes with the image
model, **(2)** feed them to **Seedance** (image-to-video) to produce the
animated logo for the demo video / deck.

Base asset: the chosen mark — garnet needle inside the broken circle with
signal arcs (`design/assets/logo-concepts-compass.png`, right-hand version).

---

## Prompt 1 — the keyframes (image model)

Consistency across separate generations is the enemy, so ask for **one sprite
sheet** — a single image containing all frames keeps style, stroke and colors
identical. Crop it into frames afterwards.

> A 3x3 sprite sheet grid, nine identical minimalist compass logos on a dark
> forest green background #0E1411. Each logo: a thin off-white circle with a
> gap at the upper right and two garnet signal arcs radiating through the gap
> — the circle, gap and arcs are IDENTICAL and static in all nine cells. Only
> the compass needle inside rotates clockwise from cell to cell: 0° (pointing
> straight up), 45°, 90°, 135°, 180° (pointing straight down), 225°, 270°,
> 315°, and back to 0°. The needle is a sharp elongated rhombus, garnet red
> #B03A46 on its leading half and off-white #EFF4F1 on its trailing half,
> with a small dark pivot dot at the center that never moves. Flat vector
> style, clean geometry, no gradients, no shadows, no text, no numbers,
> uniform cell spacing. Serious humanitarian-tech tone.

If the grid comes out inconsistent, fall back to single frames — reuse this
prompt verbatim and change ONLY the angle phrase each time:

> Minimalist compass logo, [...same description...], the needle rotated
> exactly 45 degrees clockwise from vertical. Same framing, same scale,
> same colors, centered, isolated on solid #0E1411.

(Generate 0°, 45°, 90°, 135°, 180°, 225°, 270°, 315°. The 0° frame doubles
as the final frame — a perfect loop.)

## Prompt 2 — the motion (Seedance, image-to-video)

Settings: 1:1 aspect, short clip (2–3 s), **first frame = the 0° keyframe**;
if the tool accepts a last frame too, set it to the same 0° image for a
seamless loop.

> Animate this logo: the garnet compass needle performs one full smooth
> 360-degree clockwise rotation around its center pivot — sweeping through
> 180 degrees (pointing down) and continuing back up to its starting position
> pointing north. The rotation starts fast and decelerates at the end, with a
> tiny overshoot past north and a settle back, like a real magnetic compass
> needle locking onto its bearing. EVERYTHING ELSE IS PERFECTLY STATIC: the
> white circle, the gap, the garnet signal arcs, the background and the
> center pivot dot do not move, wobble, morph or change color. Flat vector
> animation style, constant line weights, no camera movement, no zoom, no
> added elements, no light effects, clean seamless loop on a solid dark
> forest green background.

**Chosen variant — arc color pulse (use with the actual logo as reference
image):**

> Animate this logo exactly as drawn: the garnet compass needle performs one
> full smooth 360-degree clockwise rotation around its center pivot — sweeping
> through 180 degrees and continuing back up to settle pointing north,
> decelerating at the end with a tiny overshoot and settle, like a magnetic
> compass locking onto its bearing. While the needle rotates, the two signal
> arcs at the circle's gap slowly transition color from white to garnet red
> #B03A46 and back to white, one smooth pulse timed to complete exactly when
> the needle settles — like a radio signal charging and releasing. The arcs DO
> NOT move, grow or fade — only their color changes. Everything else is
> perfectly static: the white circle, its gap, the center pivot dot and the
> dark forest green background do not move, wobble, morph or change. Flat
> vector animation style, constant line weights, no camera movement, no zoom,
> no added elements, no glow, clean seamless loop.

Optional flourish (second variant worth one generation):

> ...as the needle settles pointing north, the two garnet signal arcs pulse
> once outward through the gap — a single radio ping — then return to static.

## Checklist

- [ ] Crop sprite sheet → 8 frames, verify pivot stays centered (onion-skin in any editor)
- [ ] Seedance clip: check the ring/arcs don't wobble (most common failure — regenerate if so)
- [ ] Export: MP4 for the demo video intro + a small looping GIF for the README header
- [ ] Commit finals to `design/assets/`

*Note for the app itself: the in-app version of this spin costs zero
generations — we already have `logo-brujula.svg`; a 10-line CSS
`transform: rotate()` keyframe does it pixel-perfectly. The prompts above are
for the video/deck asset where we want the drawn look.*
