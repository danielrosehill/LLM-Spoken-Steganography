// Keyed spoken acrostic: encrypt a short message, then express the ciphertext as
// the opening letters of consecutive sentences.
//
// Crypto is delegated to audited libraries (@noble/ciphers, @noble/hashes).
// The only hand-written part is the packing of bits into 4-bit "opening letters".
// Isomorphic: runs unchanged in Node 20+ and in the browser (via an import map).

import { chacha20 } from "@noble/ciphers/chacha.js";
import { scrypt } from "@noble/hashes/scrypt.js";
import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";

// 32 plaintext symbols -> 5 bits each. Digits are spelled out before encoding,
// matching what a TTS normaliser would do anyway.
export const ALPHABET = " ABCDEFGHIJKLMNOPQRSTUVWXYZ.,?!'";

// 16 carrier letters -> 4 bits per sentence. Chosen because English sentences
// open on them easily and speech-to-text spells their usual openers reliably.
// Deliberately excluded: E (often "Er"/"Eh" fillers), J K Q U V X Y Z (hard to
// open naturally), R (Right/Write homophone).
export const CARRIER_LETTERS = "ABCDFGHILMNOPSTW";

export const MAX_MESSAGE_LENGTH = 255;
const SALT = new TextEncoder().encode("llm-spoken-steganography/v1");
const NONCE_BITS = 8;
const LENGTH_BITS = 8;
const TAG_BITS = 8;

const DIGIT_WORDS = ["ZERO", "ONE", "TWO", "THREE", "FOUR", "FIVE", "SIX", "SEVEN", "EIGHT", "NINE"];

