#!/usr/bin/env node
// gpt-image — zero-dependency wrapper around the Azure AI Foundry (Azure OpenAI)
// v1 images API for the gpt-image-2 deployment. Generates images from text and,
// with -r references, edits existing images. Writes decoded files to disk.
// gpt-image-2 is raster-only: references must be PNG/JPG/WebP. Render any SVG to
// PNG first (e.g. rsvg-convert) and verify the text before passing the PNG.
//
// Credentials (key) lookup order:
//   1. $AZURE_OPENAI_IMAGE_KEY
//   2. .env in the current working directory
//   3. ~/.gpt-image/.env
//   4. macOS Keychain (service "gpt-image", account = endpoint hostname)
// Endpoint is required: --endpoint, $AZURE_OPENAI_IMAGE_ENDPOINT, ./.env, or
//   ~/.gpt-image/.env, in that order. There is no built-in endpoint.

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";

const DEFAULT_DEPLOYMENT = "gpt-image-2";
const KEY_ENV = "AZURE_OPENAI_IMAGE_KEY";
const ENDPOINT_ENV = "AZURE_OPENAI_IMAGE_ENDPOINT";
const REQUEST_TIMEOUT_MS = 240_000; // gpt-image-2 latency is ~60-90s; be generous
const MAX_RETRIES = 6; // Retry 429 responses within a bounded attempt budget.

// gpt-image-2 has no native alpha/transparent output (the API returns HTTP 400
// "Transparent background is not supported for this model" — confirmed in the
// official docs). For -t we therefore generate on a flat, uniform background of
// a chosen key color and remove that color afterwards with ImageMagick. This is
// the documented "generate opaque + downstream background removal" workaround.
//
// CRITICAL: the key color must be ABSENT from the subject. Green is a great
// default for most UI assets, but a green subject (e.g. a green "running" status
// icon) needs --bg magenta/white, and a white/light subject needs the default
// green (white-keying would eat a white subject). There is no universal color —
// pick one your subject does not contain.
const NAMED_BG = {
  green: "#00d800",
  magenta: "#ff00ff",
  blue: "#0000ff",
  white: "#ffffff",
  black: "#000000",
  gray: "#808080",
};
const DEFAULT_BG = "green";

