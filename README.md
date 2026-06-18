# Quill

A real-time grammar and spelling checker Chrome extension. Underlines errors as you type in any text field across the web, with one-click fixes and a personal ignore list.

## Features

- **Inline underlines** — red for spelling, yellow for grammar, directly on the text
- **One-click fixes** — click any underlined word to see suggestions and apply them instantly
- **Ignore list** — dismiss false positives and they won't appear again
- **Two backends** — LanguageTool (free, no key needed) or Claude AI (requires Anthropic API key)
- **Multi-language** — English, Spanish, French, German, Portuguese, and more
- **Works everywhere** — textareas, text inputs, and contenteditable fields (Google Forms, Reddit, etc.)

## Installation

1. Clone or download this repo
2. Go to `chrome://extensions` in Chrome
3. Enable **Developer mode** (top-right toggle)
4. Click **Load unpacked** and select this folder

## Usage

Click the Quill icon in the toolbar to toggle the checker on/off, change language, or switch to Claude AI as the backend.

## Backends

| Provider | Cost | Setup |
|---|---|---|
| LanguageTool | Free (rate limited) | None |
| Claude AI | Pay-per-use | Anthropic API key in popup settings |
