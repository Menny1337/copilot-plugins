import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { deflateSync } from "node:zlib";
import { parseArgs, resolveSize, imagesEndpoint, decodeImages, resolveCredentials, imagemagickCmd, postWithRetry, main } from "./gpt-image.mjs";

const ENDPOINT = "https://example.services.ai.azure.com/openai/v1/images/generations";
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aV1sAAAAASUVORK5CYII=", "base64");
const JPEG = Buffer.from("/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AVN//2Q==", "base64");
const image = () => ({ b64_json: PNG.toString("base64") });

function isolatedEnvironment(t, values = {}) {
  for (const name of ["AZURE_OPENAI_IMAGE_KEY", "AZURE_OPENAI_IMAGE_ENDPOINT"]) {
    const previous = process.env[name];
    if (values[name] === undefined) delete process.env[name];
    else process.env[name] = values[name];
    t.after(() => {
      if (previous === undefined) delete process.env[name];
      else process.env[name] = previous;
    });
  }
}

function harness(t, overrides = {}) {
  const files = new Map();
  const calls = [];
  const stdout = [];
  const stderr = [];
  t.mock.method(console, "log", (value) => stdout.push(value));
  t.mock.method(console, "error", (value) => stderr.push(value));
  t.mock.method(fs, "mkdirSync", () => {});
  t.mock.method(fs, "statSync", () => ({ isFile: () => true }));
  t.mock.method(fs, "accessSync", () => {});
  t.mock.method(fs, "existsSync", (file) => files.has(file));
  t.mock.method(fs, "readFileSync", (file) => files.get(file) ?? PNG);
  t.mock.method(fs, "writeFileSync", (file, data) => files.set(file, Buffer.from(data)));
  t.mock.method(fs, "copyFileSync", (source, target) => {
    assert.ok(files.has(source), `Missing source ${source}`);
    files.set(target, files.get(source));
  });
  t.mock.method(fs, "renameSync", (source, target) => {
    assert.ok(files.has(source));
    files.set(target, files.get(source));
    files.delete(source);
  });
  t.mock.method(fs, "unlinkSync", (file) => files.delete(file));
  const dependencies = {
    getCredentials: () => ({ endpoint: ENDPOINT, key: "test-key", source: "test" }),
    findImageMagick: () => "magick",
    request: async (url, init) => {
      calls.push({ url, init });
      return { data: [image()] };
    },
    runImageMagick: (_command, args) => {
      if (args.includes("-format")) {
        const format = args[args.indexOf("-format") + 1];
        return Buffer.from(format.includes("minima.a") ? "512 512 0 1" : "512 512");
      }
      files.set(args.at(-1), PNG);
      return Buffer.alloc(0);
    },
    ...overrides,
  };
  return { files, calls, stdout, stderr, dependencies };
}

test("integer flags reject truncation, suffixes, negative and unsafe values", () => {
  for (const flag of ["-n", "-c", "--despill"]) {
    for (const value of ["1.9", "2junk", "-1", "", "9007199254740992"]) {
      assert.throws(() => parseArgs(["test", flag, value]), /must be an integer/);
    }
  }
  assert.equal(parseArgs(["test", "-n", "10"]).n, 10);
  assert.equal(parseArgs(["test", "--despill", "0"]).despill, 0);
});

test("fuzz validates and normalizes integer and decimal percentages", () => {
  for (const [value, expected] of [["16", "16%"], ["16.5", "16.5%"], ["0", "0%"], ["100%", "100%"]]) {
    assert.equal(parseArgs(["test", "--fuzz", value]).fuzz, expected);
  }
  for (const value of ["-1", "101", "junk", "16px", "1e2", "Infinity"]) {
    assert.throws(() => parseArgs(["test", "--fuzz", value]), /--fuzz/);
  }
});

test("size mapping retains default, aspect ratios, named and explicit sizes", () => {
  for (const [args, size] of [
    [[], "1024x1024"], [["-a", "16:9"], "1536x864"], [["-a", "21:9"], "1680x720"],
    [["-s", "2k"], "2560x1440"], [["-s", "1024"], "1024x1024"],
    [["-s", "1536x864"], "1536x864"], [["-s", "auto"], "auto"],
  ]) assert.equal(resolveSize(parseArgs(["test", ...args])), size);
  for (const args of [["-s", "513"], ["-s", "0"], ["-s", "4096x2048"], ["-s", "1024", "-a", "1:1"]]) {
    assert.throws(() => resolveSize(parseArgs(["test", ...args])));
  }
});

