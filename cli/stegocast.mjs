#!/usr/bin/env node
// stegocast: command-line sender and receiver for the keyed spoken acrostic.
//
//   stegocast letters "<message>" --key K            ciphertext letters only (no model call)
//   stegocast send "<message>" --key K [--topic T] [--hosts A,B] [--model M] [--out DIR] [--audio]
//   stegocast speak DIR/script.json [--out DIR/carrier.mp3]    two-voice TTS via edge-tts
//   stegocast transcribe AUDIO [--model-size small.en]         local Whisper via whisper-ctranslate2
//   stegocast receive TRANSCRIPT.txt --key K [--model M]       decode (model used only if needed)
//   stegocast episode                                          decode the unkeyed MWP #6141 acrostic

import { parseArgs } from "node:util";
import { mkdirSync, readFileSync, writeFileSync, rmSync, mkdtempSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import { encode } from "../src/cipher.js";
import { toScriptText, toTurns } from "../src/carrier.js";
import { send, receive } from "../src/pipeline.js";
import { DEFAULT_MODEL } from "../src/models.js";
import { laundretteAcrostic } from "../src/episode.js";

const here = dirname(fileURLToPath(import.meta.url));
const { values: opt, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    key: { type: "string", short: "k" },
    topic: { type: "string" },
    hosts: { type: "string", default: "Maya,Owen" },
    model: { type: "string", default: DEFAULT_MODEL },
    out: { type: "string", short: "o" },
    audio: { type: "boolean", default: false },
    voices: { type: "string", default: "en-GB-SoniaNeural,en-GB-RyanNeural" },
    "model-size": { type: "string", default: "small.en" },
  },
});
const [cmd, arg] = positionals;

function need(v, what) {
  if (!v) { console.error(`Missing ${what}. See the header of cli/stegocast.mjs for usage.`); process.exit(2); }
  return v;
}

function speak(scriptPath, outPath) {
  const script = JSON.parse(readFileSync(scriptPath, "utf8"));
  const voices = opt.voices.split(",");
  const speakers = [...new Set(script.sentences.map((s) => s.speaker))];
  const tmp = mkdtempSync(join(tmpdir(), "stegocast-"));
  const parts = toTurns([...script.sentences, ...(script.outro || [])]).map((turn, i) => {
    const f = join(tmp, `${String(i).padStart(3, "0")}.mp3`);
    const voice = voices[Math.max(0, speakers.indexOf(turn.speaker)) % voices.length];
    execFileSync("uvx", ["edge-tts", "--voice", voice, "--text", turn.text, "--write-media", f], { stdio: "ignore" });
    process.stderr.write(".");
    return f;
  });
  writeFileSync(join(tmp, "list.txt"), parts.map((p) => `file '${p}'`).join("\n"));
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", join(tmp, "list.txt"), "-c", "copy", outPath]);
  rmSync(tmp, { recursive: true });
  process.stderr.write(`\nWrote ${outPath}\n`);
}

switch (cmd) {
  case "letters": {
    const f = encode(need(arg, "message"), need(opt.key, "--key"));
    console.log(JSON.stringify(f, null, 2));
    break;
  }
  case "send": {
    const client = new Anthropic();
    const { frame, script } = await send(client, {
      message: need(arg, "message"),
      passphrase: need(opt.key, "--key"),
      topic: opt.topic,
      hosts: opt.hosts.split(","),
      model: opt.model,
      onProgress: (p) => console.error(`[${p.stage}]${p.round ? ` round ${p.round}` : ""}${p.failing != null ? ` failing=${p.failing}` : ""}`),
    });
    const out = resolve(opt.out || "out");
    mkdirSync(out, { recursive: true });
    // The plaintext is deliberately NOT written next to the carrier.
    writeFileSync(join(out, "script.json"), JSON.stringify({ model: opt.model, letters: frame.letters, ...script }, null, 2));
    writeFileSync(join(out, "script.txt"), `${script.title}\n\n${toScriptText(script)}\n`);
    console.error(`${frame.letters.length} carrier sentences, ${script.repairs} repair round(s), ${script.failures.length} unresolved.`);
    console.log(readFileSync(join(out, "script.txt"), "utf8"));
    if (opt.audio) speak(join(out, "script.json"), join(out, "carrier.mp3"));
    break;
  }
  case "speak": {
    const p = need(arg, "script.json path");
    speak(p, opt.out || join(dirname(p), "carrier.mp3"));
    break;
  }
  case "transcribe": {
    const audio = resolve(need(arg, "audio file"));
    const outDir = dirname(audio);
    execFileSync("uvx", ["whisper-ctranslate2", audio, "--model", opt["model-size"], "--language", "en",
      "--output_format", "txt", "--output_dir", outDir, "--device", "cpu", "--compute_type", "int8"], { stdio: ["ignore", "ignore", "inherit"] });
    console.log(readFileSync(audio.replace(/\.[^.]+$/, ".txt"), "utf8"));
    break;
  }
  case "receive": {
    const transcript = readFileSync(need(arg, "transcript file"), "utf8");
    const client = process.env.ANTHROPIC_API_KEY ? new Anthropic() : undefined;
    const r = await receive(transcript, need(opt.key, "--key"), { client, model: opt.model });
    for (const a of r.attempts) console.error(`[${a.via}] ${a.sentences.length} sentences, openers ${a.letters}`);
    if (r.ok) console.log(r.message);
    else { console.error(r.reason); process.exit(1); }
    break;
  }
  case "episode": {
    const t = readFileSync(join(here, "../episode/overheard-at-the-laundrette.transcript.md"), "utf8");
    const { openers, letters } = laundretteAcrostic(t);
    openers.forEach((w, i) => console.log(`${String(i + 1).padStart(2)}  ${letters[i]}  ${w}`));
    console.log(`\n${letters}`);
    break;
  }
  default:
    console.error("Commands: letters, send, speak, transcribe, receive, episode");
    process.exit(2);
}
