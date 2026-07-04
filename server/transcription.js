import { exec } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execAsync = promisify(exec);

const MAX_AUDIO_BYTES = Number.parseInt(process.env.BRUJULA_TRANSCRIBE_MAX_BYTES || "12000000", 10);
const TRANSCRIBE_TIMEOUT_MS = Number.parseInt(
  process.env.BRUJULA_TRANSCRIBE_TIMEOUT_MS || "120000",
  10,
);

const MIME_EXT = {
  "audio/webm": ".webm",
  "audio/webm;codecs=opus": ".webm",
  "audio/ogg": ".ogg",
  "audio/ogg;codecs=opus": ".ogg",
  "audio/mp4": ".m4a",
  "audio/mpeg": ".mp3",
  "audio/wav": ".wav",
  "audio/x-wav": ".wav",
};

export class TranscriptionError extends Error {
  constructor(message, status = 500) {
    super(message);
    this.status = status;
  }
}

function shellQuote(value) {
  if (process.platform === "win32") {
    return `"${String(value).replace(/"/g, '""')}"`;
  }
  return `"${String(value).replace(/(["\\$`])/g, "\\$1")}"`;
}

function extensionForMime(mime) {
  const normalized = String(mime || "").toLowerCase();
  return MIME_EXT[normalized] || MIME_EXT[normalized.split(";")[0]] || ".webm";
}

function normalizeTranscript(stdout, outputText) {
  const raw = (outputText || stdout || "").trim();
  if (!raw) return "";
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed.text === "string") return parsed.text.trim();
    if (typeof parsed.transcript === "string") return parsed.transcript.trim();
  } catch {
    /* Plain text stdout is the normal path for whisper.cpp/faster-whisper wrappers. */
  }
  return raw;
}

function buildCommand({ inputPath, outputPath, lang }) {
  const template = process.env.BRUJULA_TRANSCRIBE_COMMAND;
  if (!template) {
    throw new TranscriptionError(
      "local transcription is not configured; set BRUJULA_TRANSCRIBE_COMMAND to a Whisper/Parakeet command",
      503,
    );
  }

  const safeLang = /^[a-z]{2,8}(-[a-z0-9]{2,8})?$/i.test(lang) ? lang : "es";
  const replacements = {
    "{input}": shellQuote(inputPath),
    "{output}": shellQuote(outputPath),
    "{lang}": safeLang,
  };

  let command = template;
  for (const [token, value] of Object.entries(replacements)) {
    command = command.split(token).join(value);
  }

  if (!template.includes("{input}")) {
    command = `${command} ${shellQuote(inputPath)} ${safeLang}`;
  }
  return command;
}

export async function transcribeAudio({ audio_base64, audio_mime, lang = "es" }) {
  const audio = Buffer.from(audio_base64 || "", "base64");
  if (audio.length === 0) {
    throw new TranscriptionError("audio payload is empty", 400);
  }
  if (audio.length > MAX_AUDIO_BYTES) {
    throw new TranscriptionError("audio payload is too large", 413);
  }

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "brujula-stt-"));
  const inputPath = path.join(dir, `voice-${crypto.randomUUID()}${extensionForMime(audio_mime)}`);
  const outputPath = path.join(dir, "transcript.txt");

  try {
    await fs.writeFile(inputPath, audio);
    const command = buildCommand({ inputPath, outputPath, lang });
    const { stdout } = await execAsync(command, {
      timeout: TRANSCRIBE_TIMEOUT_MS,
      maxBuffer: 1024 * 1024,
      windowsHide: true,
    });

    let outputText = "";
    try {
      outputText = await fs.readFile(outputPath, "utf8");
    } catch {
      /* Commands may return the transcript on stdout instead. */
    }

    const text = normalizeTranscript(stdout, outputText);
    if (!text) {
      throw new TranscriptionError("local transcription returned no text", 502);
    }
    return { text, model: process.env.BRUJULA_TRANSCRIBE_MODEL || "local-stt" };
  } catch (err) {
    if (err instanceof TranscriptionError) throw err;
    throw new TranscriptionError(err.message || "local transcription failed", 502);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}
