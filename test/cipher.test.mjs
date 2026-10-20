import { test } from "node:test";
import assert from "node:assert/strict";
import { encode, decode, normaliseMessage, sentencesFor, CARRIER_LETTERS } from "../src/cipher.js";
import { checkSentence, splitSentences, openingLetters } from "../src/carrier.js";

const KEY = "correct horse battery staple";

test("round trip", () => {
  const { letters, message } = encode("Spare key under the blue pot", KEY);
  assert.equal(message, "SPARE KEY UNDER THE BLUE POT");
  assert.equal(letters.length, sentencesFor(message.length));
  assert.ok([...letters].every((c) => CARRIER_LETTERS.includes(c)));
  assert.deepEqual(decode(letters, KEY), { ok: true, offset: 0, message, sentences: letters.length });
});

test("wrong key is rejected", () => {
  const { letters } = encode("Meet at nine", KEY, { nonce: 7 });
  assert.equal(decode(letters, "not the key").ok, false);
});

test("random nonce: same message gives different letters", () => {
  const a = encode("Meet at nine", KEY, { nonce: 1 }).letters;
  const b = encode("Meet at nine", KEY, { nonce: 2 }).letters;
  assert.notEqual(a, b);
});

test("tolerates leading and trailing extra sentences", () => {
  const { letters, message } = encode("Hello", KEY, { nonce: 42 });
  const r = decode("WT" + letters + "SAD", KEY);
  assert.equal(r.ok, true);
  assert.equal(r.offset, 2);
  assert.equal(r.message, message);
});

test("a single mis-heard opener breaks the tag", () => {
  const { letters } = encode("Hello there", KEY, { nonce: 3 });
  const i = 5;
  const flipped = letters.slice(0, i) + (letters[i] === "A" ? "B" : "A") + letters.slice(i + 1);
  assert.equal(decode(flipped, KEY, { maxSkip: 0 }).ok, false);
});

test("digits are spelled out", () => {
  assert.equal(normaliseMessage("gate 9, 7pm"), "GATE NINE , SEVEN PM");
});

test("sentence checks", () => {
  assert.deepEqual(checkSentence("Good evening and welcome to the show.", "G"), []);
  assert.ok(checkSentence("Know what I mean?", "K").length);
  assert.ok(checkSentence("Doctor Smith arrived at 9 sharp.", "D").length);
  assert.ok(checkSentence("Dr. Smith arrived early today.", "D").length);
});

test("splitting a labelled transcript", () => {
  const t = "Maya: Good evening. Lovely day!\nOwen: Is it though? Absolutely not.";
  assert.deepEqual(splitSentences(t), ["Good evening.", "Lovely day!", "Is it though?", "Absolutely not."]);
  assert.equal(openingLetters(splitSentences(t)), "GLIA");
});

test("short STT fragments fold into the next sentence", () => {
  const t = "Absolutely. The society reopened the site. Crowds turned up with spades.";
  assert.deepEqual(splitSentences(t, { minWords: 4 }), ["Absolutely. The society reopened the site.", "Crowds turned up with spades."]);
  assert.ok(checkSentence("Absolutely, the society reopened it.", "A").length);
});