function resolveBg(name) {
  const k = String(name).toLowerCase();
  let hex = NAMED_BG[k];
  if (!hex) {
    if (/^#?[0-9a-f]{6}$/i.test(k)) hex = k.startsWith("#") ? k : `#${k}`;
    else
      fail(
        `--bg must be one of ${Object.keys(NAMED_BG).join("|")} or a #RRGGBB hex (got ${name})`
      );
  }
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  // Near-white / near-black backgrounds collide with anti-aliased edges under a
  // global color replace, so floodfill-from-corners is the safer auto method.
  const isExtreme = lum > 0.85 || lum < 0.12;
  return { name: k, hex, isExtreme };
}

function bgPromptSuffix(hex) {
  return (
    ` Render the subject fully isolated and centered with even padding on a ` +
    `perfectly flat, uniform, solid background of exactly ${hex}. No shadows, ` +
    `no gradients, no glow, no reflections, no floor, no vignette, and no ` +
    `background texture or objects. Do not use that exact background color ` +
    `anywhere on the subject itself, so the background can be removed cleanly.`
  );
}

function normalizeFuzz(v) {
  if (v === undefined) return undefined;
  return /^\d+$/.test(v) ? `${v}%` : v;
}

const HELP = `gpt-image — generate/edit images with gpt-image-2 (Azure AI Foundry)

Usage:
  node gpt-image.mjs "<prompt>" [options]
  node gpt-image.mjs "<edit prompt>" -r ./input.png [-r ./input2.png] [options]

Options:
  -o <name>        Output basename (default: gpt-image). Index appended when -n>1.
  -d <dir>         Output directory (default: ./gpt-image-out).
  -s <size>        Size: named (square|landscape|portrait|wide|tall|2k) OR a square
                   integer (e.g. 1024) OR explicit WxH (e.g. 1536x864) OR auto.
  -a <ratio>       Aspect ratio: 1:1|3:2|2:3|4:3|3:4|16:9|9:16|21:9 (mapped to a size).
  -q <quality>     Quality: low|medium|high|auto (default: high).
  -t               Transparent asset: generate on a flat key color + remove it
                   via ImageMagick (gpt-image-2 has no native alpha). Forces PNG.
  --bg <color>     Key/background color for -t: green|magenta|blue|white|black|gray
                   or #RRGGBB (default: green). Pick a color ABSENT from the subject
                   (green subject -> --bg magenta; white/light subject -> green).
  --key-method <m> Removal method: auto|global|floodfill (default: auto). global
                   removes the color everywhere; floodfill removes only the
                   connected background from the edges (preserves interior colors).
  --fuzz <pct>     Color match tolerance for keying (default: 16% global / 22% floodfill).
  --despill <n>    Erode the alpha edge by n px to kill fringe (default: 1 global / 0 floodfill).
  --resize <spec>  Post-process resize via high-quality Lanczos: N (fit longest side
                   to NxN) or WxH (fit inside + transparent-pad to exact WxH). Great
                   for crisp small icons: generate large, then downscale. Works with/without -t.
  -f <format>      Output format: png|jpeg (default: png). WebP is unsupported on Azure.
  -c <0-100>       JPEG compression level (only with -f jpeg).
  -n <count>       Number of images to generate, 1-10 (default: 1).
  -r <path>        Reference image to edit (repeatable; routes to images/edits).
                   PNG/JPG/WebP only. Render SVG to PNG first (e.g. rsvg-convert).
  --moderation <v> Moderation level: auto|low (default: model default).
  --endpoint <url> Set endpoint (otherwise use $${ENDPOINT_ENV} from env/.env).
  --deployment <n> Override deployment/model name (default: ${DEFAULT_DEPLOYMENT}).
  --model <name>   Alias for --deployment.
  --dry-run        Print the resolved request without calling the API.
  -h, --help       Show this help.

Size constraints (gpt-image-2): both edges multiples of 16, max edge <= 3840,
aspect ratio <= 3:1, total pixels between 655,360 and 8,294,400. >2560x1440 is
experimental. Output is always base64 PNG/JPEG (no URL).

Credentials: key from $${KEY_ENV}, ./.env, ~/.gpt-image/.env, or macOS Keychain.
Endpoint: --endpoint, $${ENDPOINT_ENV}, ./.env, then ~/.gpt-image/.env.
There is no built-in endpoint.
`;

function fail(msg, code = 1) {
  console.error(`gpt-image: ${msg}`);
  process.exit(code);
}

function parseArgs(argv) {
  const opts = {
    prompt: undefined,
    output: "gpt-image",
    dir: "./gpt-image-out",
    size: undefined,
    aspect: undefined,
    quality: "high",
    transparent: false,
    bg: DEFAULT_BG,
    keyMethod: "auto",
    fuzz: undefined,
    despill: undefined,
    resize: undefined,
    format: "png",
    compression: undefined,
    moderation: undefined,
    n: 1,
    refs: [],
    endpoint: undefined,
    deployment: undefined,
    dryRun: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) fail(`missing value for ${a}`);
      return v;
    };
    switch (a) {
      case "-h":
      case "--help":
        console.log(HELP);
        process.exit(0);
        break;
      case "-o": opts.output = next(); break;
      case "-d": opts.dir = next(); break;
      case "-s": opts.size = next(); break;
      case "-a": opts.aspect = next(); break;
      case "-q": opts.quality = next(); break;
      case "-t": opts.transparent = true; break;
      case "--bg": opts.bg = next(); break;
      case "--key-method": opts.keyMethod = next().toLowerCase(); break;
      case "--fuzz": opts.fuzz = normalizeFuzz(next()); break;
      case "--despill": opts.despill = parseInt(next(), 10); break;
      case "--resize": opts.resize = next().toLowerCase(); break;
      case "-f": opts.format = next().toLowerCase(); break;
      case "-c": opts.compression = parseInt(next(), 10); break;
      case "-n": opts.n = parseInt(next(), 10); break;
      case "-r": opts.refs.push(next()); break;
      case "--moderation": opts.moderation = next().toLowerCase(); break;
      case "--endpoint": opts.endpoint = next(); break;
      case "--deployment":
      case "--model": opts.deployment = next(); break;
      case "--dry-run": opts.dryRun = true; break;
      default:
        if (a.startsWith("-")) fail(`unknown flag: ${a} (see --help)`);
        if (opts.prompt === undefined) opts.prompt = a;
        else fail(`unexpected extra argument: ${a}`);
    }
  }
  return opts;
}

