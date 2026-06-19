/*
 * Critique — client-side AI code reviewer.
 *
 * Everything runs in the browser. The user's API key lives in localStorage and
 * is sent only in the direct fetch() to the chosen provider's API. There is no
 * backend and nothing is logged.
 */

(() => {
  "use strict";

  const LS_KEY = "critique.settings.v1";

  // Provider/model catalog. Keep model ids exact.
  const PROVIDERS = {
    anthropic: {
      label: "Anthropic (Claude)",
      models: [
        { id: "claude-opus-4-8", label: "Claude Opus 4.8 (most capable)" },
        { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6 (balanced)" },
        { id: "claude-haiku-4-5", label: "Claude Haiku 4.5 (fast)" },
      ],
      keyHint:
        'Get a key at <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener">console.anthropic.com</a>. The call uses the browser-direct access header.',
    },
    openai: {
      label: "OpenAI",
      models: [
        { id: "gpt-4o", label: "GPT-4o" },
        { id: "gpt-4o-mini", label: "GPT-4o mini (fast)" },
        { id: "gpt-4.1", label: "GPT-4.1" },
      ],
      keyHint:
        'Get a key at <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener">platform.openai.com</a>.',
    },
  };

  const CATEGORIES = [
    { key: "correctness", label: "Correctness & Bugs" },
    { key: "security", label: "Security" },
    { key: "performance", label: "Performance" },
    { key: "readability", label: "Readability & Style" },
  ];

  const SEVERITY_ORDER = ["critical", "high", "medium", "low", "info"];

  // ---- DOM ----
  const $ = (sel) => document.querySelector(sel);
  const els = {
    form: $("#reviewForm"),
    inputMode: $("#inputMode"),
    language: $("#language"),
    prUrl: $("#prUrl"),
    fetchPrBtn: $("#fetchPrBtn"),
    codeInput: $("#codeInput"),
    status: $("#status"),
    reviewBtn: $("#reviewBtn"),
    sampleBtn: $("#sampleBtn"),
    clearBtn: $("#clearBtn"),
    results: $("#results"),
    settingsBtn: $("#settingsBtn"),
    keyDot: $("#keyDot"),
    dialog: $("#settingsDialog"),
    settingsForm: $("#settingsForm"),
    provider: $("#provider"),
    model: $("#model"),
    apiKey: $("#apiKey"),
    settingsHint: $("#settingsHint"),
    findingTemplate: $("#findingTemplate"),
  };

  // ---- Settings persistence ----
  function loadSettings() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return { provider: "anthropic", model: "claude-opus-4-8", key: "" };
      const s = JSON.parse(raw);
      if (!PROVIDERS[s.provider]) s.provider = "anthropic";
      return { provider: s.provider, model: s.model || "", key: s.key || "" };
    } catch {
      return { provider: "anthropic", model: "claude-opus-4-8", key: "" };
    }
  }

  function saveSettings(s) {
    localStorage.setItem(LS_KEY, JSON.stringify(s));
  }

  let settings = loadSettings();

  function refreshKeyIndicator() {
    const has = Boolean(settings.key);
    els.keyDot.classList.toggle("ok", has);
    els.settingsBtn.setAttribute(
      "title",
      has ? `Key set for ${PROVIDERS[settings.provider].label}` : "No API key set"
    );
  }

  // ---- Settings dialog wiring ----
  function populateModels(provider, selected) {
    const models = PROVIDERS[provider].models;
    els.model.innerHTML = "";
    for (const m of models) {
      const opt = document.createElement("option");
      opt.value = m.id;
      opt.textContent = m.label;
      els.model.appendChild(opt);
    }
    els.model.value = models.some((m) => m.id === selected) ? selected : models[0].id;
  }

  function openSettings() {
    els.provider.value = settings.provider;
    populateModels(settings.provider, settings.model);
    els.apiKey.value = settings.key;
    els.settingsHint.innerHTML = PROVIDERS[settings.provider].keyHint;
    els.dialog.showModal();
  }

  els.provider.addEventListener("change", () => {
    populateModels(els.provider.value, "");
    els.settingsHint.innerHTML = PROVIDERS[els.provider.value].keyHint;
  });

  els.settingsBtn.addEventListener("click", openSettings);

  els.settingsForm.addEventListener("submit", (e) => {
    const action = e.submitter && e.submitter.value;
    if (action === "save") {
      settings = {
        provider: els.provider.value,
        model: els.model.value,
        key: els.apiKey.value.trim(),
      };
      saveSettings(settings);
      refreshKeyIndicator();
      setStatus(settings.key ? "API key saved." : "Settings saved (no key set).");
    } else if (action === "forget") {
      settings = { ...settings, key: "" };
      saveSettings(settings);
      els.apiKey.value = "";
      refreshKeyIndicator();
      setStatus("API key forgotten.");
    }
    // "cancel" and dialog default close fall through with no change.
  });

  // ---- Status helpers ----
  function setStatus(msg, kind) {
    els.status.className = "status" + (kind ? " " + kind : "");
    els.status.textContent = msg || "";
  }

  // ---- GitHub PR diff fetch ----
  // Accepts URLs like https://github.com/owner/repo/pull/123
  function parsePrUrl(url) {
    const m = url
      .trim()
      .match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/i);
    if (!m) return null;
    return { owner: m[1], repo: m[2], number: m[3] };
  }

  async function fetchPrDiff() {
    const parsed = parsePrUrl(els.prUrl.value);
    if (!parsed) {
      setStatus("Enter a URL like https://github.com/owner/repo/pull/123", "error");
      return;
    }
    const api = `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/pulls/${parsed.number}`;
    els.fetchPrBtn.disabled = true;
    setStatus("Fetching PR diff from GitHub…", "working");
    try {
      const res = await fetch(api, {
        headers: { Accept: "application/vnd.github.v3.diff" },
      });
      if (res.status === 403) {
        throw new Error(
          "GitHub rate-limited this browser (60 requests/hour for anonymous access). Try again later or paste the diff manually."
        );
      }
      if (res.status === 404) {
        throw new Error("PR not found. Check the URL, or the repository may be private.");
      }
      if (!res.ok) {
        throw new Error(`GitHub returned HTTP ${res.status}.`);
      }
      const diff = await res.text();
      if (!diff.trim()) throw new Error("The PR diff came back empty.");
      els.codeInput.value = diff;
      els.inputMode.value = "diff";
      const lines = diff.split("\n").length;
      setStatus(`Loaded diff for ${parsed.owner}/${parsed.repo} #${parsed.number} (${lines} lines).`);
    } catch (err) {
      setStatus(err.message || "Failed to fetch the PR diff.", "error");
    } finally {
      els.fetchPrBtn.disabled = false;
    }
  }

  els.fetchPrBtn.addEventListener("click", fetchPrDiff);

  // ---- Prompt construction ----
  function buildPrompt(code, mode, language) {
    const langLine = language ? `Language: ${language}.` : "Language: detect it from the code.";
    const kind =
      mode === "diff"
        ? "a unified diff (lines starting with + are additions, - are removals). Focus your review on the added/changed lines, but use the surrounding context. When citing line numbers, use the new-file line numbers from the diff hunks where possible."
        : "a code snippet or file.";

    return [
      `Review the following ${kind}`,
      langLine,
      "",
      "Identify concrete issues and group each into exactly one category: correctness, security, performance, or readability.",
      "For each finding: assign a severity (critical, high, medium, low, or info), give a short title, point to the relevant line number(s), explain the problem clearly, and give a specific actionable suggestion (with a small corrected code snippet when it helps).",
      "Do not invent problems. If the code is solid in a category, return no findings for it. Be precise about line references.",
      "Also write a one or two sentence overall summary.",
      "",
      "=== CODE START ===",
      code,
      "=== CODE END ===",
    ].join("\n");
  }

  const SYSTEM_PROMPT =
    "You are a meticulous senior software engineer performing a code review. " +
    "You find real bugs, security vulnerabilities, performance problems, and readability issues. " +
    "You are precise, never vague, and you never fabricate issues. You always respond with the requested structured JSON only.";

  // JSON schema describing the structured review.
  const REVIEW_SCHEMA = {
    type: "object",
    additionalProperties: false,
    properties: {
      summary: { type: "string", description: "One or two sentence overall assessment." },
      findings: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            category: {
              type: "string",
              enum: ["correctness", "security", "performance", "readability"],
            },
            severity: {
              type: "string",
              enum: ["critical", "high", "medium", "low", "info"],
            },
            title: { type: "string" },
            lines: { type: "string", description: "Relevant line number(s), e.g. '12' or '20-24', or '' if not applicable." },
            detail: { type: "string", description: "Clear explanation of the problem." },
            suggestion: { type: "string", description: "Concrete actionable fix in prose." },
            suggestion_code: { type: "string", description: "A small corrected code snippet, or '' if not applicable." },
          },
          required: ["category", "severity", "title", "lines", "detail", "suggestion", "suggestion_code"],
        },
      },
    },
    required: ["summary", "findings"],
  };

  // ---- Provider calls (browser-direct) ----
  async function callAnthropic(code, mode, language) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": settings.key,
        "anthropic-version": "2023-06-01",
        // Required to call the Anthropic API directly from a browser.
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model: settings.model,
        max_tokens: 8000,
        system: SYSTEM_PROMPT,
        output_config: {
          format: { type: "json_schema", schema: REVIEW_SCHEMA },
        },
        messages: [{ role: "user", content: buildPrompt(code, mode, language) }],
      }),
    });

    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const msg = data?.error?.message || `HTTP ${res.status}`;
      throw new Error(`Anthropic API error: ${msg}`);
    }
    if (data.stop_reason === "refusal") {
      throw new Error("The model declined to review this input.");
    }
    const textBlock = (data.content || []).find((b) => b.type === "text");
    if (!textBlock) throw new Error("No text returned from the model.");
    return textBlock.text;
  }

  async function callOpenAI(code, mode, language) {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${settings.key}`,
      },
      body: JSON.stringify({
        model: settings.model,
        max_completion_tokens: 8000,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: buildPrompt(code, mode, language) },
        ],
        response_format: {
          type: "json_schema",
          json_schema: { name: "code_review", strict: true, schema: REVIEW_SCHEMA },
        },
      }),
    });

    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const msg = data?.error?.message || `HTTP ${res.status}`;
      throw new Error(`OpenAI API error: ${msg}`);
    }
    const choice = data.choices && data.choices[0];
    if (choice?.finish_reason === "content_filter") {
      throw new Error("The model declined to review this input (content filter).");
    }
    const text = choice?.message?.content;
    if (!text) throw new Error("No content returned from the model.");
    return text;
  }

  // Some models wrap JSON in prose or code fences despite instructions; recover gracefully.
  function parseReview(text) {
    let raw = text.trim();
    const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) raw = fence[1].trim();
    try {
      return JSON.parse(raw);
    } catch {
      const start = raw.indexOf("{");
      const end = raw.lastIndexOf("}");
      if (start !== -1 && end > start) {
        return JSON.parse(raw.slice(start, end + 1));
      }
      throw new Error("Could not parse the review as JSON. Try again or switch models.");
    }
  }

  // ---- Rendering ----
  function severityClass(sev) {
    return SEVERITY_ORDER.includes(sev) ? `sev-${sev}` : "sev-info";
  }

  function renderResults(review) {
    els.results.innerHTML = "";
    const findings = Array.isArray(review.findings) ? review.findings : [];

    // Summary card
    const card = document.createElement("div");
    card.className = "summary-card";
    const h2 = document.createElement("h2");
    h2.textContent = "Review summary";
    const p = document.createElement("p");
    p.textContent = review.summary || "Review complete.";
    card.append(h2, p);

    const meta = document.createElement("div");
    meta.className = "summary-meta";
    const total = document.createElement("span");
    total.className = "chip";
    total.innerHTML = `<strong>${findings.length}</strong> finding${findings.length === 1 ? "" : "s"}`;
    meta.appendChild(total);

    // Severity tallies
    const sevCounts = {};
    for (const f of findings) sevCounts[f.severity] = (sevCounts[f.severity] || 0) + 1;
    for (const sev of SEVERITY_ORDER) {
      if (!sevCounts[sev]) continue;
      const chip = document.createElement("span");
      chip.className = "chip";
      chip.innerHTML = `<strong>${sevCounts[sev]}</strong> ${sev}`;
      meta.appendChild(chip);
    }
    card.appendChild(meta);
    els.results.appendChild(card);

    if (findings.length === 0) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.innerHTML = "<strong>No issues found.</strong> The reviewer flagged nothing in this code.";
      els.results.appendChild(empty);
      return;
    }

    // Group by category, sorted by severity within each.
    for (const cat of CATEGORIES) {
      const group = findings
        .filter((f) => f.category === cat.key)
        .sort(
          (a, b) =>
            SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity)
        );
      if (group.length === 0) continue;

      const section = document.createElement("section");
      section.className = "cat-group";
      const head = document.createElement("h3");
      head.className = "cat-head";
      head.textContent = cat.label;
      const count = document.createElement("span");
      count.className = "cat-count";
      count.textContent = group.length;
      head.appendChild(count);
      section.appendChild(head);

      for (const f of group) section.appendChild(renderFinding(f));
      els.results.appendChild(section);
    }

    els.results.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function renderFinding(f) {
    const node = els.findingTemplate.content.cloneNode(true);
    const badge = node.querySelector(".sev-badge");
    badge.textContent = f.severity || "info";
    badge.classList.add(severityClass(f.severity));

    node.querySelector(".finding-title").textContent = f.title || "Untitled finding";

    const linesEl = node.querySelector(".finding-lines");
    linesEl.textContent = f.lines ? `line ${f.lines}` : "";

    node.querySelector(".finding-detail").textContent = f.detail || "";
    node.querySelector(".suggestion-text").textContent = f.suggestion || "";

    const codeEl = node.querySelector(".suggestion-code code");
    if (f.suggestion_code && f.suggestion_code.trim()) {
      codeEl.textContent = f.suggestion_code;
    } else {
      // Remove the empty <pre> so CSS :empty rules hide it cleanly.
      node.querySelector(".suggestion-code").remove();
    }
    return node;
  }

  // ---- Submit handler ----
  els.form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const code = els.codeInput.value.trim();
    if (!code) {
      setStatus("Paste some code or a diff first.", "error");
      els.codeInput.focus();
      return;
    }
    if (!settings.key) {
      setStatus("Add your API key first.", "error");
      openSettings();
      return;
    }

    els.reviewBtn.disabled = true;
    setStatus("");
    els.results.innerHTML =
      '<div class="empty-state"><span class="spinner" aria-hidden="true"></span>Reviewing with ' +
      escapeHtml(modelLabel()) +
      "…</div>";

    const mode = els.inputMode.value;
    const language = els.language.value;

    try {
      const text =
        settings.provider === "anthropic"
          ? await callAnthropic(code, mode, language)
          : await callOpenAI(code, mode, language);
      const review = parseReview(text);
      renderResults(review);
      setStatus("Review complete.");
    } catch (err) {
      els.results.innerHTML = "";
      const friendly = friendlyError(err);
      setStatus(friendly, "error");
    } finally {
      els.reviewBtn.disabled = false;
    }
  });

  function modelLabel() {
    const m = PROVIDERS[settings.provider].models.find((x) => x.id === settings.model);
    return m ? m.label : settings.model;
  }

  function friendlyError(err) {
    const msg = err && err.message ? err.message : String(err);
    if (/Failed to fetch|NetworkError|load failed/i.test(msg)) {
      return "Network request failed. Check your connection and that the API key/provider is correct.";
    }
    if (/401|invalid.*key|authentication/i.test(msg)) {
      return "Authentication failed — check your API key in settings.";
    }
    if (/429|rate.?limit/i.test(msg)) {
      return "Rate limited by the provider. Wait a moment and try again.";
    }
    return msg;
  }

  function escapeHtml(s) {
    return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }

  // ---- Sample / clear ----
  const SAMPLE = `function getUser(req, db) {
  // Build a SQL query from the request
  const id = req.query.id;
  const query = "SELECT * FROM users WHERE id = '" + id + "'";
  const rows = db.execSync(query);

  let result;
  for (var i = 0; i <= rows.length; i++) {
    if (rows[i].active == true) {
      result = rows[i];
    }
  }
  return result;
}`;

  els.sampleBtn.addEventListener("click", () => {
    els.codeInput.value = SAMPLE;
    els.inputMode.value = "code";
    els.language.value = "JavaScript";
    setStatus("Loaded a sample with a few deliberate issues.");
    els.codeInput.focus();
  });

  els.clearBtn.addEventListener("click", () => {
    els.codeInput.value = "";
    els.prUrl.value = "";
    els.results.innerHTML = "";
    setStatus("");
    els.codeInput.focus();
  });

  // ---- Init ----
  refreshKeyIndicator();
  if (!settings.key) {
    setStatus("Set your API key (top right) to get started.");
  }
})();