test("endpoint normalization handles bases, full URLs, edits and query parameters", () => {
  for (const input of [
    "https://example.services.ai.azure.com",
    "https://example.services.ai.azure.com/",
    "https://example.services.ai.azure.com/openai/v1/",
    ENDPOINT,
  ]) {
    assert.equal(imagesEndpoint(input), ENDPOINT);
    assert.equal(imagesEndpoint(input, true), ENDPOINT.replace("generations", "edits"));
  }
  const query = `${ENDPOINT}/?api-version=preview`;
  assert.equal(imagesEndpoint(query, true), `${ENDPOINT.replace("generations", "edits")}?api-version=preview`);
  assert.equal(imagesEndpoint(ENDPOINT.replace("generations", "edits")), ENDPOINT);
});

test("invalid or unsafe endpoint shapes are rejected", () => {
  for (const input of ["not-url", "http://example.com", "https://user:password@example.com", `${ENDPOINT}#fragment`, "https://example.com/random"]) {
    assert.throws(() => imagesEndpoint(input));
  }
});

test("responses require exact counts and every item to contain canonical image data", () => {
  assert.deepEqual(decodeImages({ data: [image()] }, 1, "png"), [PNG]);
  for (const data of [[], [image(), image()], [null], [{}], [{ b64_json: "!!!" }], [{ b64_json: "YQ==" }]]) {
    assert.throws(() => decodeImages({ data }, 1, "png"));
  }
  assert.throws(() => decodeImages({ data: [image(), {}] }, 2, "png"), /missing base64/);
  assert.throws(() => decodeImages({ data: [image()] }, 1, "jpeg"), /JPEG/);
  const truncated = PNG.subarray(0, -4).toString("base64");
  assert.throws(() => decodeImages({ data: [{ b64_json: truncated }] }, 1, "png"), /PNG/);
});

