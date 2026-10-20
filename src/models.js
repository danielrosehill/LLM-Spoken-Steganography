// The two language-model roles. Neither model ever sees the plaintext:
//   - the writer only gets the ciphertext letter sequence it must open sentences with;
//   - the segmenter only gets an unpunctuated transcript to restore sentence breaks in.
// `client` is an Anthropic SDK client (Node: `new Anthropic()`; browser: with
// `dangerouslyAllowBrowser: true`), injected so this file works in both.

import { verifyCarrier, splitSentences, MIN_WORDS } from "./carrier.js";

// Claude Haiku 5.5 is the default: cheap, and the verify-and-repair loop below
// catches the sentences it gets wrong. Pass "claude-sonnet-5-5" for fewer repair rounds.
export const DEFAULT_MODEL = "claude-haiku-5-5";

const SENTENCE_SCHEMA = {
  type: "object",
  properties: { speaker: { type: "string" }, text: { type: "string" } },
  required: ["speaker", "text"],
  additionalProperties: false,
};

const CARRIER_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    sentences: { type: "array", items: SENTENCE_SCHEMA },
    outro: { type: "array", items: SENTENCE_SCHEMA },
  },
  required: ["title", "sentences", "outro"],
  additionalProperties: false,
};

const FIX_SCHEMA = {
  type: "object",
  properties: {
    fixes: {
      type: "array",
      items: {
        type: "object",
        properties: { index: { type: "integer" }, text: { type: "string" } },
        required: ["index", "text"],
        additionalProperties: false,
      },
    },
  },
  required: ["fixes"],
  additionalProperties: false,
};

const SEGMENT_SCHEMA = {
  type: "object",
  properties: { sentences: { type: "array", items: { type: "string" } } },
  required: ["sentences"],
  additionalProperties: false,
};

const SPOKEN_RULES = `Every sentence is read aloud by a text-to-speech engine and later transcribed by speech-to-text, so:
- Exactly one sentence per item, between four and twenty-eight words, ending in a full stop, question mark or exclamation mark.
- No abbreviations with full stops (write "Doctor", "United States"), no digits (write numbers as words), no symbols, no colons or semicolons, no quotation marks.
- Do not open a sentence with a number word, a filler (um, er, oh, ah), or a word whose first letter is silent or could be spelled two ways when heard (know, hour, our, one, whole, write, where, wear, night).
- The first letter of the first word is what counts, so make the first word an ordinary, clearly pronounced word that flows straight into the rest of the sentence. Never put a comma right after the first word ("Absolutely, ...", "Well, ..."), because a listener's transcript may turn that word into a sentence of its own.`;

async function callJSON(client, { model, system, user, schema }) {
  const response = await client.messages.create({
    model,
    max_tokens: 16000,
    system,
    messages: [{ role: "user", content: user }],
    output_config: { format: { type: "json_schema", schema } },
  });
  if (response.stop_reason === "refusal") throw new Error("The model declined this request");
  if (response.stop_reason === "max_tokens") throw new Error("The model ran out of output tokens");
  const text = response.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  return { data: JSON.parse(text), usage: response.usage };
}

/**
 * Write a two-host carrier script whose Nth sentence opens with letters[N].
 * Verifies every sentence and asks the model to repair failures, up to `maxRepairs` rounds.
 * @returns {Promise<{title:string, sentences:{speaker:string,text:string}[], outro:{speaker:string,text:string}[], repairs:number, failures:object[], usage:object[]}>}
 */