// Aspect ratios mapped to gpt-image-2-valid sizes (edges multiple of 16,
// aspect <= 3:1, pixels within 655,360..8,294,400).
const ASPECT_TO_SIZE = {
  "1:1": "1024x1024",
  "3:2": "1536x1024",
  "2:3": "1024x1536",
  "4:3": "1280x960",
  "3:4": "960x1280",
  "16:9": "1536x864",
  "9:16": "864x1536",
  "21:9": "1680x720",
};
// Named/shorthand sizes.
const NAMED_SIZE = {
  square: "1024x1024",
  landscape: "1536x1024",
  portrait: "1024x1536",
  wide: "1536x864", // true 16:9
  tall: "864x1536", // true 9:16
  "2k": "2560x1440", // experimental upper bound
  auto: "auto",
};

const MIN_PIXELS = 655_360;
const MAX_PIXELS = 8_294_400;
const MAX_EDGE = 3840;

function validateExplicitSize(size) {
  const m = /^(\d+)x(\d+)$/.exec(size);
  if (!m) return `not WxH: ${size}`;
  const w = parseInt(m[1], 10);
  const h = parseInt(m[2], 10);
  if (w % 16 !== 0 || h % 16 !== 0) return `${size}: both edges must be multiples of 16`;
  if (w > MAX_EDGE || h > MAX_EDGE) return `${size}: max edge is ${MAX_EDGE}px`;
  const ratio = Math.max(w, h) / Math.min(w, h);
  if (ratio > 3) return `${size}: aspect ratio must be <= 3:1`;
  const px = w * h;
  if (px < MIN_PIXELS) return `${size}: total pixels must be >= ${MIN_PIXELS}`;
  if (px > MAX_PIXELS) return `${size}: total pixels must be <= ${MAX_PIXELS}`;
  return undefined;
}

function resolveSize(opts) {
  if (opts.size && opts.aspect) {
    fail("use either -s or -a, not both");
  }
  let size;
  if (opts.size) {
    const key = opts.size.toLowerCase();
    if (NAMED_SIZE[key]) {
      size = NAMED_SIZE[key];
    } else if (/^\d+$/.test(opts.size)) {
      size = `${opts.size}x${opts.size}`; // square integer shorthand
    } else {
      size = opts.size;
    }
  } else if (opts.aspect) {
    size = ASPECT_TO_SIZE[opts.aspect];
    if (!size) {
      fail(`unsupported aspect ratio: ${opts.aspect}. Use ${Object.keys(ASPECT_TO_SIZE).join("|")}.`);
    }
  } else {
    size = "1024x1024";
  }
  if (size === "auto") return size;
  const err = validateExplicitSize(size);
  if (err) {
    fail(
      `invalid size — ${err}. Use a named size (${Object.keys(NAMED_SIZE).join("|")}), ` +
        `an aspect via -a (${Object.keys(ASPECT_TO_SIZE).join("|")}), a square integer, ` +
        `or explicit WxH (edges multiple of 16, <=${MAX_EDGE}px, aspect <=3:1, ` +
        `pixels ${MIN_PIXELS}-${MAX_PIXELS}).`
    );
  }
  return size;
}

