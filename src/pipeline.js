// End-to-end sender and receiver, composed from the cipher, the carrier checks and the models.

import { encode, decode } from "./cipher.js";
import { openingLetters } from "./carrier.js";
import { writeCarrier, transcriptSentences } from "./models.js";

/** Secret message -> verified carrier script (ready for TTS). */
export async function send(client, { message, passphrase, ...opts }) {
  const frame = encode(message, passphrase);
  const script = await writeCarrier(client, { letters: frame.letters, ...opts });
  return { frame, script };
}

/**
 * Transcript -> secret message. Tries the transcript's own punctuation first; if that
 * does not yield a valid frame and a client is available, asks the segmenter model.
 */
export async function receive(transcript, passphrase, { client, model } = {}) {
  const attempts = [];
  const first = await transcriptSentences(transcript, { client, model });
  let letters = openingLetters(first.sentences);
  let result = decode(letters, passphrase);
  attempts.push({ via: first.via, letters, sentences: first.sentences, result });

  if (!result.ok && client && first.via === "punctuation") {
    const second = await transcriptSentences(transcript, { client, model, forceModel: true });
    letters = openingLetters(second.sentences);
    result = decode(letters, passphrase);
    attempts.push({ via: second.via, letters, sentences: second.sentences, result });
  }
  return { ...result, attempts };
}