export async function writeCarrier(client, {
  letters,
  topic = "a short local news update about the reopening of a community allotment garden",
  hosts = ["Maya", "Owen"],
  format = "a short two-host podcast segment",
  model = DEFAULT_MODEL,
  maxRepairs = 4,
  onProgress = () => {},
}) {
  const system = `You write natural, unremarkable spoken dialogue for ${format}. The listener must find it completely ordinary. You will be given a sequence of letters; each letter is the required first letter of one sentence, in order. The letters are meaningless to you; do not mention them, comment on them, or let them shape the content beyond the opening word.

${SPOKEN_RULES}`;

  const numbered = [...letters].map((c, i) => `${i + 1}:${c}`).join(" ");
  const user = `Topic: ${topic}
Hosts: ${hosts.join(" and ")} (alternate between them naturally; a host may speak several sentences in a row).

Write exactly ${letters.length} sentences in "sentences". Sentence number N must begin with the Nth letter below:
${numbered}

The first sentence should work as an opening line and the last as a natural place to start winding down. Then put one to three free sentences in "outro" (any opening letter) to close the segment. Keep it light, specific and mundane, the kind of thing nobody would listen to twice.`;

  const usage = [];
  onProgress({ stage: "writing", round: 0 });
  const first = await callJSON(client, { model, system, user, schema: CARRIER_SCHEMA });
  usage.push(first.usage);
  const script = { ...first.data, repairs: 0 };

  // Pad or trim to the exact count so repairs can be index-based.
  script.sentences = script.sentences.slice(0, letters.length);
  while (script.sentences.length < letters.length) script.sentences.push({ speaker: hosts[script.sentences.length % 2], text: "" });

  let failures = verifyCarrier(script.sentences, letters);
  for (let round = 1; failures.length && round <= maxRepairs; round++) {
    onProgress({ stage: "repairing", round, failing: failures.length });
    const listing = failures
      .map((f) => `#${f.index + 1} (must start with ${f.letter}): "${f.text}" -> ${f.issues.join("; ")}`)
      .join("\n");
    const context = script.sentences.map((s, i) => `${i + 1}. ${s.speaker}: ${s.text}`).join("\n");
    const fix = await callJSON(client, {
      model,
      system,
      schema: FIX_SCHEMA,
      user: `Here is the script so far:\n${context}\n\nThese sentences break the rules. Rewrite each one so it starts with the required letter, keeps the same speaker, fits between its neighbours, and follows every rule. Return one fix per listed sentence, using its number as "index".\n${listing}`,
    });
    usage.push(fix.usage);
    for (const { index, text } of fix.data.fixes) {
      const i = index - 1;
      if (i >= 0 && i < script.sentences.length) script.sentences[i] = { ...script.sentences[i], text: text.trim() };
    }
    script.repairs = round;
    failures = verifyCarrier(script.sentences, letters);
  }
  onProgress({ stage: "done", failing: failures.length });
  return { ...script, failures, usage };
}

/**
 * Receiver-side model: restore sentence boundaries in a speech-to-text transcript
 * that has little or no punctuation (e.g. the browser's Web Speech API).
 * @returns {Promise<string[]>}
 */
export async function resegmentTranscript(client, transcript, { model = DEFAULT_MODEL } = {}) {
  const { data } = await callJSON(client, {
    model,
    schema: SEGMENT_SCHEMA,
    system: "You restore sentence boundaries in raw speech-to-text transcripts of two people talking. Return the transcript as a list of sentences, in order. Keep every word exactly as transcribed and in the same order; do not add, remove, reorder or paraphrase words. The only change you may make to a word is correcting an obvious mis-transcription where the correct word sounds identical. Two hosts are talking in short sentences of roughly six to twenty words; each sentence is one complete thought.",
    user: transcript,
  });
  return data.sentences;
}

/** Sentences from a transcript: trust its punctuation if it has some, otherwise ask the segmenter. */
export async function transcriptSentences(transcript, { client, model, forceModel = false } = {}) {
  const punctuated = splitSentences(transcript, { minWords: MIN_WORDS });
  const words = transcript.split(/\s+/).filter(Boolean).length;
  const looksPunctuated = punctuated.length >= Math.max(3, words / 30);
  if (looksPunctuated && !forceModel) return { sentences: punctuated, via: "punctuation" };
  if (!client) return { sentences: punctuated, via: "punctuation (no model available)" };
  return { sentences: await resegmentTranscript(client, transcript, { model }), via: "model" };
}
