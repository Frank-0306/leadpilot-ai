import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import {
  dispatchPendingEvents,
  dispatchStatus,
  isAllowedBaseUrl,
  readDispatchConfig,
  webhookUrl,
  type DeliveryResult,
  type OutboxEvent,
  type OutboxStore,
} from "../src/lib/events/dispatcher";
import { verifySignature } from "../src/lib/events/signing";
import { bearerMatches } from "../src/lib/security/bearer";

const SECRET = "n8n-webhook-secret-for-tests-0123";

function memoryStore(events: OutboxEvent[]) {
  const completed: DeliveryResult[] = [];
  const store: OutboxStore = {
    async claim(limit) {
      return events.splice(0, limit);
    },
    async complete(r) {
      completed.push(r);
    },
  };
  return { store, completed };
}

const sample = (id: string): OutboxEvent => ({
  id,
  type: "lead.created",
  idempotency_key: `lead.created:${id}`,
  attempts: 1,
  payload: { event: "lead.created", occurred_at: "2026-11-21T00:00:00Z", data: { lead_id: id, full_name: "Nora Diaz" } },
  automation_key: "new_lead_follow_up",
  webhook_path: "leadpilot-new-lead",
});

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
test("config: nothing is sent until n8n is configured and dispatch is enabled", () => {
  assert.equal(dispatchStatus(readDispatchConfig({})), "not_configured");
  assert.equal(dispatchStatus(readDispatchConfig({ N8N_BASE_URL: "http://localhost:5678", N8N_WEBHOOK_SECRET: SECRET })), "disabled");
  assert.equal(
    dispatchStatus(readDispatchConfig({ N8N_BASE_URL: "http://n8n.example.com", N8N_WEBHOOK_SECRET: SECRET, EVENTS_DISPATCH_ENABLED: "true" })),
    "invalid_url",
  );
  assert.equal(
    dispatchStatus(readDispatchConfig({ N8N_BASE_URL: "http://localhost:5678/", N8N_WEBHOOK_SECRET: SECRET, EVENTS_DISPATCH_ENABLED: "true" })),
    "ready",
  );
});

test("config: webhook URLs for production and test mode", () => {
  const cfg = readDispatchConfig({ N8N_BASE_URL: "https://acme.app.n8n.cloud/", N8N_WEBHOOK_SECRET: SECRET });
  assert.equal(webhookUrl(cfg, "leadpilot-new-lead"), "https://acme.app.n8n.cloud/webhook/leadpilot-new-lead");
  assert.equal(webhookUrl({ ...cfg, mode: "test" }, "leadpilot-new-lead"), "https://acme.app.n8n.cloud/webhook-test/leadpilot-new-lead");
  assert.equal(isAllowedBaseUrl("http://127.0.0.1:5678"), true);
  assert.equal(isAllowedBaseUrl("javascript:alert(1)"), false);
});

test("disabled dispatch claims nothing", async () => {
  const { store, completed } = memoryStore([sample("a")]);
  const r = await dispatchPendingEvents(store, { enabled: false, baseUrl: null, secret: null });
  assert.equal(r.skipped, true);
  assert.equal(completed.length, 0);
});

// ---------------------------------------------------------------------------
// bearer auth used by the callback and cron endpoints
// ---------------------------------------------------------------------------
test("bearer auth: exact secret only, never with an empty or short secret", () => {
  assert.equal(bearerMatches(`Bearer ${SECRET}`, SECRET), true);
  assert.equal(bearerMatches(`Bearer ${SECRET}x`, SECRET), false);
  assert.equal(bearerMatches(SECRET, SECRET), false);
  assert.equal(bearerMatches(null, SECRET), false);
  assert.equal(bearerMatches("Bearer ", ""), false);
  assert.equal(bearerMatches("Bearer short", "short"), false);
});

// ---------------------------------------------------------------------------
// End to end over real HTTP against a stand-in for the n8n workflow. The fake
// workflow does what Workflow A does: check the Authorization header, call
// the LeadPilot callback (here: an idempotent in-memory version of
// automation_create_follow_up_task) and answer { ok: true, … }.
// ---------------------------------------------------------------------------
let server: Server;
let baseUrl = "";
const tasksByEvent = new Map<string, string>();
const received: { auth?: string; signatureOk: boolean; key?: string; body: Record<string, unknown> }[] = [];
let mode: "ok" | "error500" | "no-confirm" | "slow" = "ok";

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => resolve(data));
  });
}

