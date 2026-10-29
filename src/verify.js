import { randomBytes } from "node:crypto";

export const DEFAULT_ENDPOINT = "http://localhost:4318";

/** Sends one OTLP/HTTP JSON span; resolves {ok, status}. The key is only ever placed in the Authorization header. */
export async function sendTestEvent({ endpoint = DEFAULT_ENDPOINT, key, service = "wizard-verify", fetchImpl = fetch }) {
  const now = BigInt(Date.now()) * 1000000n;
  const body = {
    resourceSpans: [{
      resource: { attributes: [{ key: "service.name", value: { stringValue: service } }] },
      scopeSpans: [{
        scope: { name: "watchtower.wizard" },
        spans: [{
          traceId: randomBytes(16).toString("hex"), spanId: randomBytes(8).toString("hex"),
          name: "wizard.verify", kind: 1, startTimeUnixNano: String(now), endTimeUnixNano: String(now + 1000000n),
        }],
      }],
    }],
  };
  try {
    const r = await fetchImpl(`${endpoint.replace(/\/$/, "")}/v1/traces`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
    });
    return { ok: r.ok, status: r.status };
  } catch (e) {
    return { ok: false, status: 0, error: String(e?.message ?? e).replaceAll(key, "***") };
  }
}
