/*
 * Critique — free end-to-end test against Google Gemini.
 *
 * This is a Node script (no browser → no CORS), so it is the reliable free way
 * to prove the request/parse logic the app uses actually works against a real
 * model. It makes ONE tiny real LLM call through the SAME request shape the app
 * uses for its OpenAI-compatible providers (see callOpenAI in app.js):
 * a POST to /chat/completions with { model, messages, max_tokens } and a
 * Bearer Authorization header — but pointed at Gemini's OpenAI-compatible
 * endpoint so it costs ~nothing on the free tier.
 *
 * Usage:
 *   GEMINI_API_KEY=your_key node tests/e2e.mjs
 *
 * Get a free key at https://aistudio.google.com/apikey
 *
 * Exit codes: 0 = PASS (or SKIP when no key), 1 = FAIL.
 */

"use strict";

// Same OpenAI-compatible surface the app's OpenAI provider uses, just retargeted
// at Gemini's OpenAI-compatible base URL.
const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/openai";
const MODEL = "gemini-2.0-flash";

function fail(reason) {
  console.error(`FAIL: ${reason}`);
  process.exit(1);
}

async function main() {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    console.log(
      "SKIP: GEMINI_API_KEY is not set. Get a free key at https://aistudio.google.com/apikey " +
        "then run: GEMINI_API_KEY=your_key node tests/e2e.mjs"
    );
    process.exit(0);
  }

  let res;
  try {
    res = await fetch(`${GEMINI_BASE}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        // Same Authorization: Bearer <key> shape as the app's OpenAI provider.
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: MODEL,
        // Keep tokens tiny so this costs ~nothing on the free tier.
        max_tokens: 20,
        messages: [{ role: "user", content: "Reply with the single word: OK" }],
      }),
    });
  } catch (err) {
    fail(`network request failed: ${err && err.message ? err.message : String(err)}`);
    return;
  }

  // Parse exactly the way the app does for OpenAI-compatible responses.
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = (data && data.error && data.error.message) || `HTTP ${res.status}`;
    fail(`API error: ${msg}`);
    return;
  }
  if (!data) {
    fail("response did not parse as JSON");
    return;
  }

  const choice = data.choices && data.choices[0];
  const text = choice && choice.message && choice.message.content;
  if (!text || !String(text).trim()) {
    fail(`no non-empty text in response: ${JSON.stringify(data).slice(0, 300)}`);
    return;
  }

  console.log(`model replied: ${JSON.stringify(String(text).trim())}`);
  console.log("PASS");
  process.exit(0);
}

main();
