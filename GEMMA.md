# Gemma 4 — Research Brief for Brújula

*Track: Google DeepMind — Remote (Edge / On-Device). Compiled July 4, 2026, from Google's official docs/blogs and the Maarten Grootendorst "Visual Guide" series. Sources listed at the end.*

**TL;DR for the team:** Gemma 4 is the current generation of Google DeepMind's open models (Apache 2.0), explicitly built for the edge. The lineup runs from **E2B** (fits in <1.5 GB RAM, runs on a Raspberry Pi) to a **31B dense** model that ranks #3 on the Arena open-source leaderboard. All variants are multimodal (text + image; audio native on E2B/E4B/12B), support **140+ languages** (Spanish is well inside the top tier), and ship with **native function-calling and structured JSON output** — exactly what our parse→dedup→match pipeline needs. Everything runs on Ollama. For Brújula: **`gemma3n:e4b` (QAT) on the hub laptop is the sweet spot; E2B is the on-phone stretch.**

---

## 1. The Gemma 4 lineup

| Model | Params (effective/total) | Context | Modalities | Where it runs |
|---|---|---|---|---|
| **E2B** | 2.3B eff. (5.1B w/ embeddings) | 128K | text, image, **audio** | phones, Raspberry Pi, <1.5 GB RAM quantized |
| **E4B** | 4.5B eff. (8B w/ embeddings) | 128K | text, image, **audio** | any laptop, high-end phones |
| **12B** | 11.95B | 256K | text, image, **audio**, video | 16 GB VRAM / unified-memory laptops |
| **26B A4B (MoE)** | 25.2B total, **3.8B active** | 256K | text, image, video | consumer GPUs — near-31B quality at small-model speed |
| **31B dense** | 30.7B | 256K | text, image, video | workstation GPUs, cloud |

- License: **Apache 2.0** across the family.
- All models take video as frames (up to 60 s at 1 fps); audio input is capped at 30 s per clip — native on E2B/E4B/12B.
- Headline positioning: "byte for byte, the most capable open models" — intelligence-per-parameter. The 31B "outcompetes models 20× its size" and ranks **#3 on the Arena open-source text leaderboard** (the 26B MoE ranks #6).
- Benchmarks (instruct): 31B hits 85.2% MMLU-Pro / 84.3% GPQA Diamond; the 12B holds 77.2% MMLU-Pro — strong for a laptop-sized model.

## 2. What's new vs Gemma 3 (why it matters to us)

1. **Native agentic support** — function-calling, strict structured JSON output, and native system instructions are first-class, no fine-tuning needed. Google's framing: build "autonomous agents that interact with tools and APIs and execute workflows reliably." This directly de-risks our "Gemma returns strict JSON" pipeline step.
2. **Multi-step planning on-device** — the Edge Gallery post demonstrates "multi-step planning, autonomous action, offline code generation, audio-visual processing" running fully on-device.
3. **140+ language multilingual support** (35+ out-of-the-box) — messy Spanish field reports are a supported case, not an edge case.
4. **Native audio input (E2B/E4B/12B)** — a potential **fallback for Gradium STT**: feed the voice note straight to Gemma. Caveat: 30-second clip limit, so chunk longer reports.
5. **Longer context** — 128K on the E-models, 256K on 12B+. The whole incident board fits in one prompt with room to spare.
6. **Speed** — MoE + multi-token prediction + QAT (below) make local inference dramatically faster than the Gemma 3 era.

## 3. Architecture notes (the short version)

From the Visual Guide series — useful for the pitch, not required reading:

- **Interleaved attention:** local (sliding-window, 512 tokens) and global attention layers alternate 4:1 (E2B) or 5:1 (larger), with grouped-query attention, K=V sharing in global layers, and pruned RoPE — this is how long context stays cheap in memory.
- **Per-Layer Embeddings (E2B/E4B):** compact per-layer embeddings live in flash storage and stream in during inference — the trick that makes an effectively-2B/4B model out of 5B/8B parameters and the core of the on-device story.
- **26B A4B MoE:** 128 experts, 8 active per token plus a larger shared expert → only ~3.8B parameters compute per token.
- **Encoder-free multimodal (12B):** no separate vision/audio encoders. A 35M-param embedder projects raw 48×48 pixel patches straight into the LLM; audio is raw 16 kHz amplitude in 40 ms frames. Faster time-to-first-token; the LLM does all the semantic work. (E2B/E4B/31B use conventional ViT/Conformer encoders.)

## 4. Running it locally (our deployment path)

