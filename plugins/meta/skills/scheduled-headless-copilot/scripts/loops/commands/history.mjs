import { exactPayload, requireInteger, requireLoopIdValue } from "../lib/control-payload.mjs";
import { historyResponse } from "../lib/control-observe.mjs";

export async function loopHistory(payload = {}, options = {}) {
  const body = exactPayload(payload ?? {}, { required: [], optional: ["id", "count"] });
  const loopId = body.id === undefined ? null : requireLoopIdValue(body.id, "payload.id");
  const count = body.count === undefined ? 20 : requireInteger(body.count, "payload.count", {
    minimum: 1,
    maximum: 200,
  });
  return await historyResponse({ env: options.env ?? process.env, loopId, count });
}
