# Brújula — Image-Generation Prompt Kit (bosque brand)

Prompts for generating logos and brand assets with an image model
(Imagen / Nano Banana / whatever you have). Direction locked: **Field ·
Bosque** — tactical forest green + granate.

## Paste this block at the END of every prompt (brand constants)

> Brand colors: garnet red #B03A46 (primary), deep garnet #7D2530, dark
> forest green background #0E1411, off-white #EFF4F1. Flat vector style,
> clean geometry, no gradients, no drop shadows, no photorealism, no text
> unless specified. Serious humanitarian-tech tone: this is a disaster-response
> coordination tool — nothing playful, nothing corporate-startup, no disaster
> imagery, no victims, no destruction.

Tips: generate at 1:1 unless noted · ask for "isolated on solid #0E1411
background" (transparent PNG rarely works — cut it out later) · when one
comes out right, reuse its exact wording and iterate with small changes only.

---

## 1. Logo mark (the compass) — the priority asset

**1A — Compass needle, geometric:**
> Minimalist geometric logo mark for "Brújula", a disaster-response
> coordination tool. A stylized compass rose reduced to its essential form: a
> bold garnet-red needle pointing north inside a thin off-white circle, on a
> dark forest green background. The needle is a sharp elongated rhombus,
> slightly asymmetric so it feels like an instrument, not a decoration. Flat
> vector, single focal point, works at 32 pixels. Centered, isolated on solid
> #0E1411. + brand block

**1B — Compass + signal:**
> Minimal logo mark: a compass needle formed by two triangles — the north half
> in garnet red #B03A46, the south half in off-white — enclosed in a broken
> circle whose gap suggests a radio signal arc, on dark forest green. Flat
> vector, geometric, extremely simple, readable at favicon size. + brand block

**1C — Compass in a shield (civil-protection energy):**
> Emblem-style logo mark: a simplified compass rose inside a flat rounded
> shield outline, garnet red and off-white on dark forest green. The style of
> civil protection and rescue-team insignia, but modern and minimal — one
> weight of line, no ornament, no stars, no laurels. Flat vector. + brand block

## 2. App icon (phone home screen)

> Mobile app icon, rounded square. Dark forest green #0E1411 base with a bold
> garnet-red compass needle mark centered, off-white thin circle around it.
> Flat design, no gloss, no bevel, no border, generous padding, legible at
> 48 pixels. + brand block

## 3. Wordmark lockup (for the README + video title)

> Horizontal logo lockup: the compass needle mark at left, the word "BRÚJULA"
> at right in a bold geometric sans-serif, all caps, wide letter spacing,
> off-white on dark forest green; beneath it in small garnet letters the line
> "coordinación sin conexión". Flat vector, generous whitespace, 3:1 aspect
> ratio. + brand block

## 4. README / pitch-deck hero banner (16:9 or 3:1)

> Wide banner illustration, flat vector style: a dark forest green field with
> a subtle topographic-map line pattern in slightly lighter green; at center a
> garnet compass needle mark with thin off-white signal arcs radiating from
> it to three small device icons (two phones, one laptop) connected by thin
> dashed lines — a local mesh, no cloud anywhere. Optional tiny crossed-out
> cloud icon at the edge. Minimal, calm, technical. No text. + brand block

## 5. Demo-video title card (16:9)

> Title card background, 16:9: near-solid dark forest green #0E1411 with a
> very subtle darker vignette and a faint topographic line texture at 5%
> opacity; a small garnet compass mark bottom-right. Empty center — text gets
> added in the editor. Understated and serious. + brand block

## 6. Empty-state / onboarding spot illustrations (only if time allows)

> Small flat spot illustration on dark forest green: a hand-held radio and a
> paper map folded open, drawn in thin off-white lines with a single garnet
> accent, minimal geometric style, no people, no rubble. + brand block

> Small flat spot illustration on dark forest green: a laptop on a folding
> table with a small antenna, thin off-white line style, single garnet accent,
> no people. + brand block

## 7. Urgency icons (probably better hand-drawn as SVG, but if generating)

> Set of four minimal solid-color squares with rounded corners containing
> simple white glyphs: exclamation mark (red #FF453A), up arrow (orange
> #FF9500), horizontal dash (yellow #FFCC00), down arrow (gray #87988E). Flat,
> identical padding, icon-font simplicity. + brand block

---

## What NOT to generate

- Anything with rubble, injured people, or crying faces — the PRD's tone rule
  applies to brand assets too.
- Red crosses (protected emblem — legal issue), red crescents, UN logos.
- Photorealistic disaster scenes for the deck — use the map/mesh abstraction.

## Post-processing checklist

- [ ] Logo cut out and re-exported on transparent PNG + solid bosque PNG
- [ ] App icon masked to rounded square (1024, 512, 192, 48 px)
- [ ] Favicon 32 px — check the mark survives; if not, use needle only
- [ ] Everything committed to `design/assets/`