- **Ollama:** Gemma 4 is on Ollama day-one, alongside llama.cpp, LM Studio, MLX, vLLM, SGLang, LiteRT-LM, and 20+ platforms. Our PRD's `localhost:11434` plan is unchanged — just pull a Gemma 4 tag instead of `gemma3:4b`.
- **QAT (quantization-aware training) checkpoints:** Google ships quantization-trained versions of **E2B, E4B, and 26B MoE** (Q4_0 GGUF + a mobile-optimized format). Because quantization happens during training, quality loss is minimal vs. post-training quantization. The QAT E2B text-only model runs in **under 1 GB of memory**. **Always prefer the QAT builds for the demo.**
- **Multi-token prediction (MTP) drafters:** small drafter models (e.g., 76M for E2B) speculate several tokens ahead; the main model verifies in parallel → **up to 3× faster generation with zero quality loss**, supported in Ollama, Transformers, MLX, vLLM. Worth enabling if the demo feels laggy.
- **Measured edge performance:** E2B in <1.5 GB memory; Raspberry Pi 5 CPU: 133 prefill / 7.6 decode tok/s; Qualcomm NPU: 3,700 prefill / 31 decode tok/s. A mid-range laptop running E4B will comfortably beat all of that.
- **LiteRT-LM:** Google's on-device runtime — minimal footprint, **constrained decoding for reliable structured outputs**, dynamic context, a no-code `litert-lm` CLI, and an OpenAI-compatible local API server. This is the serious path for the on-phone stretch goal; the **AI Edge Gallery** app (iOS/Android) demos multi-step agent skills on-device and is good pitch ammunition.

## 5. The wider ecosystem

- **Gemma Cookbook** ([github.com/google-gemma/cookbook](https://github.com/google-gemma/cookbook)) — tested notebooks (Tutorials / Apps / Experiments / Responsible AI), covering the family and variants (CodeGemma, PaliGemma, ShieldGemma, MedGemma…). First stop for prompt/finetune examples.
- **Gemma Skills** ([github.com/google-gemma/gemma-skills](https://github.com/google-gemma/gemma-skills)) — installable skill packages for Gemma agents (via the Vercel skills CLI or Context7 CLI). Currently one skill, `gemma-dev`: a dev-assistant skill for building with Gemma. Install it in our coding environment during the hackathon.
- **DiffusionGemma** (experimental) — Gemma 4 26B adapted to *parallel* text generation: it iteratively denoises a 256-token canvas instead of emitting tokens one-by-one (bidirectional attention in "denoiser mode"). Up to **4× faster single-user generation** (700+ tok/s on an RTX 5090), strong at constraint-satisfaction and self-correction; weaker at multi-user throughput. Runs via vLLM/Transformers/MLX, Apache 2.0. **Not for our MVP** (needs a big GPU), but worth one pitch line as track-awareness.
- Try-it-now: [Google AI Studio](https://aistudio.google.com/prompts/new_chat?model=gemma-4-31b-it) hosts `gemma-4-31b-it` for free prompt iteration before the event.

## 6. What this means for Brújula — concrete recommendations

1. **Hub model: `gemma4` E4B QAT via Ollama.** ~8B-class quality in a few GB of RAM, 128K context, native structured JSON. Fall back to E2B QAT if the demo laptop struggles; step up to 12B only if the laptop has 16 GB VRAM/unified memory. (Update PRD §4.3, which still says `gemma3:4b`.)
2. **Lean on native function-calling + JSON output** rather than pure prompt discipline — the parse step's "retry-on-invalid-JSON" risk (PRD §8) largely disappears; keep the retry as belt-and-braces.
3. **Audio-native as STT fallback:** E4B accepts voice directly. If Gradium is down or credits run out, pipe the field recording (chunked to <30 s) straight into Gemma — the whole voice path stays offline, which is an even *better* track story.
4. **Photo triage (stretch) is cheap:** image input is native on every variant; no extra model needed.
5. **On-phone stretch = E2B QAT + LiteRT-LM** (or the AI Edge Gallery for a quick demo). Sub-1.5 GB memory makes "a lone field device with no hub" genuinely feasible.
6. **Pre-warm and enable MTP** before the demo; pitch-ready numbers: <1 GB QAT footprint, 3× MTP speedup, 140+ languages, Arena top-3 open model — all offline, all Apache 2.0.

---

## Sources

**Official — Google**
- [Gemma 4 model card](https://ai.google.dev/gemma/docs/core/model_card_4)
- [Gemma 4: Byte for byte, the most capable open models](https://blog.google/innovation-and-ai/technology/developers-tools/gemma-4/)
- [Accelerating Gemma 4: multi-token prediction drafters](https://blog.google/innovation-and-ai/technology/developers-tools/multi-token-prediction-gemma-4/)
- [Gemma 4 QAT models](https://blog.google/innovation-and-ai/technology/developers-tools/quantization-aware-training-gemma-4/)
- [Gemma 4 12B: The Developer Guide](https://developers.googleblog.com/gemma-4-12b-the-developer-guide/)
- [DiffusionGemma: The Developer Guide](https://developers.googleblog.com/diffusiongemma-the-developer-guide/)
- [Agentic skills on the edge with Gemma 4 (AI Edge Gallery)](https://developers.googleblog.com/bring-state-of-the-art-agentic-skills-to-the-edge-with-gemma-4/)
- [Gemma Cookbook](https://github.com/google-gemma/cookbook) · [Gemma Skills](https://github.com/google-gemma/gemma-skills/)

**Community — Maarten Grootendorst's Visual Guides**
- [A Visual Guide to Gemma 4](https://newsletter.maartengrootendorst.com/p/a-visual-guide-to-gemma-4)
- [A Visual Guide to Gemma 4 12B](https://newsletter.maartengrootendorst.com/p/a-visual-guide-to-gemma-4-12b)
- [A Visual Guide to DiffusionGemma](https://newsletter.maartengrootendorst.com/p/a-visual-guide-to-diffusiongemma)
