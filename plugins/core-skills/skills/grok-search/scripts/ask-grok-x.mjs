#!/usr/bin/env node
// ask-grok-x.mjs — Ask Grok (inside X) a question using your logged-in X Premium
// session, capture the answer + citation links, print them, and append a dated history log.
//
// It's a general-purpose Grok search tool: pass ANY prompt. Examples (run from the
// skill directory):
//   node scripts/ask-grok-x.mjs "What was the most recent thing @Polymarket posted on X?"
//   node scripts/ask-grok-x.mjs "Summarize what @sama has tweeted this week with links"
//   node scripts/ask-grok-x.mjs --quiet "Sentiment on X about the Fed decision today?"
//   node scripts/ask-grok-x.mjs --surface=grok.com "Latest AI news with sources"
//   node scripts/ask-grok-x.mjs            # uses the default question below
//
// Flags:
//   --surface=x | grok.com   Which Grok to drive (default: x — uses your X Premium login)
//   --mode=auto|fast|expert  Grok response mode (both surfaces): Auto picks Fast/Expert,
//                            Fast = quick, Expert = thinks hard. Default: leave UI as-is.
//   --quiet, -q              Print ONLY the answer text (no preamble/citations). Still logs.
//   --headless               Drive a dedicated windowless session (no visible browser) seeded
//                            from exported auth. Requires a prior `--setup-auth` run.
//   --setup-auth             Export your logged-in state from the bridge Chrome into
//                            ~/grok-x-tool/.auth.json and seed the headless session, then exit.
//                            Re-run this if the headless session gets logged out.
//
// Requires: playwright-cli on PATH, the Playwright Bridge extension installed in Chrome,
// the bridge token at ~/.config/playwright-bridge/chrome.token, and you signed in to the
// chosen surface (x.com for --surface=x, grok.com for --surface=grok.com).
// For --headless: run `--setup-auth` once (with Chrome open & logged in) to seed the session.

