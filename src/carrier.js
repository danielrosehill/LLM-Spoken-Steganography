// Carrier text handling: splitting a script or transcript into sentences, reading
// their opening letters, and checking that a generated sentence will survive
// TTS -> air -> STT with its opening letter intact.

// Openers whose spelling a speech-to-text model may pick differently from the
// writer, changing the first letter (know/no, hour/our, one/won, write/right...).
// Number words are listed because STT often writes them as digits.
const RISKY_OPENERS = new Set([
  "know", "knew", "knows", "knight", "knot", "knit", "knee", "knife",
  "hour", "hours", "our", "ours", "one", "ones", "won", "write", "wrote", "wright",
  "whole", "hole", "wear", "where", "ware", "night",
  "psychology", "pneumonia", "gnome", "eight", "two", "three", "four", "five", "six", "seven", "nine",
  "ten", "twenty", "thirty", "forty", "fifty", "hundred", "thousand", "million",
  "um", "uh", "er", "erm", "hmm", "mm", "ah", "oh", "ooh",
]);

const SPEAKER_LABEL = /^\s*(?:\*\*)?[A-Z][\w .'-]{0,30}?(?:\*\*)?:\s+/gm;

/** Remove "Name: " speaker labels at line starts. */
export function stripSpeakerLabels(text) {
  return String(text).replace(SPEAKER_LABEL, "");
}

export const MIN_WORDS = 4;

/**
 * Split prose into sentences on . ! ? (and …), keeping order.
 * With `minWords`, a fragment shorter than that is folded into the next sentence:
 * carrier sentences are never that short, so a fragment means STT punctuated an
 * interjection ("Absolutely. The society...") as its own sentence.
 */
export function splitSentences(text, { minWords = 0 } = {}) {
  const parts = stripSpeakerLabels(text)
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?…])["'”’)\]]*\s+/)
    .map((s) => s.trim())
    .filter((s) => /[A-Za-z]/.test(s));
  if (!minWords) return parts;
  const out = [];
  let carry = "";
  for (const p of parts) {
    const s = carry ? `${carry} ${p}` : p;
    if (s.split(" ").length < minWords) carry = s;
    else { out.push(s); carry = ""; }
  }
  if (carry) out.push(carry);
  return out;
}

/** First word of a sentence, lowercased, without surrounding punctuation. */
export function firstWord(sentence) {
  const m = String(sentence).match(/[A-Za-z0-9][A-Za-z0-9'’-]*/);
  return m ? m[0].toLowerCase() : "";
}

/** Uppercase opening letter, or "#" if the sentence opens on a digit. */
export function openingLetter(sentence) {
  const m = String(sentence).match(/[A-Za-z0-9]/);
  if (!m) return "";
  return /[0-9]/.test(m[0]) ? "#" : m[0].toUpperCase();
}

export function openingLetters(sentences) {
  return sentences.map(openingLetter).join("");
}

/**
 * Problems that would stop `sentence` from carrying `letter` through speech.
 * Returns [] when the sentence is safe.
 */
export function checkSentence(sentence, letter) {
  const s = String(sentence).trim();
  const issues = [];
  const words = s.split(/\s+/).filter(Boolean);
  if (openingLetter(s) !== letter) issues.push(`must start with the letter ${letter}`);
  if (RISKY_OPENERS.has(firstWord(s))) issues.push(`opening word "${firstWord(s)}" may be transcribed with a different first letter`);
  if (!/[.!?]$/.test(s)) issues.push("must end with . ! or ?");
  if (/[.!?…]/.test(s.slice(0, -1))) issues.push("must be exactly one sentence (no internal . ! ? or abbreviations like Dr. or U.S.)");
  if (/^\W*[A-Za-z'’-]+[,!]/.test(s)) issues.push("no comma straight after the first word; speech-to-text may punctuate an opener like that as a sentence of its own");
  if (/[0-9]/.test(s)) issues.push("numbers must be written as words");
  if (/[%&@#$/\\*_=+<>{}[\]|~^]/.test(s)) issues.push("no symbols; write everything as it is spoken");
  if (/[;:]/.test(s)) issues.push("no colons or semicolons; make it its own sentence instead");
  if (words.length < MIN_WORDS) issues.push("too short (at least four words, so STT does not merge it with a neighbour)");
  if (words.length > 28) issues.push("too long (at most twenty-eight words)");
  return issues;
}

/**
 * Check a whole carrier against the required letters.
 * @param {{speaker:string,text:string}[]} sentences
 * @returns {{index:number, letter:string, text:string, issues:string[]}[]}
 */
export function verifyCarrier(sentences, letters) {
  const failures = [];
  if (sentences.length !== letters.length) {
    failures.push({ index: -1, letter: "", text: "", issues: [`expected ${letters.length} sentences, got ${sentences.length}`] });
  }
  for (let i = 0; i < Math.min(sentences.length, letters.length); i++) {
    const issues = checkSentence(sentences[i].text, letters[i]);
    if (issues.length) failures.push({ index: i, letter: letters[i], text: sentences[i].text, issues });
  }
  return failures;
}

/** Collapse consecutive sentences by the same speaker into turns, for TTS and display. */
export function toTurns(sentences) {
  const turns = [];
  for (const { speaker, text } of sentences) {
    const last = turns[turns.length - 1];
    if (last && last.speaker === speaker) last.text += " " + text;
    else turns.push({ speaker, text });
  }
  return turns;
}

/** Plain script, one turn per line: "Name: text". */
export function toScriptText(script) {
  return toTurns([...script.sentences, ...(script.outro || [])])
    .map((t) => `${t.speaker}: ${t.text}`)
    .join("\n");
}
