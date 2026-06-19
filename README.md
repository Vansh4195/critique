# Critique

An AI code reviewer that runs entirely in your browser. Paste a code snippet, a
full file, or a unified diff — and Critique returns a structured review grouped
into **Correctness & Bugs**, **Security**, **Performance**, and **Readability &
Style**. Each finding shows a severity, the relevant line(s), a clear
explanation, and a concrete suggested fix.

It is a single static page. There is no backend: you bring your own API key
(Anthropic or OpenAI), it is stored in your browser's `localStorage`, and it is
sent only in the direct request to the provider you choose.

**Live:** https://vansh4195.github.io/critique/

## What it does

- **Code or diff input.** Switch between reviewing a plain code snippet/file and
  a unified diff. In diff mode the model focuses on the added/changed lines.
- **Structured findings.** Results are grouped by category and sorted by
  severity. Each finding is a collapsible card with a severity badge, line
  reference, explanation, and a suggested fix (including a corrected code snippet
  where useful).
- **GitHub PR diffs.** Paste a pull-request URL
  (`https://github.com/owner/repo/pull/123`) and Critique fetches the `.diff`
  directly from the GitHub API in the browser, then loads it into the editor.
- **Pick the model.** Anthropic (Opus 4.8 / Sonnet 4.6 / Haiku 4.5), OpenAI
  (GPT-4o / GPT-4o mini / GPT-4.1), or **Gemini (free)** (Gemini 2.0 Flash /
  2.5 Flash / 2.5 Pro) via Google's OpenAI-compatible API — a free way to try
  the tool.

## Bring your own key

Critique never ships an API key and never proxies your requests.

1. Click **API key** (top right).
2. Choose a provider, pick a model, and paste your key.
   - Anthropic keys: <https://console.anthropic.com/settings/keys>
   - OpenAI keys: <https://platform.openai.com/api-keys>
   - Gemini (free) keys: <https://aistudio.google.com/apikey>
3. Click **Save**. The key is written to `localStorage` under
   `critique.settings.v1` and used only for the direct `fetch()` to the
   provider's API. **Forget key** clears it.

The Anthropic request is made with the
`anthropic-dangerous-direct-browser-access: true` header, which the Anthropic
API requires for browser-originated calls. Each provider is asked to return a
JSON object matching a fixed review schema (Anthropic via `output_config.format`,
OpenAI/Gemini via `response_format` structured outputs).

The **Gemini (free)** provider talks to Google's OpenAI-compatible endpoint
(`https://generativelanguage.googleapis.com/v1beta/openai/chat/completions`)
using the exact same `chat/completions` request shape as the OpenAI provider —
only the base URL changes. That endpoint sends CORS headers, so it works
directly from the browser. The free tier is generous enough to try the tool at
no cost.

## Test for free with Gemini

You can prove the request/parse logic works against a real model for free,
without a browser, using Google Gemini:

1. Get a free API key at <https://aistudio.google.com/apikey>.
2. Run the end-to-end test:

   ```bash
   GEMINI_API_KEY=your_key node tests/e2e.mjs
   ```

It makes ONE tiny call (capped at 20 tokens, so it costs ~nothing on the free
tier) through the same OpenAI-compatible `chat/completions` shape the app uses,
pointed at Gemini, and asserts the response parses and contains non-empty text.
It prints `PASS` and exits `0` on success, `FAIL: <reason>` and exits non-zero
otherwise, or `SKIP` (exit `0`) if `GEMINI_API_KEY` is not set.

Because it is a Node script there is no browser and therefore no CORS issue, so
this is the reliable free path to validate the integration. (There is no
`package.json` / build step in this project; run the file directly with Node 18+
for built-in `fetch`.)

### A note on browser-side keys

Because the key is used directly from the page, it is held in the browser and
visible to anything running there. That is the right trade-off for a personal,
no-backend tool — use a key scoped to a low spending limit, and prefer this on
your own machine rather than a shared one. If you need to hand the tool to
others, put a small proxy in front of the provider so the key stays server-side.

## Run it locally

It is plain HTML/CSS/JS — no build step, no dependencies. Any static file
server works:

```bash
git clone https://github.com/Vansh4195/critique.git
cd critique
python3 -m http.server 8000
# open http://localhost:8000
```

You can also just open `index.html` directly, though serving over `http://`
avoids `file://` quirks with the GitHub fetch.

## Demo

1. Open the page and set an API key.
2. Click **Load sample** — it drops in a short JavaScript function with a few
   deliberate problems (SQL injection via string concatenation, an
   off-by-one loop bound, a loose `==` comparison).
3. Click **Review code**. You should see findings under Security, Correctness,
   and Readability, each with a fix.

## Project layout

```
index.html      markup, settings dialog, finding template
styles.css      styling (light/dark via prefers-color-scheme)
app.js          settings persistence, PR-diff fetch, provider calls, rendering
tests/e2e.mjs   free end-to-end test against Gemini (OpenAI-compatible call)
```

## License

MIT — see [LICENSE](LICENSE).
