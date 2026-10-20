# Method: keyed spoken acrostic

Specification of the scheme implemented in `src/`, the reasons behind each choice, and what was observed when testing it. Verified 2026-10-20 unless marked otherwise.

## 1. Threat model and channel

- **Channel**: text → TTS → loudspeaker → air → microphone → STT → text. Everything that is not a spoken word is lost on the way: whitespace, zero-width characters, typography, punctuation and capitalisation. Punctuation comes back only if the STT model re-inserts it.
- **What survives**: the words and their order. The cheapest robust signal is therefore the **first letter of each sentence**. One sentence carries one symbol.
- **Goal**: an eavesdropper hears an ordinary segment. If they suspect an acrostic, they recover only ciphertext, and without the key they cannot tell a real frame from noise.

## 2. Alphabets

| | Symbols | Bits |
|---|---|---|
| Plaintext `ALPHABET` | space, A–Z, `. , ? ! '` (32) | 5 per character |
| Carrier `CARRIER_LETTERS` | `A B C D F G H I L M N O P S T W` (16) | 4 per sentence |

Digits are spelled out (`9` → `NINE`) before encoding, which is what a TTS normaliser does anyway.

The carrier letters were picked for two reasons: English sentences open on them naturally, and STT spells their usual opening words consistently. The rest are left out for these reasons:

- **E** tends to come out as fillers ("Er", "Eh"). Herman hit exactly this in #6141 and replaced "Er" with "Exactly".
- **J K Q U V X Y Z** are hard to open on naturally. Herman: *"The K, the Y and the U are miserable."*
- **R** suffers from *Right/Write* confusion.

With 26 letters you would get 4.7 bits per sentence instead of 4. Losing that 0.7 bit buys much more natural cover text.

## 3. Keys and frame

```
key material = scrypt(passphrase, salt="llm-spoken-steganography/v1", N=2^15, r=8, p=1, 64 bytes)
encKey = bytes 0..31      macKey = bytes 32..63

frame (bits) = nonce(8, clear) || ChaCha20(encKey, nonce12 = 0^11 || nonce, body)
body         = length(8) || char_1..char_n (5 each) || tag(8) || zero-pad to a multiple of 4
tag          = HMAC-SHA256(macKey, nonce || ascii(message))[0]
letters      = CARRIER_LETTERS[each 4-bit group of frame]
sentences    = ceil((8 + 8 + 5n + 8) / 4)
```

- All cryptography comes from audited libraries (`@noble/ciphers` 2.4.0 for ChaCha20, `@noble/hashes` 2.4.0 for scrypt and HMAC). Only the bit packing is hand-written.
- A **random 8-bit nonce** means the same message under the same key gives a different carrier each time.
- **Length is encrypted**, so the receiver learns the frame size only with the right key.
- The **8-bit tag** rejects a wrong key or a damaged frame with probability 255/256 per alignment tried.

### Decoding and alignment

The receiver turns every transcribed sentence into its opening letter and tries frame offsets 0..6, accepting the first one whose tag verifies. This tolerates a receiver that started listening a few sentences late, or a free-form intro. The carrier may also have any number of free sentences *after* the frame (the writer adds a one-to-three-sentence outro), because the decrypted length says where the frame ends.

## 4. The writer model

`writeCarrier()` in `src/models.js`:

1. One call with a JSON-schema structured output: `{title, sentences:[{speaker,text}], outro:[…]}`. The prompt numbers the required letters (`1:P 2:G 3:W …`). It also says the letters are meaningless and must not be mentioned.
2. Every sentence goes through `checkSentence()` (`src/carrier.js`). The rules:
   - It starts with the required letter.
   - It is one sentence of 4 to 28 words, with no internal `.!?`, so no "Dr." or "U.S.".
   - It has no digits, symbols, colons or semicolons.
   - Its opener is not on the risky list: homophones whose first letter can change (*know/no*, *hour/our*, *one/won*, *write/right*, *whole/hole*, *where/wear*, *night/knight*), number words, or fillers.
   - There is **no comma straight after the first word** (see §6).
3. Failing sentences go back to the model by index, with the reason and the full script for context, and the returned fixes are spliced in. Up to 4 rounds.

Default model: **Claude Haiku 5.5** (`claude-haiku-5-5`). On the verified run it got all 41 openers right first time, using 1,132 input and 6,425 output tokens, about $0.003. Sonnet 5.5 is selectable. Opus was deliberately not used because of cost.

## 5. The receiver

`receive()` in `src/pipeline.js`:

1. If the transcript has punctuation (Whisper does), split on `.!?`. Any fragment under 4 words is folded into the next sentence.
2. Read the openers, then `decode()`.
3. If that fails and an API key is available, `resegmentTranscript()` asks the model to return the same words, in the same order, split into sentences. It may fix a word only to a homophone. Then the decode is tried again.

The browser's Web Speech API returns almost no punctuation, so on phones step 3 is the normal path.

## 6. Observed failure and fix (2026-10-20)

On the noisy copy (band-pass 300–3400 Hz, echo, pink noise), Whisper transcribed the writer's *"Absolutely, the allotment society reopened…"* as **"Absolutely. The allotment society reopened…"**. That added a sentence opening on T, shifted every later letter, and the tag rejected the frame. The clean copy had kept the comma.

The fix went in at both ends:

- **Writer**: a new rule forbids a comma straight after the first word. Interjection openers like "Absolutely," "Well," and "Apparently," are the ones STT promotes to their own sentence.
- **Receiver**: fragments under `MIN_WORDS = 4` merge forward. That length is safe because the writer never produces a carrier sentence that short.

Afterwards both the clean and the noisy transcripts decoded.

## 7. Known limits and next steps

- **Statistical detectability.** Openers are uniform over 16 letters, while natural speech is dominated by *I*, *And*, *So*, *The*, *It*, *Well*. The fix would be to map ciphertext to openers through a distribution-matching code (arithmetic decoding over natural opener frequencies, with the key as the seed). That costs capacity but buys security.
- **No error correction.** A single substituted opener loses the frame. An erasure-correcting code over the nibbles, such as Reed–Solomon over GF(16), would absorb a few STT mistakes.
- **Sentence boundaries are the weak point.** Merges and splits shift everything after them. The fold rule and the segmenter handle the observed cases. A homophone opener is a substitution, which the tag catches but cannot repair.
- **Capacity.** 4 bits per sentence and 24 bits of overhead mean about 30 characters in a 3-minute segment.
- **Nonce.** 8 bits only. Fine for a demo; a real scheme would derive a longer nonce from something both sides already share.
