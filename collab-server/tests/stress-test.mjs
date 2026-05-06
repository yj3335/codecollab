/**
 * Week 3 Stress Test: 4 clients, 200 rapid edits each, verify no divergence.
 *
 * Usage:
 *   node tests/stress-test.mjs [alb-url]
 *
 * Default ALB: codecollab-alb-1985506064.us-east-1.elb.amazonaws.com
 */

import { createRequire } from "module";
const require = createRequire(import.meta.url);
const Y = require("yjs");
const syncProtocol = require("y-protocols/dist/sync.cjs");
const encoding = require("lib0/dist/encoding.cjs");
const decoding = require("lib0/dist/decoding.cjs");
const WebSocket = require("ws");

const ALB_HOST = process.argv[2] || "codecollab-alb-1985506064.us-east-1.elb.amazonaws.com";
const API_URL = `http://${ALB_HOST}`;
const WS_URL = `ws://${ALB_HOST}`;

const NUM_CLIENTS = 4;
const EDITS_PER_CLIENT = 200;

let passed = 0;
let failed = 0;

function assert(name, condition) {
  if (condition) { console.log("  ✅ " + name); passed++; }
  else { console.log("  ❌ " + name); failed++; }
}

function createClient(sessionId, clientId) {
  return new Promise((resolve, reject) => {
    const doc = new Y.Doc();
    const ws = new WebSocket(`${WS_URL}/ws/${sessionId}`);
    ws.binaryType = "arraybuffer";

    const timeout = setTimeout(() => reject(new Error(`Client ${clientId} connection timeout`)), 15000);

    ws.on("open", () => {
      clearTimeout(timeout);
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, 0);
      syncProtocol.writeSyncStep1(enc, doc);
      ws.send(encoding.toUint8Array(enc));
    });

    ws.on("message", (data) => {
      const buf = new Uint8Array(data);
      const decoder = decoding.createDecoder(buf);
      const messageType = decoding.readVarUint(decoder);
      if (messageType === 0) {
        const enc = encoding.createEncoder();
        encoding.writeVarUint(enc, 0);
        syncProtocol.readSyncMessage(decoder, enc, doc, ws);
        if (encoding.length(enc) > 1) ws.send(encoding.toUint8Array(enc));
      }
    });

    doc.on("update", (update, origin) => {
      if (origin !== ws && ws.readyState === WebSocket.OPEN) {
        const enc = encoding.createEncoder();
        encoding.writeVarUint(enc, 0);
        syncProtocol.writeUpdate(enc, update);
        ws.send(encoding.toUint8Array(enc));
      }
    });

    ws.on("error", (err) => { clearTimeout(timeout); reject(err); });
    resolve({ doc, ws, clientId });
  });
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  // --- Create session ---
  console.log("\n=== Stress Test: 4 Clients × 200 Edits ===\n");
  console.log(`Target: ${ALB_HOST}`);
  console.log(`Clients: ${NUM_CLIENTS}, Edits per client: ${EDITS_PER_CLIENT}`);
  console.log(`Expected total characters: ${NUM_CLIENTS * EDITS_PER_CLIENT}\n`);

  const res = await fetch(`${API_URL}/api/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "stress-test", language: "python", ownerId: "stress-tester" }),
  });
  const json = await res.json();
  assert("Session created", res.status === 201);
  const SESSION = json.data.sessionId;
  console.log(`  Session: ${SESSION}\n`);

  // --- Connect 4 clients ---
  console.log("--- Connecting clients ---");
  const clients = [];
  for (let i = 0; i < NUM_CLIENTS; i++) {
    const client = await createClient(SESSION, i);
    clients.push(client);
    console.log(`  Client ${i} connected`);
    await wait(500); // stagger connections so ALB distributes across tasks
  }
  await wait(2000); // let all sync step 1/2 complete

  // --- Rapid concurrent edits ---
  console.log("\n--- Sending rapid edits ---");
  const chars = ["A", "B", "C", "D"];
  const startTime = Date.now();

  for (let edit = 0; edit < EDITS_PER_CLIENT; edit++) {
    for (let i = 0; i < NUM_CLIENTS; i++) {
      const text = clients[i].doc.getText("content");
      text.insert(text.length, chars[i]);
    }
  }

  const editTime = Date.now() - startTime;
  console.log(`  ${NUM_CLIENTS * EDITS_PER_CLIENT} edits sent in ${editTime}ms`);

  // --- Wait for convergence ---
  console.log("\n--- Waiting for convergence (10s) ---");
  await wait(10000);

  // --- Verify ---
  console.log("\n--- Verification ---");
  const texts = clients.map((c) => c.doc.getText("content").toString());
  const lengths = texts.map((t) => t.length);

  console.log(`  Client 0 length: ${lengths[0]}`);
  console.log(`  Client 1 length: ${lengths[1]}`);
  console.log(`  Client 2 length: ${lengths[2]}`);
  console.log(`  Client 3 length: ${lengths[3]}`);

  const expectedLength = NUM_CLIENTS * EDITS_PER_CLIENT;
  assert(`All clients have ${expectedLength} characters`, lengths.every((l) => l === expectedLength));
  assert("Client 0 === Client 1", texts[0] === texts[1]);
  assert("Client 1 === Client 2", texts[1] === texts[2]);
  assert("Client 2 === Client 3", texts[2] === texts[3]);
  assert("Zero divergence (all identical)", new Set(texts).size === 1);

  // Count character distribution
  const content = texts[0];
  const countA = (content.match(/A/g) || []).length;
  const countB = (content.match(/B/g) || []).length;
  const countC = (content.match(/C/g) || []).length;
  const countD = (content.match(/D/g) || []).length;
  console.log(`\n  Character distribution: A=${countA} B=${countB} C=${countC} D=${countD}`);
  assert("Each client's edits present (200 each)", countA === 200 && countB === 200 && countC === 200 && countD === 200);

  // --- Persistence check ---
  console.log("\n--- Persistence (disconnect all, reconnect) ---");
  for (const c of clients) c.ws.close();
  console.log("  All clients disconnected. Waiting 5s for flush...");
  await wait(5000);

  const verifyClient = await createClient(SESSION, "verify");
  await wait(3000);
  const restored = verifyClient.doc.getText("content").toString();
  console.log(`  Restored length: ${restored.length}`);
  assert("Persisted content matches", restored === texts[0]);
  verifyClient.ws.close();

  // --- ECS draining simulation ---
  console.log("\n--- ECS Draining Test ---");
  console.log("  Reconnecting after persistence check (simulates task replacement)...");
  await wait(2000);
  const drainClient = await createClient(SESSION, "drain");
  await wait(3000);
  const drainText = drainClient.doc.getText("content").toString();
  assert("Content survives task replacement", drainText === texts[0]);
  drainClient.ws.close();

  // --- Summary ---
  console.log("\n=============================");
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log(`Edit throughput: ${(NUM_CLIENTS * EDITS_PER_CLIENT / (editTime / 1000)).toFixed(0)} edits/sec`);
  process.exit(failed > 0 ? 1 : 0);

} catch (err) {
  console.error("\nFATAL:", err.message);
  process.exit(1);
}
