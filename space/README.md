---
title: Spoken Steganography
emoji: 🧺
colorFrom: yellow
colorTo: blue
sdk: static
app_file: index.html
pinned: false
license: mit
short_description: Encrypted message hidden in an AI podcast's sentence openers
---

# Spoken steganography: two-phone demo

An encrypted message is hidden in the first letters of the sentences of a dull, LLM-written podcast segment. One phone reads it aloud. A second phone listens, transcribes and decodes it with the shared passphrase.

- **Send**: enter a passphrase, an Anthropic API key (kept in your browser, sent only to api.anthropic.com) and a secret. Claude Haiku 5.5 writes the episode, and the browser's speech synthesis reads it.
- **Receive**: enter the same passphrase, press *Listen* (Chrome speech recognition), then *Decode*. Chrome returns little punctuation, so the receiver uses the model to restore sentence breaks, which means it needs an API key as well.
- **The episode**: My Weird Prompts #6141, *Overheard at the Laundrette*, the unkeyed original. Dorothy's line openers spell a hidden sentence.

Source, specification and a verified end-to-end run: https://github.com/danielrosehill/LLM-Spoken-Steganography
