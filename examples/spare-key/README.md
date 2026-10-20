# Verified run: "Spare key under the blue pot"

Passphrase `laundrette`. Generated and tested 2026-10-20.

| File | Stage |
|---|---|
| `script.json` / `script.txt` | Writer output (Claude Haiku 5.5): 41 carrier sentences + outro, required letters in `letters` |
| `carrier.mp3` | edge-tts, en-GB-SoniaNeural / en-GB-RyanNeural, 3:22 |
| `carrier.txt` | Whisper `small.en` transcript of the clean audio → decodes |
| `over-the-air.mp3` | Clean audio + 300–3400 Hz band-pass, echo and pink noise (the transcript was made from the WAV before mp3 compression) |
| `over-the-air.txt` | Whisper transcript of the noisy audio → decodes (after the fragment-folding fix, see docs/method.md §6) |
| `over-the-air.unpunctuated.txt` | The same with punctuation and capitals stripped → decodes via the segmenter model |

```bash
node cli/stegocast.mjs receive examples/spare-key/carrier.txt -k laundrette
```