test("base64 validation accepts whitespace and remains stack-safe for a large valid PNG", () => {
  const wrapped = PNG.toString("base64").match(/.{1,20}/g).join("\n");
  assert.deepEqual(decodeImages({ data: [{ b64_json: wrapped }] }, 1, "png"), [PNG]);
  const table = Uint32Array.from({ length: 256 }, (_, value) => {
    for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    return value >>> 0;
  });
  const chunk = (name, data) => {
    const typeAndData = Buffer.concat([Buffer.from(name), data]);
    let crc = 0xffffffff;
    for (const byte of typeAndData) crc = table[(crc ^ byte) & 255] ^ (crc >>> 8);
    const out = Buffer.alloc(data.length + 12);
    out.writeUInt32BE(data.length);
    typeAndData.copy(out, 4);
    out.writeUInt32BE((crc ^ 0xffffffff) >>> 0, out.length - 4);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(2048, 0);
  header.writeUInt32BE(1536, 4);
  header[8] = 8;
  header[9] = 2;
  const large = Buffer.concat([
    PNG.subarray(0, 8), chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.alloc((2048 * 3 + 1) * 1536), { level: 0 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
  assert.ok(large.length > 9_000_000);
  assert.deepEqual(decodeImages({ data: [{ b64_json: large.toString("base64") }] }, 1, "png"), [large]);
});

test("dry-run can resolve an explicit endpoint with no API key", (t) => {
  isolatedEnvironment(t);
  t.mock.method(fs, "readFileSync", () => { throw Object.assign(new Error("missing"), { code: "ENOENT" }); });
  const credentials = resolveCredentials({ endpoint: ENDPOINT, dryRun: true });
  assert.equal(credentials.endpoint, ENDPOINT);
  assert.equal(credentials.key, undefined);
});

test("configuration read errors other than missing files are surfaced", (t) => {
  isolatedEnvironment(t);
  t.mock.method(fs, "readFileSync", () => { throw Object.assign(new Error("permission denied"), { code: "EACCES" }); });
  assert.throws(() => resolveCredentials({ dryRun: true }), /cannot read configuration/);
});

test("complete higher-priority configuration does not read fallback files", (t) => {
  isolatedEnvironment(t, { AZURE_OPENAI_IMAGE_KEY: "test-key" });
  t.mock.method(fs, "readFileSync", () => { throw new Error("fallback should not be consulted"); });
  assert.equal(resolveCredentials({ endpoint: ENDPOINT }).source, "$AZURE_OPENAI_IMAGE_KEY");
});

test("dry-run with an endpoint skips unneeded key lookups", (t) => {
  isolatedEnvironment(t);
  t.mock.method(fs, "readFileSync", () => { throw new Error("unnecessary credential read"); });
  assert.equal(resolveCredentials({ endpoint: ENDPOINT, dryRun: true }).key, undefined);
});

test("ImageMagick convert fallback requires standalone identify before generation", () => {
  const calls = [];
  assert.equal(imagemagickCmd((command) => {
    calls.push(command);
    if (command === "magick") throw new Error("missing");
  }), "convert");
  assert.deepEqual(calls, ["magick", "convert", "identify"]);
  assert.equal(imagemagickCmd((command) => {
    if (command !== "convert") throw new Error("missing");
  }), undefined);
});

test("main rejects invalid options before authentication or generation", async (t) => {
  let authenticated = false;
  const h = harness(t, { getCredentials: () => { authenticated = true; throw new Error("unexpected authentication"); } });
  for (const args of [
    ["-q", "bogus"], ["--resize", "0"], ["--resize", "64x0"], ["--resize", "0x64"],
    ["-o", "../escape"], ["-n", "0"], ["-n", "11"],
    ["-t", "-f", "jpeg", "-c", "85"], ["-c", "85"], ["--moderation", "invalid"],
  ]) await assert.rejects(main(["test", ...args], h.dependencies));
  await assert.rejects(main(["   "], h.dependencies), /non-empty prompt/);
  assert.equal(authenticated, false);
  assert.equal(h.calls.length, 0);
});

test("dry-run validates reference existence, type and readability", async (t) => {
  const h = harness(t);
  t.mock.method(fs, "statSync", () => { throw Object.assign(new Error("missing"), { code: "ENOENT" }); });
  await assert.rejects(main(["test", "-r", "missing.png", "--dry-run"], h.dependencies), /cannot read reference/);
  await assert.rejects(main(["test", "-r", "wrong.pdf", "--dry-run"], h.dependencies), /unsupported reference/);
  await assert.rejects(main(["test", "-r", "chart.svg", "--dry-run"], h.dependencies), /Render it to PNG/);
  assert.equal(h.calls.length, 0);
});

test("missing ImageMagick fails before any API call, including dry-run", async (t) => {
  const h = harness(t, { findImageMagick: () => undefined });
  for (const args of [["-t"], ["--resize", "128"], ["-t", "--dry-run"]]) {
    await assert.rejects(main(["test", ...args], h.dependencies), /ImageMagick.*no API call/);
  }
  assert.equal(h.calls.length, 0);
  assert.equal(h.files.size, 0);
});

test("dry-run writes no images, makes no requests, and never prints a key", async (t) => {
  const h = harness(t);
  await main(["test", "-a", "16:9", "--dry-run"], h.dependencies);
  const preview = JSON.parse(h.stdout[0]);
  assert.equal(preview.size, "1536x864");
  assert.equal(preview.keySource, "test");
  assert.ok(!h.stdout.join("").includes("test-key"));
  assert.equal(h.calls.length, 0);
  assert.equal(h.files.size, 0);
});

test("generation retains baseline payload defaults and writes valid images", async (t) => {
  const h = harness(t);
  await main(["test", "-a", "16:9", "-o", "hero", "-d", "/mock-output"], h.dependencies);
  assert.deepEqual(JSON.parse(h.calls[0].init.body), {
    model: "gpt-image-2", prompt: "test", n: 1, size: "1536x864", quality: "high", output_format: "png",
  });
  assert.equal(h.calls[0].url, ENDPOINT);
  assert.deepEqual(h.files.get("/mock-output/hero.png"), PNG);
  assert.deepEqual(h.stdout, ["/mock-output/hero.png"]);
});

test("multi-reference editing uses multipart and the edits operation", async (t) => {
  const h = harness(t);
  await main(["merge", "-r", "a.png", "-r", "b.webp"], h.dependencies);
  const { url, init } = h.calls[0];
  assert.equal(url, ENDPOINT.replace("generations", "edits"));
  assert.ok(init.body instanceof FormData);
  assert.equal(init.body.get("prompt"), "merge");
  assert.equal(init.body.getAll("image[]").length, 2);
  assert.equal(init.body.getAll("image[]")[1].type, "image/webp");
});

test("invalid or partial batch writes nothing and prints no success paths", async (t) => {
  const h = harness(t, { request: async () => ({ data: [image(), {}] }) });
  await assert.rejects(main(["test", "-n", "2"], h.dependencies), /missing base64/);
  assert.equal(h.files.size, 0);
  assert.deepEqual(h.stdout, []);
});

test("successful batches retain indexed output naming", async (t) => {
  const h = harness(t, { request: async () => ({ data: [image(), image()] }) });
  await main(["test", "-n", "2", "-d", "/mock-output", "-o", "variation"], h.dependencies);
  assert.deepEqual(h.stdout, ["/mock-output/variation-1.png", "/mock-output/variation-2.png"]);
});

test("transparent processing checks alpha and dimensions and preserves opaque backup", async (t) => {
  const h = harness(t);
  await main(["green robot", "-t", "--bg", "magenta", "--resize", "512x512", "-d", "/mock-output"], h.dependencies);
  const body = JSON.parse(h.calls[0].init.body);
  assert.match(body.prompt, /exactly #ff00ff/);
  assert.equal(body.output_format, "png");
  assert.deepEqual(h.files.get("/mock-output/gpt-image-opaque.png"), PNG);
  assert.ok(h.stderr.some((line) => line.includes("global key-out of #ff00ff (fuzz 16%, despill 1)")));
  assert.ok([...h.files.keys()].every((file) => !file.includes(".tmp")));
  assert.deepEqual(h.stdout, ["/mock-output/gpt-image.png"]);
});

test("failed processing keeps originals, removes temporary files and never reports success", async (t) => {
  const h = harness(t, { runImageMagick: () => { throw new Error("keying failed"); } });
  await assert.rejects(main(["test", "-t", "-d", "/mock-output"], h.dependencies), /keying failed.*original generated image kept/);
  assert.deepEqual(h.files.get("/mock-output/gpt-image.png"), PNG);
  assert.deepEqual(h.files.get("/mock-output/gpt-image-opaque.png"), PNG);
  assert.ok(h.stderr.some((line) => line.includes("global key-out of #00d800 (fuzz 16%, despill 1)")));
  assert.ok([...h.files.keys()].every((file) => !file.includes(".tmp")));
  assert.deepEqual(h.stdout, []);
});

test("opaque or fully erased alpha output fails without replacing the original", async (t) => {
  for (const alpha of ["1 1", "0 0"]) {
    await t.test(alpha, async (t) => {
      const h = harness(t);
      h.dependencies.runImageMagick = (_command, args) => {
        if (args[0] === "identify") return Buffer.from(`512 512 ${alpha}`);
        h.files.set(args.at(-1), PNG);
        return Buffer.alloc(0);
      };
      await assert.rejects(main(["test", "-t", "-d", "/mock-output"], h.dependencies), /opaque or fully empty/);
      assert.deepEqual(h.files.get("/mock-output/gpt-image.png"), PNG);
      assert.deepEqual(h.stdout, []);
    });
  }
});

test("resize dimensions are checked before replacing original", async (t) => {
  const h = harness(t);
  await assert.rejects(main(["test", "--resize", "128x128", "-d", "/mock-output"], h.dependencies), /requested --resize/);
  assert.deepEqual(h.files.get("/mock-output/gpt-image.png"), PNG);
  assert.deepEqual(h.stdout, []);
});

test("convert uses standalone identify and JPEG resize does not query alpha", async (t) => {
  const h = harness(t, {
    findImageMagick: () => "convert",
    request: async () => ({ data: [{ b64_json: JPEG.toString("base64") }] }),
  });
  const commands = [];
  h.dependencies.runImageMagick = (command, args) => {
    commands.push({ command, args });
    if (command === "identify") {
      assert.equal(args[0], "-format");
      assert.equal(args[1], "%w %h");
      return Buffer.from("128 128");
    }
    assert.equal(command, "convert");
    assert.notEqual(args[0], "identify");
    h.files.set(args.at(-1), JPEG);
    return Buffer.alloc(0);
  };
  await main(["test", "-f", "jpeg", "--resize", "128x128", "-d", "/mock-output"], h.dependencies);
  assert.equal(commands.length, 2);
  assert.deepEqual(h.stdout, ["/mock-output/gpt-image.jpg"]);
});

test("a batch failure preserves failed originals and backups but not already completed originals", async (t) => {
  const h = harness(t, { request: async () => ({ data: [image(), image()] }) });
  let completed = 0;
  h.dependencies.runImageMagick = (_command, args) => {
    if (args.includes("-format")) {
      completed++;
      if (completed === 2) throw new Error("second image processing failed");
      return Buffer.from("512 512 0 1");
    }
    h.files.set(args.at(-1), Buffer.from("processed"));
    return Buffer.alloc(0);
  };
  await assert.rejects(main(["test", "-n", "2", "-t", "-d", "/mock-output"], h.dependencies), /second image processing failed/);
  assert.equal(h.files.get("/mock-output/gpt-image-1.png").toString(), "processed");
  assert.deepEqual(h.files.get("/mock-output/gpt-image-2.png"), PNG);
  for (const index of [1, 2]) assert.deepEqual(h.files.get(`/mock-output/gpt-image-${index}-opaque.png`), PNG);
  assert.ok([...h.files.keys()].every((file) => !file.includes(".tmp")));
  assert.deepEqual(h.stdout, []);
});

test("body consumption stays under the request timeout", async () => {
  let bodyAborted = false;
  const fetchImpl = async (_url, { signal }) => ({
    ok: true, status: 200, headers: new Headers(),
    text: () => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => {
        bodyAborted = true;
        reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
      }, { once: true });
    }),
  });
  await assert.rejects(postWithRetry(ENDPOINT, {}, { fetchImpl, timeoutMs: 10, maxRetries: 0 }), /timed out after 1 attempts/);
  assert.equal(bodyAborted, true);
});

test("429 and 5xx retries consume bodies and preserve an exact attempt budget", async (t) => {
  t.mock.method(console, "error", () => {});
  let calls = 0;
  const delays = [];
  const fetchImpl = async () => {
    calls++;
    return calls === 1 ? new Response("busy", { status: 429, headers: { "retry-after": "0" } }) :
      new Response(JSON.stringify({ data: [image()] }), { status: 200 });
  };
  const result = await postWithRetry(ENDPOINT, {}, { fetchImpl, sleepImpl: async (delay) => delays.push(delay) });
  assert.equal(result.data.length, 1);
  assert.equal(calls, 2);
  assert.deepEqual(delays, [0]);
  calls = 0;
  await assert.rejects(postWithRetry(ENDPOINT, {}, {
    fetchImpl: async () => { calls++; return new Response("busy", { status: 503 }); },
    maxRetries: 2, sleepImpl: async () => {},
  }), /after 3 attempts \(2 retries\)/);
  assert.equal(calls, 3);
});

test("permanent errors and invalid successful JSON are not retried", async () => {
  for (const response of [new Response("bad key", { status: 401 }), new Response("not JSON", { status: 200 })]) {
    let calls = 0;
    await assert.rejects(postWithRetry(ENDPOINT, {}, {
      fetchImpl: async () => { calls++; return response; },
      sleepImpl: async () => { throw new Error("unexpected retry"); },
    }));
    assert.equal(calls, 1);
  }
});

test("excessive Retry-After exits rather than waiting indefinitely", async () => {
  await assert.rejects(postWithRetry(ENDPOINT, {}, {
    fetchImpl: async () => new Response("busy", { status: 429, headers: { "retry-after": "86400" } }),
    sleepImpl: async () => { throw new Error("unexpected wait"); },
  }), /retry wait budget/);
});