import { execFileSync } from "node:child_process";
import { readFileSync, appendFileSync, existsSync, mkdirSync, chmodSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// Runtime data (login cookies + history) lives OUTSIDE the skill repo so secrets and
// logs are never committed. Created on demand so a fresh machine doesn't ENOENT.
const DATA_DIR = join(homedir(), "grok-x-tool");
const HISTORY_DIR = join(DATA_DIR, "history");
const TOKEN_FILE = join(homedir(), ".config", "playwright-bridge", "chrome.token");
const AUTH_FILE = join(DATA_DIR, ".auth.json"); // exported login state for headless
const HEADLESS_SESSION = "grokhl"; // dedicated persistent, windowless playwright session

const SURFACES = {
  x: {
    url: "https://x.com/i/grok",
    label: "X (your Premium login)",
    input: 'textarea[placeholder*="Ask"]',
    // the composer mode toggle reflects the current mode in its own aria-label
    modeToggleSel: '[aria-label="Auto"], [aria-label="Fast"], [aria-label="Expert"]',
    modes: ["auto", "fast", "expert"],
  },
  "grok.com": {
    url: "https://grok.com/",
    label: "grok.com",
    input: '[aria-label="Ask Grok anything"]',
    // grok.com's toggle is the "Model select" button (shows the current mode as its text).
    // (grok.com also lists "Heavy"/Team of Experts, but that needs a SuperGrok subscription
    // — omitted so we only offer modes that actually work on this account.)
    modeToggleSel: '[aria-label="Model select"]',
    modes: ["auto", "fast", "expert"],
  },
};

const DEFAULT_Q = "What was the most recent thing @Polymarket posted on X?";

// ---- arg parsing -----------------------------------------------------------
let surface = "x", quiet = false, mode = "", headless = false, setupAuth = false;
const words = [];
for (const a of process.argv.slice(2)) {
  if (a === "--quiet" || a === "-q") quiet = true;
  else if (a === "--headless") headless = true;
  else if (a === "--setup-auth") setupAuth = true;
  else if (a.startsWith("--surface=")) surface = a.slice("--surface=".length);
  else if (a.startsWith("--mode=")) mode = a.slice("--mode=".length);
  else words.push(a);
}
surface = surface.toLowerCase();
surface = (surface === "grok" || surface === "grok.com" || surface === "grokcom") ? "grok.com" : "x";
const SURF = SURFACES[surface];
// Drive either the user's real Chrome (bridge attach) or a dedicated windowless session.
const SESSION = (headless || setupAuth) ? HEADLESS_SESSION : "chrome";
// Grok response mode: Auto/Fast/Expert (works on both X and grok.com).
// "" = leave whatever's selected (don't touch the UI). Availability is per-surface (see SURFACES).
// (grok.com's "Heavy" tier is intentionally excluded — it needs a paid SuperGrok subscription.)
const MODE_LABELS = { auto: "Auto", fast: "Fast", expert: "Expert" };
mode = mode.toLowerCase();
const MODE = MODE_LABELS[mode] || ""; // canonical label or "" if unset/unknown
const question = words.join(" ").trim() || DEFAULT_Q;

// ---- helpers ---------------------------------------------------------------
function pwOn(session, args, { env } = {}) {
  return execFileSync("playwright-cli", [`--s=${session}`, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...(env || {}) },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function pw(args, opts = {}) {
  return pwOn(SESSION, args, opts);
}

// eval returning a JS value; --raw prints it as JSON which we parse.
function evalJS(fnSource) {
  const out = pw(["eval", fnSource, "--raw"]);
  return JSON.parse(out);
}

function sessionAlive(session) {
  try {
    pwOn(session, ["eval", "() => 1", "--raw"]);
    return true;
  } catch {
    return false;
  }
}

// Attach to the user's already-running Chrome via the Playwright Bridge extension.
function ensureAttached() {
  if (sessionAlive("chrome")) return; // already attached
  if (!existsSync(TOKEN_FILE)) {
    throw new Error(`Not attached and no bridge token at ${TOKEN_FILE}. ` +
      `Run: PLAYWRIGHT_MCP_EXTENSION_TOKEN=$(cat ${TOKEN_FILE}) playwright-cli attach --extension=chrome`);
  }
  const token = readFileSync(TOKEN_FILE, "utf8").trim();
  execFileSync("playwright-cli", ["attach", "--extension=chrome"], {
    encoding: "utf8",
    env: { ...process.env, PLAYWRIGHT_MCP_EXTENSION_TOKEN: token },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

// Bring up the dedicated windowless session, seeding it from exported auth on first launch.
function ensureHeadless() {
  const alive = sessionAlive(HEADLESS_SESSION);
  if (!alive) {
    // Fresh persistent session (headless is playwright-cli's default — no --headed).
    pwOn(HEADLESS_SESSION, ["open", "about:blank", "--persistent"]);
    if (existsSync(AUTH_FILE)) {
      pwOn(HEADLESS_SESSION, ["state-load", AUTH_FILE]);
    } else {
      throw new Error(`No saved auth at ${AUTH_FILE}. Run once with your logged-in Chrome open:\n` +
        `  node scripts/ask-grok-x.mjs --setup-auth`);
    }
  }
  // If we were logged out (cookies expired), the page will still render the login wall;
  // the caller's done-detection will time out and the user can re-run --setup-auth.
}

// Export login state from the user's real Chrome into AUTH_FILE and seed the headless session.
function setupAuthFlow() {
  ensureAttached(); // needs the real Chrome running & logged into X / grok.com
  mkdirSync(DATA_DIR, { recursive: true });
  pwOn("chrome", ["state-save", AUTH_FILE]);
  try { chmodSync(AUTH_FILE, 0o600); } catch {}
  if (!sessionAlive(HEADLESS_SESSION)) {
    pwOn(HEADLESS_SESSION, ["open", "about:blank", "--persistent"]);
  }
  pwOn(HEADLESS_SESSION, ["state-load", AUTH_FILE]);
  console.log(`✅ Auth exported to ${AUTH_FILE} and loaded into headless session "${HEADLESS_SESSION}".`);
  console.log(`   You can now run headless, e.g.:\n   node scripts/ask-grok-x.mjs --headless --surface=x --mode=fast "What's the latest from @NASA?"`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Signatures of an X/Grok error or interstitial page (not a real answer). These pages
// dump huge HTML/CSS/JSON blobs (e.g. window.__INITIAL_STATE__) — we must NOT log them.
const ERROR_PAGE_RE = /JavaScript is not available|Something went wrong, but don.?t fret|window\.__INITIAL_STATE__|class="errorContainer"|Some privacy related extensions may cause issues/i;

// Best-effort removal of consent/overlay nodes that intercept pointer events
// (grok.com ships a OneTrust cookie overlay that blocks native clicks). Harmless on X.
function removeOverlays() {
  try {
    evalJS(`() => {
      let n = 0;
      ["#onetrust-consent-sdk", ".onetrust-pc-dark-filter", "#onetrust-pc-sdk", "#onetrust-banner-sdk", "[id*=onetrust]", "[class*=onetrust]"]
        .forEach((s) => document.querySelectorAll(s).forEach((e) => { e.remove(); n++; }));
      return n;
    }`);
  } catch {}
}

// Read the currently-selected mode from the composer's mode/model toggle (its text).
function readMode() {
  try {
    return evalJS(`() => { const b = document.querySelector(${JSON.stringify(SURF.modeToggleSel)}); return b ? (b.innerText || "").trim().split("\\n")[0] : null; }`);
  } catch { return null; }
}

// Find the [ref=eNN] of the dropdown menu item whose label starts with `label`.
function menuItemRef(label) {
  let snap = "";
  try { snap = pw(["snapshot"]); } catch { return null; }
  const m = snap.match(new RegExp('menuitem(?:radio)? "' + label + '\\b[^"]*" \\[ref=(e\\d+)\\]', "i"));
  return m ? m[1] : null;
}

// Select a Grok response mode via the composer dropdown. Uses native pointer-event
// clicks (the dropdowns are radix popovers that ignore synthetic .click()). Works on
// both X and grok.com via the per-surface toggle selector. Returns the mode now selected.
async function setMode(label) {
  for (let i = 0; i < 3; i++) {
    if (readMode() === label) return label;
    try { pw(["click", SURF.modeToggleSel]); } catch {}
    await sleep(700);
    const ref = menuItemRef(label);
    if (ref) { try { pw(["click", ref]); } catch {} }
    await sleep(500);
  }
  return readMode();
}

// Read the current Grok conversation: clean answer text (UI buttons/chips stripped,
// @handle mentions padded so they don't glue to following words), cited /status/ links,
// a "busy" flag from live progress captions, and a "done" flag — the answer toolbar
// (Regenerate / Copy text / Like / Dislike) only renders once generation has finished,
// which is the fastest reliable completion signal.
const EXTRACT_FN = `() => {
  const main = document.querySelector("main") || document.body;
  const live = main.innerText || "";
  const busy = /Thinking|Searching|Reading|Browsing|Analyzing|Looking through|Generating|Working on|Reasoning|Streaming/i.test(live);
  const labels = [...main.querySelectorAll("button")].map((b) => (b.getAttribute("aria-label") || b.getAttribute("data-testid") || b.title || "").trim());
  const done = labels.filter((x) => /^(Regenerate|Copy text|Like|Dislike)$/i.test(x)).length >= 2;
  const clone = main.cloneNode(true);
  // pad inline @handle mentions so innerText doesn't fuse them to neighbouring text
  clone.querySelectorAll("a,span").forEach((el) => {
    const t = (el.textContent || "").trim();
    if (/^@[A-Za-z0-9_]{1,30}$/.test(t)) el.textContent = " " + t + " ";
  });
  clone.querySelectorAll('button,[role="button"]').forEach((b) => b.remove());
  // strip Grok's trailing follow-up suggestion chips (plain spans/divs with no role —
  // e.g. "Think Harder", "DeepSearch") that get appended after the answer text.
  const CHIPS = ["Think Harder", "DeepSearch", "Deep Search", "Edit Image", "Create Images", "Get notified when Grok finishes answering"];
  clone.querySelectorAll("a,span,div").forEach((el) => {
    const t = (el.textContent || "").trim();
    if (CHIPS.some((c) => c.toLowerCase() === t.toLowerCase())) el.remove();
  });
  const raw = (clone.innerText || "").trim();
  const citations = [...new Set([...main.querySelectorAll('a[href*="/status/"]')].map((a) => a.href))];
  return { raw, citations, busy, done, len: raw.length };
}`;

// URL-safe whitespace cleanup: fixes run-on joins (sentence/colon/comma/paren glue)
// caused by innerText concatenation, WITHOUT touching URLs, domains, times, or numbers.
function fixSpacing(s) {
  const slots = [];
  const stash = (m) => { slots.push(m); return "\uE000" + (slots.length - 1) + "\uE001"; };
  // 1) protect full http(s) URLs (keep any trailing sentence punctuation outside)
  s = s.replace(/https?:\/\/[^\s()]+/gi, (m) => {
    const mt = m.match(/[.,;:!?]+$/); let tail = "";
    if (mt) { tail = mt[0]; m = m.slice(0, -tail.length); }
    return stash(m) + tail;
  });
  // 2) protect bare domains / paths with known TLDs (grok.com, science.nasa.gov/...)
  s = s.replace(/\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|org|net|io|gov|co|ai|app|news|tv|me|xyz|edu|info)\b(?:\/[^\s()]*)?/gi, stash);
  // --- spacing fixes (protected tokens are now safe) ---
  s = s.replace(/([.!?;])([A-Za-z])/g, "$1 $2");      // outbreak.It -> outbreak. It
  s = s.replace(/,([A-Za-z])/g, ", $1");               // word,word -> word, word (keeps 1,000)
  s = s.replace(/([A-Za-z]):(?=[A-Z])/g, "$1: ");      // is:JUST -> is: JUST (keeps 14:45)
  s = s.replace(/([:;,.!?])(?=["“][A-Za-z])/g, "$1 "); // now):"I -> now): "I (open quote after punctuation)
  s = s.replace(/(”)(?=[A-Za-z])/g, "$1 ");            // closing curly DOUBLE quote glued to a word
  s = s.replace(/(’)(?=[A-Z])/g, "$1 ");               // closing curly SINGLE quote before a capital (keeps didn’t)
  s = s.replace(/([a-z])(["'])(?=[A-Z])/g, "$1$2 ");   // upside"Posted -> upside" Posted (keeps it's, O'Brien)
  s = s.replace(/([)\w\uE001”’"'])\(/g, "$1 (");      // 841(The / more.”(Posted -> add space before (
  s = s.replace(/\)(?=[A-Za-z“"'])/g, ") ");           // far.)This -> far.) This (space after closing paren)
  s = s.replace(/[^\S\r\n]{2,}/g, " ");             // collapse space runs (never newlines)
  // restore protected tokens
  s = s.replace(/\uE000(\d+)\uE001/g, (_, i) => slots[+i]);
  return s.trim();
}

function cleanAnswer(raw, q) {
  let s = raw.trim();
  // strip leading UI chrome lines that precede the answer (X: "See new posts";
  // grok.com: "Share" above the conversation), so the echoed prompt sits at the front.
  s = s.replace(/^(?:\s*(?:See new posts|Share)\s*)+/i, "");
  const qt = q.trim();
  // Grok echoes the prompt at the top. Mention padding can insert/move spaces inside it
  // (e.g. "(@elonmusk)" -> "( @elonmusk )"), so compare ignoring ALL whitespace: walk the
  // leading non-space chars of s and, if they reproduce the prompt, slice them off.
  const target = qt.replace(/\s+/g, "").toLowerCase();
  let acc = "", cut = -1;
  for (let i = 0; i < s.length; i++) {
    if (/\s/.test(s[i])) continue;
    acc += s[i].toLowerCase();
    if (!target.startsWith(acc)) break;        // not the echoed prompt — bail
    if (acc.length === target.length) { cut = i + 1; break; }
  }
  if (cut !== -1) s = s.slice(cut);
  // grok.com leaves a "Thought for 2s" (or "Thought for a few seconds") reasoning caption
  // between the echoed prompt and the answer — drop it.
  s = s.replace(/^\s*Thought for [^\n]*\n+/i, "");
  s = s.replace(/\n{3,}/g, "\n\n").trim();
  return fixSpacing(s);
}

// ---- main ------------------------------------------------------------------
(async () => {
  if (setupAuth) { setupAuthFlow(); return; }
  if (!quiet) console.log(`\n❓ Question: ${question}\n🌐 Surface: ${SURF.label}${headless ? " (headless)" : ""}\n⏳ Asking Grok...`);
  if (headless) ensureHeadless();
  else ensureAttached();

  // fresh conversation
  pw(["goto", SURF.url]);
  // X is a heavy SPA — give React time to hydrate the composer before submitting,
  // otherwise the Enter submit silently no-ops and no question is ever asked.
  await sleep(2000);
  if (surface === "grok.com") removeOverlays(); // clear the consent overlay so clicks land

  // X intermittently serves a bot-detection "JavaScript is not available" error page
  // (more likely in headless contexts). It has no composer, so detect it and bail fast
  // instead of stacking ~5 minutes of auto-wait timeouts on the missing UI.
  const blocked = evalJS(`() => {
    const txt = (document.body && document.body.innerText || "").slice(0, 1000)
      + " " + (document.body && document.body.innerHTML || "").slice(0, 2000);
    return ${ERROR_PAGE_RE.toString()}.test(txt);
  }`);
  if (blocked) {
    throw new Error(`${surface} served a bot-detection/error page (no composer). ` +
      "Do NOT retry in a loop — that prolongs it. Wait a few minutes and try a single query, " +
      "or switch to --surface=grok.com.");
  }

  // select response mode if requested (availability is per-surface)
  let selectedMode = "";
  if (MODE) {
    if (!SURF.modes.includes(mode)) {
      if (!quiet) console.log(`⚠️  Mode "${mode}" isn't available on ${surface} (options: ${SURF.modes.join(", ")}). Leaving current mode.`);
    } else {
      selectedMode = await setMode(MODE);
      if (!quiet) console.log(`⚙️  Mode: ${selectedMode || "(unchanged)"}${selectedMode && selectedMode !== MODE ? ` (wanted ${MODE})` : ""}`);
    }
  }

  // type + submit
  pw(["fill", SURF.input, question, "--submit"]);

  // Poll fast. Primary signal: the answer toolbar (Regenerate/Copy text/Like/Dislike)
  // appears only when generation has finished. Fallback (e.g. surfaces without that
  // toolbar): progress captions gone AND text length settled across two reads.
  // Each eval already costs ~1s (playwright-cli latency), so keep the explicit sleep short.
  const baseline = question.length;
  let last = -1, stable = 0, resubmitted = false;
  let snap = { raw: "", citations: [], busy: true, done: false, len: 0 };
  const start = Date.now();
  const deadline = start + 150_000;
  while (Date.now() < deadline) {
    await sleep(500);
    try { snap = evalJS(EXTRACT_FN); } catch { continue; }
    const hasAnswer = snap.len > baseline + 40;
    if (hasAnswer && snap.done) break;                       // fast path — answer finished
    if (hasAnswer && !snap.busy && snap.len === last) {       // fallback stability path
      if (++stable >= 3) break;
    } else {
      stable = 0;
    }
    last = snap.len;
    // Guard: if ~7s in nothing is generating (no busy caption, no growth), the submit
    // didn't register (SPA hadn't hydrated) — re-submit once.
    if (!resubmitted && !snap.busy && !hasAnswer && Date.now() - start > 7000) {
      resubmitted = true;
      try { pw(["fill", SURF.input, question, "--submit"]); } catch {}
    }
    // Stall guard: if after a re-submit there's still no answer and nothing generating
    // (e.g. a paywall/upsell modal swallowed the prompt), bail in ~25s instead of 150s.
    if (resubmitted && !snap.busy && !hasAnswer && Date.now() - start > 25000) break;
  }

  // If the captured content is an X/Grok error page (can appear mid-generation), don't
  // run it through cleanAnswer or dump its HTML/CSS/JSON blob into the log.
  const errored = ERROR_PAGE_RE.test(snap.raw);
  const answer = errored
    ? "(X/Grok returned an error page — please try again)"
    : cleanAnswer(snap.raw, question);
  const citations = errored ? [] : snap.citations;
  // Bound the raw section so an unexpected blob can never bloat the log again.
  const rawForLog = errored
    ? "(error page suppressed)"
    : (snap.raw.length > 4000 ? snap.raw.slice(0, 4000) + "\n…(truncated)" : snap.raw);

  // ---- output ----
  if (quiet) {
    console.log(answer || "");
  } else {
    console.log("\n💬 Grok's answer:\n" + (answer || "(no answer captured)"));
    if (citations.length) {
      console.log("\n🔗 Cited posts:");
      for (const c of citations) console.log("  - " + c);
    } else {
      console.log("\n🔗 Cited posts: (none returned)");
    }
  }

  // ---- dated history (always) ----
  const now = new Date();
  const day = now.toISOString().slice(0, 10);            // YYYY-MM-DD
  mkdirSync(HISTORY_DIR, { recursive: true });           // create on demand (fresh machine)
  const file = join(HISTORY_DIR, `grok-${day}.log`);
  const entry =
    `\n========== ${now.toISOString()} ==========\n` +
    `Surface: ${surface}\n` +
    `Mode: ${selectedMode || "(default)"}\n` +
    `Q: ${question}\n\n` +
    `A: ${answer || "(no answer captured)"}\n\n` +
    `Citations:\n${citations.length ? citations.map((c) => "  - " + c).join("\n") : "  (none)"}\n` +
    `\n--- raw ---\n${rawForLog}\n`;
  appendFileSync(file, entry, "utf8");
  // also keep a machine-readable JSONL master log
  appendFileSync(
    join(HISTORY_DIR, "history.jsonl"),
    JSON.stringify({ ts: now.toISOString(), surface, mode: selectedMode || null, question, answer, citations }) + "\n",
    "utf8"
  );
  if (!quiet) console.log(`\n📝 Saved to ${file}`);
})().catch((e) => {
  console.error("ERROR:", e.message);
  process.exit(1);
});
