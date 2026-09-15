import { exactPayload, requireInteger } from "../lib/control-payload.mjs";
import { aggregateResponse } from "../lib/control-observe.mjs";

export async function aggregateLoops(payload = {}, options = {}) {
  const body = exactPayload(payload ?? {}, { required: [], optional: ["count"] });
  const recentCount = body.count === undefined ? 10 : requireInteger(body.count, "payload.count", {
    minimum: 1,
    maximum: 50,
  });
  return await aggregateResponse({ env: options.env ?? process.env, recentCount });
}
