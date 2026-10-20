# LLM Spoken Steganography

Proof of concept: **a language model hides an encrypted message in a mundane podcast script. The script is read aloud by text-to-speech, picked up by a second device's speech-to-text, and decoded with a shared key.**

The carrier is a *keyed spoken acrostic*. The message is encrypted, the ciphertext is written as a sequence of letters, and each letter becomes the first letter of one sentence in an otherwise ordinary two-host podcast segment. That position is used because it is about the only feature of text that survives TTS, the air gap and STT. Invisible characters, spacing and punctuation tricks do not.

```
secret ──► ChaCha20 + tag ──► opener letters ──► LLM writes carrier ──► TTS ──► 🔊 ~3 min
                                 P G W L T B …        "Pretty much everyone…"
🎙 ──► STT ──► sentence split (LLM only if no punctuation) ──► opener letters ──► decrypt + verify ──► secret
```

**Live two-phone demo: [huggingface.co/spaces/danielrosehill/LLM-Spoken-Steganography](https://huggingface.co/spaces/danielrosehill/LLM-Spoken-Steganography)** (direct app URL for phones: <https://danielrosehill-llm-spoken-steganography.static.hf.space>)

Neither model ever sees the plaintext. The writer sees only the ciphertext letters it has to start sentences with. The receiver's model, when it is needed at all, only restores sentence breaks in an unpunctuated transcript.

## Where this comes from: My Weird Prompts #6141

The repo grew out of **[“Overheard at the Laundrette”](https://myweirdprompts.com)**, My Weird Prompts episode #6141 (published 2026-10-19). Herman wrote a seven-minute scene between Dorothy and Tim, played it without warning, and then revealed that the first letter of each of Dorothy's 23 lines spells **SPARE KEY UNDER THE BLUE POT**.

- Audio: [`episode/overheard-at-the-laundrette.m4a`](episode/overheard-at-the-laundrette.m4a) (22:55, the scene runs from about 1:00 to 8:00)
- Script / transcript: [`episode/overheard-at-the-laundrette.transcript.md`](episode/overheard-at-the-laundrette.transcript.md)
- Decode it yourself: `node cli/stegocast.mjs episode`

That scene is an *unkeyed* acrostic, and on air it gets broken in about thirty seconds. Herman names the fix in the episode: *“A serious version would add a key… Encrypt the content, then hide that it exists.”* This repo implements that serious version and has a model write the cover text.

| | Episode #6141 | This method |
|---|---|---|
| Unit | one speaker's line | every sentence, both hosts |
| Key | none (security through obscurity) | shared passphrase → scrypt → ChaCha20 |
| Who writes the cover | Herman, by hand, many rewrites | an LLM, with an automatic verify-and-repair loop |
| Integrity check | none | 8-bit HMAC tag; a wrong key or a damaged frame is rejected |
| Capacity | 23 letters in ~7 min | ~1.25 sentences per character, so ~30 characters in ~3 min |

## Verified result (2026-10-20)

[`examples/spare-key/`](examples/spare-key/) is a complete run of the same secret, *Spare key under the blue pot*, under the passphrase `laundrette`:

1. **Writer**: Claude Haiku 5.5 wrote a 41-sentence local-news segment about an allotment garden reopening ([`script.txt`](examples/spare-key/script.txt)). All 41 openers were correct on the first pass with no repair rounds, for about a third of a US cent (1.1k input / 6.4k output tokens).
2. **TTS**: edge-tts with two voices gave 3 min 22 s of audio ([`carrier.mp3`](examples/spare-key/carrier.mp3)).
3. **Channel**: a phone-speaker band-pass, echo and pink noise ([`over-the-air.mp3`](examples/spare-key/over-the-air.mp3)).
4. **STT**: local Whisper `small.en`, run on both the clean and the noisy audio.
5. **Decode**: both transcripts gave `SPARE KEY UNDER THE BLUE POT`. A wrong passphrase was rejected. With all punctuation and capitals stripped (simulating the browser's Web Speech API), the Haiku segmenter restored the sentences and the message decoded again.

## Run it

Requires Node 20+. `send` and the unpunctuated-receive path need `ANTHROPIC_API_KEY`. `speak` needs `uvx` (edge-tts) and `ffmpeg`. `transcribe` needs `uvx` (whisper-ctranslate2, CPU is fine).

```bash
npm install
npm test

node cli/stegocast.mjs letters "Meet at the north gate at nine" -k "our passphrase"   # ciphertext letters only
node cli/stegocast.mjs send "Meet at the north gate at nine" -k "our passphrase" \
     --topic "a weekend weather round-up" --out out/demo --audio                     # script + carrier.mp3
node cli/stegocast.mjs transcribe out/demo/carrier.mp3                               # -> out/demo/carrier.txt
node cli/stegocast.mjs receive out/demo/carrier.txt -k "our passphrase"
```

`--model claude-sonnet-5-5` swaps the writer and segmenter. The default is Claude Haiku 5.5, which is cheap and was sufficient in testing.

### Two-phone demo

`index.html` is a static page with **Send**, **Receive** and **The episode** tabs. It is deployed as a static Hugging Face Space (link above) by `scripts/deploy-space.sh`, which uploads only the files the page needs plus `space/README.md`, the Space card with its YAML header. Any HTTPS static host works, since microphone access needs a secure context, as does `python3 -m http.server` on localhost. Then:

1. On both phones, open Settings and enter the same passphrase. The sending phone also needs an Anthropic API key, which is kept in that browser only.
2. **Phone A → Send**: type the secret, choose a topic, press *Write the episode*, then *Play aloud* (the browser's own speech synthesis).
3. **Phone B → Receive**: press *Listen* before A starts playing, *Stop* when it ends, then *Decode*.

Phone B uses Chrome's built-in speech recognition, which sends audio to Google's recogniser. It returns little or no punctuation, so the receiver uses the segmenter model, and phone B needs an API key too. Typing or pasting a transcript into the box also works.

## Layout

| Path | What |
|---|---|
| `src/cipher.js` | Frame format, key derivation and encryption ([`@noble/ciphers`](https://github.com/paulmillr/noble-ciphers) ChaCha20, [`@noble/hashes`](https://github.com/paulmillr/noble-hashes) scrypt + HMAC-SHA256). Isomorphic. |
| `src/carrier.js` | Sentence splitting, opener extraction, the TTS/STT safety rules each carrier sentence must pass |
| `src/models.js` | The writer (structured JSON output, then verify, then targeted repair) and the receiver's segmenter |
| `src/pipeline.js` | `send()` and `receive()` |
| `src/episode.js` | The unkeyed #6141 acrostic |
| `cli/stegocast.mjs` | CLI: `letters`, `send`, `speak`, `transcribe`, `receive`, `episode` |
| `index.html`, `web/app.js` | Two-phone browser demo (import map → esm.sh, no build step) |
| `docs/method.md` | Full specification, design decisions, failure modes and what was tried |
| `examples/spare-key/` | The verified run above |
| `space/README.md`, `scripts/deploy-space.sh` | Hugging Face Space card and deploy script (`HF_TOKEN` with write scope) |
| `episode/` | Audio and script of MWP #6141 |

## Limits (it is a proof of concept)

- **Steganalysis.** Encrypted openers are uniformly spread over 16 letters, while real speech opens on *I*, *And*, *So* and *The* far more often. Herman makes the same point on air: one segment proves nothing, but a hundred of them flag statistically. Shaping the ciphertext to match natural opener frequencies is the obvious next step.
- **Fragility.** One mis-heard or merged opener breaks the frame, and the tag then rejects it. There is no error correction yet.
- **Capacity.** About 4 bits per spoken sentence. That suits short messages, not documents.
- **8-bit nonce.** Repeated messages under one key are distinguishable 1 time in 256. This is fine for a demo, not for real use.