function parseEnvFile(file) {
  const out = {};
  try {
    const text = fs.readFileSync(file, "utf8");
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq === -1) continue;
      const k = line.slice(0, eq).trim();
      let v = line.slice(eq + 1).trim();
      if (
        (v.startsWith('"') && v.endsWith('"')) ||
        (v.startsWith("'") && v.endsWith("'"))
      ) {
        v = v.slice(1, -1);
      }
      out[k] = v;
    }
  } catch {
    /* missing file is fine */
  }
  return out;
}

function endpointHost(endpoint) {
  try {
    return new URL(endpoint).host.toLowerCase();
  } catch {
    return endpoint;
  }
}

function keyFromKeychain(account) {
  if (process.platform !== "darwin") return undefined;
  try {
    const out = execFileSync(
      "security",
      ["find-generic-password", "-s", "gpt-image", "-a", account, "-w"],
      { stdio: ["ignore", "pipe", "ignore"] }
    );
    const k = out.toString("utf8").trim();
    return k || undefined;
  } catch {
    return undefined;
  }
}

function resolveCredentials(opts) {
  let endpoint = opts.endpoint || process.env[ENDPOINT_ENV];
  let key = process.env[KEY_ENV];
  let source = key ? `$${KEY_ENV}` : undefined;

  const cwdEnv = parseEnvFile(path.join(process.cwd(), ".env"));
  if (!endpoint && cwdEnv[ENDPOINT_ENV]) endpoint = cwdEnv[ENDPOINT_ENV];
  if (!key && cwdEnv[KEY_ENV]) {
    key = cwdEnv[KEY_ENV];
    source = "./.env";
  }

  const homeEnv = parseEnvFile(path.join(os.homedir(), ".gpt-image", ".env"));
  if (!endpoint && homeEnv[ENDPOINT_ENV]) endpoint = homeEnv[ENDPOINT_ENV];
  if (!key && homeEnv[KEY_ENV]) {
    key = homeEnv[KEY_ENV];
    source = "~/.gpt-image/.env";
  }

  if (!endpoint) {
    console.error(`Error: Missing endpoint. Pass --endpoint or set ${ENDPOINT_ENV}`);
    process.exit(1);
  }

  if (!key) {
    const fromKc = keyFromKeychain(endpointHost(endpoint));
    if (fromKc) {
      key = fromKc;
      source = "macOS Keychain (gpt-image)";
    }
  }

  if (!key) {
    console.error(`Error: Missing key. Set ${KEY_ENV} or store in Keychain for ${endpointHost(endpoint)}`);
    process.exit(1);
  }

  return { endpoint, key, source };
}

