// The unkeyed original: My Weird Prompts episode #6141, "Overheard at the Laundrette".
// One letter per Dorothy line (per speaker turn, not per sentence), no key.

import { firstWord } from "./carrier.js";

/** Openers of every line spoken by `speaker` in a "Name: text" transcript, and their initials. */
export function laundretteAcrostic(transcript, speaker = "Dorothy") {
  const openers = String(transcript)
    .split("\n")
    .filter((l) => l.startsWith(`${speaker}:`))
    .map((l) => firstWord(l.slice(speaker.length + 1)));
  return { openers, letters: openers.map((w) => w[0].toUpperCase()).join("") };
}
