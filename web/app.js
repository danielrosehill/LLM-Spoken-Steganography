// Two-phone demo. Phone A: Send tab (model writes the carrier, browser TTS speaks it).
// Phone B: Receive tab (browser STT listens, cipher decodes, segmenter model only if needed).

import Anthropic from "@anthropic-ai/sdk";
import { encode, normaliseMessage, sentencesFor } from "../src/cipher.js";
import { send, receive } from "../src/pipeline.js";
import { laundretteAcrostic } from "../src/episode.js";

const $ = (id) => document.getElementById(id);

// --- per-viewer settings (convenience only; the page works without storage) ---
const store = {
  get(k) { try { return localStorage.getItem(k) || ""; } catch { return ""; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
};
for (const id of ["pass", "apikey", "model", "topic"]) {
  const v = store.get(`stego.${id}`);
  if (v) $(id).value = v;
  $(id).addEventListener("change", () => store.set(`stego.${id}`, $(id).value));
}
if (!$("pass").value || !$("apikey").value) $("settings").open = true;

function client() {
  const apiKey = $("apikey").value.trim();
  return apiKey ? new Anthropic({ apiKey, dangerouslyAllowBrowser: true }) : undefined;
}

// --- tabs ---
document.querySelectorAll("[data-tab]").forEach((b) =>
  b.addEventListener("click", () => {
    document.querySelectorAll("[data-tab]").forEach((x) => x.setAttribute("aria-selected", x === b));
    document.querySelectorAll("[data-panel]").forEach((p) => (p.hidden = p.dataset.panel !== b.dataset.tab));
  }),
);

// --- send ---
let script = null;

$("secret").addEventListener("input", () => {
  try {
    const m = normaliseMessage($("secret").value);
    const n = sentencesFor(m.length);
    $("capacity").textContent = `${m.length} characters → ${n} sentences, roughly ${Math.round((n * 13 * 60) / 150)} seconds of speech`;
  } catch { $("capacity").textContent = ""; }
});

function renderScript() {
  const all = [...script.sentences.map((s) => ({ ...s, carrier: true })), ...script.outro];
  const turns = [];
  all.forEach((s, i) => {
    const last = turns[turns.length - 1];
    if (last && last.speaker === s.speaker) last.items.push({ ...s, i });
    else turns.push({ speaker: s.speaker, items: [{ ...s, i }] });
  });
  $("scriptTitle").textContent = script.title;
  $("script").innerHTML = "";
  for (const t of turns) {
    const p = document.createElement("p");
    p.innerHTML = `<b></b> `;
    p.querySelector("b").textContent = `${t.speaker}:`;
    for (const s of t.items) {
      const span = document.createElement("span");
      span.dataset.i = s.i;
      if (s.carrier && $("reveal").checked) {
        const k = s.text.search(/[A-Za-z]/);
        span.append(s.text.slice(0, k));
        const mark = document.createElement("span");
        mark.className = "on";
        mark.textContent = s.text[k];
        span.append(mark, s.text.slice(k + 1) + " ");
      } else span.textContent = s.text + " ";
      p.append(span);
    }
    $("script").append(p);
  }
  $("scriptBox").hidden = false;
}
$("reveal").addEventListener("change", () => script && renderScript());

$("generate").addEventListener("click", async () => {
  const c = client();
  if (!c || !$("pass").value) { $("settings").open = true; $("sendStatus").textContent = "Set a passphrase and an API key first."; return; }
  $("generate").disabled = true;
  try {
    const res = await send(c, {
      message: $("secret").value,
      passphrase: $("pass").value,
      topic: $("topic").value,
      model: $("model").value,
      onProgress: (p) => {
        $("sendStatus").textContent = p.stage === "writing" ? "Writing the episode…"
          : p.stage === "repairing" ? `Repairing ${p.failing} sentence(s), round ${p.round}…` : "";
      },
    });
    script = res.script;
    renderScript();
    $("play").disabled = false;
    $("sendStatus").textContent = script.failures.length
      ? `⚠ ${script.failures.length} sentence(s) still break the rules; decoding may fail. Try again.`
      : `Ready: ${res.frame.letters.length} carrier sentences, ${script.repairs} repair round(s). Put the other phone on Receive → Listen, then press Play.`;
  } catch (e) {
    $("sendStatus").textContent = `Error: ${e.message}`;
  } finally {
    $("generate").disabled = false;
  }
});

// Browser TTS: one utterance per sentence (Chrome cuts off long utterances), two voices.
function pickVoices() {
  const en = speechSynthesis.getVoices().filter((v) => v.lang.startsWith("en"));
  return [en[0], en.find((v) => v !== en[0] && v.lang === en[0]?.lang) || en[1] || en[0]];
}
$("play").addEventListener("click", () => {
  speechSynthesis.cancel();
  const voices = pickVoices();
  const speakers = [...new Set(script.sentences.map((s) => s.speaker))];
  const all = [...script.sentences, ...script.outro];
  all.forEach((s, i) => {
    const u = new SpeechSynthesisUtterance(s.text);
    const who = Math.max(0, speakers.indexOf(s.speaker));
    u.voice = voices[who] || null;
    u.pitch = who ? 0.85 : 1.1; // keeps the hosts distinct when only one voice exists
    u.rate = 0.95;
    u.onstart = () => {
      document.querySelectorAll(".speaking").forEach((x) => x.classList.remove("speaking"));
      document.querySelector(`[data-i="${i}"]`)?.classList.add("speaking");
    };
    if (i === all.length - 1) u.onend = () => { $("stop").disabled = true; document.querySelectorAll(".speaking").forEach((x) => x.classList.remove("speaking")); };
    speechSynthesis.speak(u);
  });
  $("stop").disabled = false;
});
$("stop").addEventListener("click", () => { speechSynthesis.cancel(); $("stop").disabled = true; });

// --- receive ---
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let rec = null;
let listening = false;
let committed = "";

if (!SR) {
  $("listen").disabled = true;
  $("recvStatus").textContent = "This browser has no speech recognition. Use Chrome, or paste a transcript.";
}

$("listen").addEventListener("click", () => {
  committed = $("transcript").value ? $("transcript").value.trim() + " " : "";
  rec = new SR();
  rec.lang = "en-GB";
  rec.continuous = true;
  rec.interimResults = true;
  rec.onresult = (ev) => {
    let interim = "";
    for (let i = ev.resultIndex; i < ev.results.length; i++) {
      const r = ev.results[i];
      if (r.isFinal) committed += r[0].transcript.trim() + " ";
      else interim += r[0].transcript;
    }
    $("transcript").value = committed + interim;
  };
  // Mobile Chrome stops after silences; keep restarting until the user presses Stop.
  rec.onend = () => { if (listening) try { rec.start(); } catch {} };
  rec.onerror = (e) => { if (e.error !== "no-speech") $("recvStatus").textContent = `Mic: ${e.error}`; };
  listening = true;
  rec.start();
  $("listen").disabled = true;
  $("stopListen").disabled = false;
  $("recvStatus").textContent = "Listening… press Stop when the other phone finishes.";
});
$("stopListen").addEventListener("click", () => {
  listening = false;
  rec?.stop();
  $("listen").disabled = false;
  $("stopListen").disabled = true;
  $("recvStatus").textContent = "Stopped. Press Decode.";
});
$("clear").addEventListener("click", () => { $("transcript").value = ""; committed = ""; $("resultBox").hidden = true; });

$("decode").addEventListener("click", async () => {
  if (!$("pass").value) { $("settings").open = true; $("recvStatus").textContent = "Set the shared passphrase first."; return; }
  $("decode").disabled = true;
  $("recvStatus").textContent = "Decoding…";
  try {
    const r = await receive($("transcript").value, $("pass").value, { client: client(), model: $("model").value });
    $("resultBox").hidden = false;
    $("result").className = `result ${r.ok ? "ok" : "bad"}`;
    $("result").textContent = r.ok ? r.message : "No hidden message found";
    $("diag").textContent = r.attempts.map((a) => `[${a.via}] ${a.sentences.length} sentences, openers ${a.letters}`).join("\n")
      + (r.ok ? `\nframe: ${r.sentences} sentences from offset ${r.offset}` : `\n${r.reason}`);
    $("recvStatus").textContent = "";
  } catch (e) {
    $("recvStatus").textContent = `Error: ${e.message}`;
  } finally {
    $("decode").disabled = false;
  }
});

// --- episode ---
$("revealEpisode").addEventListener("click", async () => {
  const t = await (await fetch("episode/overheard-at-the-laundrette.transcript.md")).text();
  const { openers, letters } = laundretteAcrostic(t);
  $("openers").innerHTML = "";
  for (const w of openers) {
    const li = document.createElement("li");
    li.innerHTML = `<b></b>`;
    li.querySelector("b").textContent = w[0].toUpperCase();
    li.append(w.slice(1));
    $("openers").append(li);
  }
  $("episodeResult").textContent = letters;
});

// Exposed for console experiments.
window.stego = { encode };