function editsEndpoint(generationsEndpoint) {
  return generationsEndpoint.replace(/\/images\/generations\/?$/, "/images/edits");
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function postWithRetry(url, init) {
  let attempt = 0;
  for (;;) {
    attempt++;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
    let res;
    try {
      res = await fetch(url, { ...init, signal: ctrl.signal });
    } catch (err) {
      clearTimeout(timer);
      const isTimeout = err.name === "AbortError";
      const label = isTimeout ? "request timed out" : `network error (${err.message})`;
      if (attempt > MAX_RETRIES) {
        fail(`${label} after ${MAX_RETRIES} attempts`);
      }
      const waitMs = Math.min(60_000, 2 ** attempt * 1000) + Math.floor(Math.random() * 1000);
      console.error(
        `gpt-image: ${label}. Waiting ${Math.round(waitMs / 1000)}s, retry ${attempt}/${MAX_RETRIES}...`
      );
      await sleep(waitMs);
      continue;
    }
    clearTimeout(timer);

    if (res.status === 429 || res.status >= 500) {
      if (attempt > MAX_RETRIES) {
        const body = await res.text().catch(() => "");
        fail(`API error ${res.status} after ${MAX_RETRIES} retries: ${body.slice(0, 500)}`);
      }
      const retryAfter = parseFloat(res.headers.get("retry-after") || "");
      const waitMs = Number.isFinite(retryAfter)
        ? retryAfter * 1000
        : Math.min(60_000, 2 ** attempt * 1000) + Math.floor(Math.random() * 1000);
      console.error(
        `gpt-image: HTTP ${res.status} (rate limit / transient). ` +
          `Waiting ${Math.round(waitMs / 1000)}s, retry ${attempt}/${MAX_RETRIES}...`
      );
      await sleep(waitMs);
      continue;
    }

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      fail(`API error ${res.status}: ${body.slice(0, 800)}`);
    }
    return res;
  }
}

function extFor(format) {
  if (format === "jpeg") return "jpg";
  return format;
}

function mimeForImage(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".png") return "image/png";
  fail(`unsupported reference image type: ${file} (use .png, .jpg, or .webp)`);
}

function imagemagickCmd() {
  for (const c of ["magick", "convert"]) {
    try {
      execFileSync(c, ["-version"], { stdio: "ignore" });
      return c;
    } catch {
      /* not available */
    }
  }
  return undefined;
}

// Remove the flat key-color background to produce real transparency. Keeps an
// opaque backup at <name>-opaque.<ext> so a bad key-out never loses the image.
//   - global:    -fuzz <f> -transparent <hex>  (removes the color everywhere)
//   - floodfill: alpha floodfill from a bordered corner seed (removes only the
//                connected background; preserves interior pixels of that color)
// Optional despill erodes the alpha edge by n px to kill the color fringe.
function keyOut(file, magick, { hex, method, fuzz, despill }) {
  const dir = path.dirname(file);
  const ext = path.extname(file);
  const base = path.basename(file, ext);
  const backup = path.join(dir, `${base}-opaque${ext}`);
  fs.copyFileSync(file, backup);
  let args;
  if (method === "floodfill") {
    args = [
      backup,
      "-alpha", "set",
      "-bordercolor", hex,
      "-border", "2",
      "-fuzz", fuzz,
      "-fill", "none",
      "-draw", "alpha 0,0 floodfill",
      "-shave", "2x2",
      "+repage",
    ];
  } else {
    args = [backup, "-fuzz", fuzz, "-transparent", hex];
  }
  if (despill > 0) {
    args.push("-channel", "A", "-morphology", "Erode", `Octagon:${despill}`, "+channel");
  }
  args.push(file);
  execFileSync(magick, args, { stdio: ["ignore", "ignore", "pipe"] });
  return backup;
}