before(async () => {
  server = createServer(async (req, res) => {
    const raw = await readBody(req);
    if (req.url !== "/webhook/leadpilot-new-lead") return res.writeHead(404).end();
    if (req.headers.authorization !== `Bearer ${SECRET}`) {
      res.writeHead(403, { "content-type": "application/json" });
      return res.end(JSON.stringify({ message: "Authorization data is wrong!" }));
    }
    const body = JSON.parse(raw) as Record<string, unknown>;
    received.push({
      auth: req.headers.authorization,
      signatureOk: verifySignature(raw, req.headers["x-leadpilot-signature"] as string, SECRET),
      key: req.headers["idempotency-key"] as string,
      body,
    });
    if (mode === "slow") await new Promise((r) => setTimeout(r, 400));
    if (mode === "error500") {
      res.writeHead(500, { "content-type": "application/json" });
      return res.end(JSON.stringify({ ok: false, error: "Callback to LeadPilot failed" }));
    }
    if (mode === "no-confirm") {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ message: "Workflow was started" }));
    }
    // callback: idempotent per event
    const eventId = String(body.event_id);
    const existing = tasksByEvent.get(eventId);
    const taskId = existing ?? `task-${tasksByEvent.size + 1}`;
    tasksByEvent.set(eventId, taskId);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, outcome: existing ? "duplicate" : "created", task_id: taskId, execution_id: 4242 }));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => server.close());

const cfg = () => ({ enabled: true, baseUrl, secret: SECRET });

test("e2e: event is delivered with auth, signature and idempotency key; task created", async () => {
  mode = "ok";
  const { store, completed } = memoryStore([sample("e1")]);
  const r = await dispatchPendingEvents(store, cfg());
  assert.deepEqual(r, { skipped: false, claimed: 1, delivered: 1, failed: 0 });
  const last = received.at(-1)!;
  assert.equal(last.signatureOk, true);
  assert.equal(last.key, "lead.created:e1");
  assert.equal(last.body.event_id, "e1");
  assert.equal(last.body.event, "lead.created");
  assert.equal(last.body.automation, "new_lead_follow_up");
  assert.equal(completed[0]!.executionId, "4242");
  assert.equal(completed[0]!.response?.outcome, "created");
});

test("e2e: the same event delivered twice creates one task", async () => {
  mode = "ok";
  const { store, completed } = memoryStore([sample("e1")]); // retry of e1
  await dispatchPendingEvents(store, cfg());
  assert.equal(completed[0]!.success, true);
  assert.equal(completed[0]!.response?.outcome, "duplicate");
  assert.equal([...tasksByEvent.keys()].filter((k) => k === "e1").length, 1);
  assert.equal(tasksByEvent.size, 1);
});

test("e2e: wrong webhook secret is rejected by the workflow and recorded as a failure", async () => {
  mode = "ok";
  const { store, completed } = memoryStore([sample("e2")]);
  const r = await dispatchPendingEvents(store, { ...cfg(), secret: "wrong-secret-0000000000000000000" });
  assert.equal(r.failed, 1);
  assert.equal(completed[0]!.status, 403);
  assert.match(completed[0]!.error!, /n8n responded 403/);
  assert.equal(tasksByEvent.has("e2"), false);
});

test("e2e: workflow errors and unconfirmed 200s are failures (retried later)", async () => {
  mode = "error500";
  let m = memoryStore([sample("e3")]);
  await dispatchPendingEvents(m.store, cfg());
  assert.match(m.completed[0]!.error!, /500: Callback to LeadPilot failed/);

  mode = "no-confirm";
  m = memoryStore([sample("e4")]);
  await dispatchPendingEvents(m.store, cfg());
  assert.equal(m.completed[0]!.success, false);
  assert.match(m.completed[0]!.error!, /without confirming/);
});

test("e2e: timeouts and unreachable n8n are recorded, never thrown", async () => {
  mode = "slow";
  let m = memoryStore([sample("e5")]);
  await dispatchPendingEvents(m.store, { ...cfg(), timeoutMs: 100 });
  assert.match(m.completed[0]!.error!, /timeout/);

  m = memoryStore([sample("e6")]);
  await dispatchPendingEvents(m.store, { ...cfg(), baseUrl: "http://127.0.0.1:1" });
  assert.equal(m.completed[0]!.success, false);
  assert.match(m.completed[0]!.error!, /Could not reach n8n|fetch failed/);
});
