import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import http from "node:http";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

test("outbox frame is privately fetched, uploaded and delivered to its own MAX recipient as a file", async () => {
  const jpeg = Buffer.from([255, 216, 0, 1, 2, 3, 255, 217]);
  const ref = "/internal/v1/channels/max/media/" + "x".repeat(43);
  const coreCalls = [], maxCalls = [];
  let queued = true;
  const json = (response, value) => response.writeHead(200, { "content-type": "application/json" })
    .end(JSON.stringify(value));
  const core = http.createServer(async (request, response) => {
    const data = [];
    for await (const chunk of request) data.push(chunk);
    const raw = Buffer.concat(data).toString();
    coreCalls.push({ path: request.url, headers: request.headers, body: raw ? JSON.parse(raw) : null });
    if (request.url === ref) {
      if (request.headers["x-internal-api-key"] !== "isolated-adapter-key") {
        response.writeHead(401).end();
        return;
      }
      response.writeHead(200, { "content-type": "image/jpeg", "content-disposition":
        'attachment; filename="demonstration-20261019T150000Z.jpg"' }).end(jpeg);
    } else if (request.url.includes("/outbox")) {
      json(response, { messages: queued ? [{ id: "frame-outbox-1", externalUserId: "777", attemptToken: "attempt-1",
        content: { type: "DOCUMENT", ref, caption: "Кадр демонстрации. Получен сервером 19.10.2026 15:00:00 UTC" },
        keyboard: [] }] : [] });
      queued = false;
    } else response.writeHead(204).end();
  });
  const max = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    const url = new URL(request.url, "http://localhost");
    maxCalls.push({ path: url.pathname, query: Object.fromEntries(url.searchParams),
      headers: request.headers, body });
    if (url.pathname === "/updates") json(response, { updates: [] });
    else if (url.pathname === "/uploads") {
      json(response, { url: `http://127.0.0.1:${max.address().port}/upload-document` });
    } else if (url.pathname === "/upload-document") json(response, { token: "uploaded-file-token" });
    else if (url.pathname === "/messages") json(response, { message: { mid: "document-1" } });
    else response.writeHead(404).end();
  });
  const listen = (server) => new Promise(resolve => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));
  const corePort = await listen(core), maxPort = await listen(max);
  const child = spawn(process.execPath, [fileURLToPath(new URL("./max-adapter.mjs", import.meta.url))], {
    env: { ...process.env, CORE_URL: `http://127.0.0.1:${corePort}`, CHANNEL_INTERNAL_API_KEY: "isolated-adapter-key",
      MAX_API_BASE: `http://127.0.0.1:${maxPort}`, MAX_BOT_TOKEN: "isolated-bot-token",
      MAX_WEBAPP_URL: "https://app.example/mini", MAX_RATE_LIMIT_RPS: "100", MAX_WEBHOOK_URL: "" },
    stdio: ["ignore", "ignore", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", chunk => stderr += chunk);
  try {
    const deadline = Date.now() + 5000;
    while (!coreCalls.some(call => call.path.endsWith("/delivery-reports")) && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    const report = coreCalls.find(call => call.path.endsWith("/delivery-reports"));
    assert.equal(report?.body.reports[0].status, "DELIVERED", stderr);
    assert.equal(report.body.reports[0].attemptToken, "attempt-1");
    const message = maxCalls.find(call => call.path === "/messages");
    assert.equal(message.query.user_id, "777");
    const sent = JSON.parse(message.body);
    assert.deepEqual(sent.attachments, [{ type: "file", payload: { token: "uploaded-file-token" } }]);
    assert.match(sent.text, /15:00:00 UTC/);
    assert.equal(maxCalls.find(call => call.path === "/uploads").query.type, "file");
    const upload = maxCalls.find(call => call.path === "/upload-document");
    assert.equal(upload.headers.authorization, undefined);
    assert.equal(upload.headers["x-internal-api-key"], undefined);
    const multipart = new Response(upload.body, { headers: { "content-type": upload.headers["content-type"] } });
    const file = (await multipart.formData()).get("data");
    assert.deepEqual(Buffer.from(await file.arrayBuffer()), jpeg);
    assert.equal(file.name, "demonstration-20261019T150000Z.jpg");
    assert.equal(stderr, "");
  } finally {
    child.kill();
    core.closeAllConnections(); max.closeAllConnections();
    core.close(); max.close();
  }
});