// High-quality Lanczos resize. spec "N" fits the longest side to NxN (aspect
// preserved); spec "WxH" fits inside WxH then transparent-pads to exactly WxH.
function resizeImage(file, magick, spec) {
  let fit;
  let extent;
  if (/^\d+$/.test(spec)) {
    fit = `${spec}x${spec}`;
    extent = undefined;
  } else if (/^\d+x\d+$/.test(spec)) {
    fit = spec;
    extent = spec;
  } else {
    fail(`--resize must be N or WxH (got ${spec})`);
  }
  const args = [
    file,
    "-filter", "Lanczos",
    "-resize", fit,
    "-background", "none",
    "-gravity", "center",
  ];
  if (extent) args.push("-extent", extent);
  args.push(file);
  execFileSync(magick, args, { stdio: ["ignore", "ignore", "pipe"] });
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.prompt === undefined) fail("a prompt is required (see --help)");
  if (!Number.isInteger(opts.n) || opts.n < 1 || opts.n > 10) fail("-n must be an integer 1-10");
  if (opts.format === "webp") {
    fail("WebP output is not supported on Azure OpenAI; use -f png or -f jpeg.");
  }
  if (!["png", "jpeg"].includes(opts.format)) fail(`invalid -f format: ${opts.format} (png|jpeg)`);
  if (opts.compression !== undefined) {
    if (!Number.isInteger(opts.compression) || opts.compression < 0 || opts.compression > 100) {
      fail("-c compression must be an integer 0-100");
    }
    if (opts.format !== "jpeg") fail("-c compression only applies to -f jpeg");
  }
  if (opts.moderation !== undefined && !["auto", "low"].includes(opts.moderation)) {
    fail("--moderation must be auto or low");
  }
  if (!["auto", "global", "floodfill"].includes(opts.keyMethod)) {
    fail("--key-method must be auto, global, or floodfill");
  }
  if (opts.despill !== undefined && (!Number.isInteger(opts.despill) || opts.despill < 0)) {
    fail("--despill must be a non-negative integer");
  }
  if (opts.resize !== undefined && !/^\d+$/.test(opts.resize) && !/^\d+x\d+$/.test(opts.resize)) {
    fail(`--resize must be N or WxH (got ${opts.resize})`);
  }

  let format = opts.format;
  if (opts.transparent && format !== "png") {
    console.error("gpt-image: transparent output requires PNG; forcing -f png.");
    format = "png";
  }

  const size = resolveSize(opts);
  const deployment = opts.deployment || DEFAULT_DEPLOYMENT;
  const { endpoint, key, source } = resolveCredentials(opts);
  const isEdit = opts.refs.length > 0;
  const url = isEdit ? editsEndpoint(endpoint) : endpoint;

  // Resolve the transparency key strategy. gpt-image-2 cannot emit native alpha,
  // so -t generates on a flat key color and removes it with ImageMagick.
  const bg = resolveBg(opts.bg);
  const keyMethod =
    opts.keyMethod === "auto" ? (bg.isExtreme ? "floodfill" : "global") : opts.keyMethod;
  const fuzz = opts.fuzz || (keyMethod === "floodfill" ? "22%" : "16%");
  const despill = opts.despill ?? (keyMethod === "floodfill" ? 0 : 1);

  const svgRef = opts.refs.find((r) => path.extname(r).toLowerCase() === ".svg");
  if (svgRef) {
    const pngName = `${path.basename(svgRef, path.extname(svgRef))}.png`;
    fail(
      `reference ${svgRef} is an SVG, but gpt-image-2 only accepts raster images.\n` +
        `Render it to PNG first, verify the text rendered correctly, then pass the PNG:\n` +
        `  rsvg-convert -w 1920 -b white ${svgRef} -o ${pngName}\n` +
        `  open ${pngName}   # confirm every label and value is legible\n` +
        `  (fallbacks: inkscape / resvg / a headless Chromium screenshot; ` +
        `ImageMagick alone is unreliable for SVG text)\n` +
        `Then re-run with: -r ${pngName}`
    );
  }

  let magick;
  if (opts.transparent || opts.resize) {
    magick = imagemagickCmd();
    if (!magick) {
      const what = opts.transparent ? "transparency keying" : "resizing";
      console.error(
        `gpt-image: ${what} requested but ImageMagick (magick/convert) was not found. ` +
          (opts.transparent
            ? `The image will be generated on a flat ${bg.hex} background but NOT ` +
              `keyed to transparent. `
            : "") +
          "Install ImageMagick (brew install imagemagick) and re-run, or post-process manually."
      );
    }
  }
  const effectivePrompt = opts.transparent
    ? opts.prompt + bgPromptSuffix(bg.hex)
    : opts.prompt;

  const requestPreview = {
    mode: isEdit ? "edits" : "generations",
    url,
    deployment,
    prompt: effectivePrompt,
    size,
    quality: opts.quality,
    n: opts.n,
    output_format: format,
    transparent: opts.transparent
      ? magick
        ? `${keyMethod} key-out of ${bg.hex} (fuzz ${fuzz}, despill ${despill})`
        : "requested but ImageMagick missing"
      : false,
    resize: opts.resize
      ? magick
        ? `${opts.resize} (Lanczos)`
        : "requested but ImageMagick missing"
      : false,
    references: opts.refs,
    keySource: source || "(none found)",
  };

  if (opts.dryRun) {
    console.log(JSON.stringify(requestPreview, null, 2));
    return;
  }

  if (!key) {
    fail(
      `no API key found. Provide it via one of:\n` +
        `  - export ${KEY_ENV}=<key>\n` +
        `  - ./.env containing ${KEY_ENV}=<key>\n` +
        `  - ~/.gpt-image/.env containing ${KEY_ENV}=<key>\n` +
        `  - macOS Keychain: security add-generic-password -s gpt-image -a ${endpointHost(
          endpoint
        )} -w <key>`
    );
  }
  for (const r of opts.refs) {
    if (!fs.existsSync(r)) fail(`reference image not found: ${r}`);
  }

  let res;
  if (isEdit) {
    const form = new FormData();
    form.append("model", deployment);
    form.append("prompt", effectivePrompt);
    form.append("size", size);
    form.append("quality", opts.quality);
    form.append("n", String(opts.n));
    form.append("output_format", format);
    if (opts.compression !== undefined) form.append("output_compression", String(opts.compression));
    if (opts.moderation !== undefined) form.append("moderation", opts.moderation);
    for (const r of opts.refs) {
      const buf = fs.readFileSync(r);
      form.append("image[]", new Blob([buf], { type: mimeForImage(r) }), path.basename(r));
    }
    res = await postWithRetry(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      body: form,
    });
  } else {
    const payload = {
      model: deployment,
      prompt: effectivePrompt,
      n: opts.n,
      size,
      quality: opts.quality,
      output_format: format,
    };
    if (opts.compression !== undefined) payload.output_compression = opts.compression;
    if (opts.moderation !== undefined) payload.moderation = opts.moderation;
    res = await postWithRetry(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
  }

  const json = await res.json();
  const items = Array.isArray(json.data) ? json.data : [];
  if (items.length === 0) fail("API returned no image data");

  fs.mkdirSync(opts.dir, { recursive: true });
  const ext = extFor(format);
  const written = [];
  items.forEach((item, idx) => {
    if (!item.b64_json) return;
    const suffix = items.length > 1 ? `-${idx + 1}` : "";
    const file = path.resolve(opts.dir, `${opts.output}${suffix}.${ext}`);
    fs.writeFileSync(file, Buffer.from(item.b64_json, "base64"));
    written.push(file);
  });

  if (written.length === 0) fail("API response contained no decodable images");

  if ((opts.transparent || opts.resize) && magick) {
    for (const f of written) {
      try {
        if (opts.transparent) {
          const backup = keyOut(f, magick, { hex: bg.hex, method: keyMethod, fuzz, despill });
          console.error(
            `gpt-image: removed ${bg.hex} background via ${keyMethod} ` +
              `(fuzz ${fuzz}, despill ${despill}; opaque backup: ${backup})`
          );
        }
        if (opts.resize) {
          resizeImage(f, magick, opts.resize);
          console.error(`gpt-image: resized ${path.basename(f)} to ${opts.resize} (Lanczos).`);
        }
      } catch (err) {
        console.error(
          `gpt-image: post-processing failed for ${f} (${
            err?.message || err
          }); kept the generated image.`
        );
      }
    }
  }

  for (const f of written) console.log(f);
  if (json.usage) {
    console.error(`gpt-image: usage ${JSON.stringify(json.usage)}`);
  }
}

main().catch((err) => fail(err?.stack || String(err)));