/** Uppercase, spell out digits, drop anything outside ALPHABET, collapse spaces. */
export function normaliseMessage(text) {
  let s = String(text)
    .toUpperCase()
    .replace(/[0-9]/g, (d) => ` ${DIGIT_WORDS[Number(d)]} `)
    .replace(/[‘’`]/g, "'")
    .replace(/[-_/\n\t]/g, " ");
  s = [...s].filter((c) => ALPHABET.includes(c)).join("");
  s = s.replace(/ +/g, " ").trim();
  if (!s) throw new Error("Message is empty after normalisation");
  if (s.length > MAX_MESSAGE_LENGTH) throw new Error(`Message longer than ${MAX_MESSAGE_LENGTH} characters`);
  return s;
}

/** Sentences needed to carry a message of `length` normalised characters. */
export function sentencesFor(length) {
  return Math.ceil((NONCE_BITS + LENGTH_BITS + 5 * length + TAG_BITS) / 4);
}

const keyCache = new Map();

/** scrypt(passphrase) -> { encKey, macKey }. Cached per passphrase: scrypt is slow on purpose. */
export function deriveKeys(passphrase) {
  if (!passphrase) throw new Error("A shared passphrase is required");
  if (!keyCache.has(passphrase)) {
    const okm = scrypt(new TextEncoder().encode(passphrase), SALT, { N: 2 ** 15, r: 8, p: 1, dkLen: 64 });
    keyCache.set(passphrase, { encKey: okm.slice(0, 32), macKey: okm.slice(32) });
  }
  return keyCache.get(passphrase);
}

function chachaNonce(nonceByte) {
  const n = new Uint8Array(12);
  n[11] = nonceByte;
  return n;
}

function tagOf(macKey, nonceByte, message) {
  const data = new Uint8Array([nonceByte, ...new TextEncoder().encode(message)]);
  return hmac(sha256, macKey, data)[0];
}

// --- bit helpers -----------------------------------------------------------

function pushBits(bits, value, width) {
  for (let i = width - 1; i >= 0; i--) bits.push((value >> i) & 1);
}

function readBits(bits, start, width) {
  let v = 0;
  for (let i = 0; i < width; i++) v = (v << 1) | bits[start + i];
  return v;
}

function bitsToBytes(bits) {
  const out = new Uint8Array(Math.ceil(bits.length / 8));
  bits.forEach((b, i) => { out[i >> 3] |= b << (7 - (i & 7)); });
  return out;
}

function bytesToBits(bytes, count) {
  const bits = [];
  for (let i = 0; i < count; i++) bits.push((bytes[i >> 3] >> (7 - (i & 7))) & 1);
  return bits;
}

function xorWithKeystream(bits, encKey, nonceByte) {
  const ct = chacha20(encKey, chachaNonce(nonceByte), bitsToBytes(bits));
  return bytesToBits(ct, bits.length);
}

function lettersToBits(letters) {
  const bits = [];
  for (const c of letters) {
    const v = CARRIER_LETTERS.indexOf(c);
    if (v < 0) return null;
    pushBits(bits, v, 4);
  }
  return bits;
}

// --- public API ----------------------------------------------------------------

/**
 * Encrypt `message` under `passphrase` and return the required sentence-opening letters.
 * @returns {{ message: string, letters: string, sentences: number, nonce: number }}
 */
export function encode(message, passphrase, { nonce } = {}) {
  const msg = normaliseMessage(message);
  const { encKey, macKey } = deriveKeys(passphrase);
  const nonceByte = nonce ?? crypto.getRandomValues(new Uint8Array(1))[0];

  const body = [];
  pushBits(body, msg.length, LENGTH_BITS);
  for (const c of msg) pushBits(body, ALPHABET.indexOf(c), 5);
  pushBits(body, tagOf(macKey, nonceByte, msg), TAG_BITS);
  while (body.length % 4) body.push(0);

  const frame = [];
  pushBits(frame, nonceByte, NONCE_BITS);
  frame.push(...xorWithKeystream(body, encKey, nonceByte));

  let letters = "";
  for (let i = 0; i < frame.length; i += 4) letters += CARRIER_LETTERS[readBits(frame, i, 4)];
  return { message: msg, letters, sentences: letters.length, nonce: nonceByte };
}

/** Try to decode a frame starting exactly at the first letter. Returns the message or null. */
function decodeAt(letters, passphrase) {
  const head = lettersToBits(letters.slice(0, 4));
  if (!head || head.length < 16) return null;
  const nonceByte = readBits(head, 0, NONCE_BITS);
  const { encKey, macKey } = deriveKeys(passphrase);

  // Decrypt the length first to learn how many letters the frame spans.
  const lenBits = xorWithKeystream(head.slice(8, 16), encKey, nonceByte);
  const length = readBits(lenBits, 0, LENGTH_BITS);
  if (length === 0) return null;
  const total = sentencesFor(length);
  if (letters.length < total) return null;

  const frame = lettersToBits(letters.slice(0, total));
  if (!frame) return null;
  const body = xorWithKeystream(frame.slice(NONCE_BITS), encKey, nonceByte);
  let msg = "";
  for (let i = 0; i < length; i++) msg += ALPHABET[readBits(body, LENGTH_BITS + 5 * i, 5)];
  const tag = readBits(body, LENGTH_BITS + 5 * length, TAG_BITS);
  return tag === tagOf(macKey, nonceByte, msg) ? { message: msg, sentences: total } : null;
}

/**
 * Recover a message from the opening letters of a transcript's sentences.
 * Tolerates up to `maxSkip` leading sentences (receiver started listening late,
 * or the carrier has a free-form intro). The 8-bit tag means a wrong key or a
 * damaged frame is rejected with probability 255/256 per offset tried.
 * @returns {{ ok: true, message: string, offset: number, sentences: number } | { ok: false, reason: string }}
 */
export function decode(letters, passphrase, { maxSkip = 6 } = {}) {
  const clean = String(letters).toUpperCase();
  for (let offset = 0; offset <= Math.min(maxSkip, clean.length - 4); offset++) {
    const hit = decodeAt(clean.slice(offset), passphrase);
    if (hit) return { ok: true, offset, ...hit };
  }
  return { ok: false, reason: "No valid frame found (wrong key, missing/merged sentences, or a mis-heard opener)" };
}
