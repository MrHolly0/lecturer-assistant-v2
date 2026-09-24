// Сквозная проверка max-adapter.mjs без реального токена и без сети: поднимаем локальные
// HTTP-заглушки вместо core и вместо MAX Bot API, запускаем адаптер отдельным процессом
// и смотрим, что он реально отправляет. Закрывает критерий приёмки B-01 («бот отвечает
// на /start и кнопка открывает мини-приложение с нужным кодом лекции») в той части,
// которую можно проверить без живого бота (см. README.md, раздел «Что не проверено»).
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import http from "node:http";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { webhookPathFor } from "./lib.mjs";

const ADAPTER_PATH = fileURLToPath(new URL("./max-adapter.mjs", import.meta.url));
const BOT_TOKEN = "integration-test-token";

function startFakeCore() {
  const calls = [];
  const server = http.createServer((request, response) => {
    let raw = "";
    request.on("data", (chunk) => (raw += chunk));
    request.on("end", () => {
      calls.push({ method: request.method, url: request.url, body: raw ? JSON.parse(raw) : undefined });
      if (request.url.endsWith("/capabilities")) {
        response.writeHead(204).end();
      } else if (request.url.includes("/outbox")) {
        response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ messages: [] }));
      } else if (request.url.endsWith("/delivery-reports")) {
        response.writeHead(204).end();
      } else {
        response.writeHead(404).end();
      }
    });
  });
  return { server, calls };
}

function startFakeMax() {
  const messages = [];
  let updatesServed = false;
  const server = http.createServer((request, response) => {
    let raw = "";
    request.on("data", (chunk) => (raw += chunk));
    request.on("end", () => {
      const url = new URL(request.url, "http://localhost");
      if (url.pathname === "/updates") {
        if (!updatesServed) {
          updatesServed = true;
          response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({
            updates: [{ update_type: "bot_started", timestamp: Date.now(), user: { user_id: 555 }, payload: "ABC234" }],
            marker: 1,
          }));
        } else {
          response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ updates: [], marker: 1 }));
        }
      } else if (url.pathname === "/messages" && request.method === "POST") {
        const body = JSON.parse(raw);
        messages.push({ query: Object.fromEntries(url.searchParams), body });
        response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ message: { mid: "m1" } }));
      } else if (url.pathname === "/subscriptions" && request.method === "GET") {
        response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ subscriptions: [] }));
      } else if (url.pathname === "/subscriptions" && request.method === "POST") {
        response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({}));
      } else {
        response.writeHead(404).end();
      }
    });
  });
  return { server, messages };
}

async function listen(server) {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return server.address().port;
}

async function freePort() {
  const probe = http.createServer();
  const port = await listen(probe);
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

async function waitUntil(predicate, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("condition not met before timeout");
}

// Сервер вебхука адаптер поднимает только после регистрации подписки (сетевой round-trip
// к фейковому MAX), поэтому первые попытки соединения могут прийти раньше, чем порт открыт.
async function fetchWithRetry(url, options, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      return await fetch(url, options);
    } catch (error) {
      if (Date.now() >= deadline) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
}

test("bot_started via long polling replies with an open_app button carrying the join code", async () => {
  const core = startFakeCore();
  const max = startFakeMax();
  const corePort = await listen(core.server);
  const maxPort = await listen(max.server);

  const child = spawn(process.execPath, [ADAPTER_PATH], {
    env: {
      ...process.env,
      CORE_URL: `http://127.0.0.1:${corePort}`,
      MAX_API_BASE: `http://127.0.0.1:${maxPort}`,
      MAX_BOT_TOKEN: BOT_TOKEN,
      MAX_WEBAPP_URL: "https://app.example/mini",
      MAX_RATE_LIMIT_RPS: "50",
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => (stderr += chunk));

  try {
    await waitUntil(() => max.messages.length > 0);
    const [sent] = max.messages;
    assert.equal(sent.query.user_id, "555");
    assert.match(sent.body.text, /ABC234/);
    const button = sent.body.attachments[0].payload.buttons[0][0];
    assert.equal(button.type, "open_app");
    assert.equal(button.web_app, "https://app.example/mini?startapp=ABC234");

    assert.ok(core.calls.some((call) => call.url.endsWith("/capabilities") && call.method === "PUT"));
  } finally {
    child.kill();
    core.server.close();
    max.server.close();
  }
  assert.equal(stderr, "", `adapter logged to stderr: ${stderr}`);
});

test("webhook mode checks the secret and the path before accepting an update", async () => {
  const core = startFakeCore();
  const max = startFakeMax();
  const corePort = await listen(core.server);
  const maxPort = await listen(max.server);
  const webhookPort = await freePort(); // адаптер сам поднимет сервер на этом порту

  const secret = "webhook-secret";
  const child = spawn(process.execPath, [ADAPTER_PATH], {
    env: {
      ...process.env,
      CORE_URL: `http://127.0.0.1:${corePort}`,
      MAX_API_BASE: `http://127.0.0.1:${maxPort}`,
      MAX_BOT_TOKEN: BOT_TOKEN,
      MAX_WEBAPP_URL: "https://app.example/mini",
      MAX_WEBHOOK_URL: "https://stand.example/webhook",
      MAX_WEBHOOK_SECRET: secret,
      MAX_WEBHOOK_PORT: String(webhookPort),
      MAX_RATE_LIMIT_RPS: "50",
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => (stderr += chunk));

  try {
    await waitUntil(() => core.calls.some((call) => call.url.endsWith("/capabilities")));
    const path = webhookPathFor(BOT_TOKEN);
    const base = `http://127.0.0.1:${webhookPort}`;

    const wrongSecret = await fetchWithRetry(`${base}${path}`, {
      method: "POST",
      headers: { "x-max-bot-api-secret": "not-the-secret" },
      body: JSON.stringify({ update_type: "bot_started", user: { user_id: 1 } }),
    });
    assert.equal(wrongSecret.status, 404);

    const okResponse = await fetchWithRetry(`${base}${path}`, {
      method: "POST",
      headers: { "x-max-bot-api-secret": secret },
      body: JSON.stringify({ update_type: "bot_started", user: { user_id: 999 }, payload: "ZZZ999" }),
    });
    assert.equal(okResponse.status, 200);

    await waitUntil(() => max.messages.some((message) => message.query.user_id === "999"));
    const sent = max.messages.find((message) => message.query.user_id === "999");
    assert.equal(sent.body.attachments[0].payload.buttons[0][0].web_app, "https://app.example/mini?startapp=ZZZ999");
  } finally {
    child.kill();
    core.server.close();
    max.server.close();
  }
  assert.equal(stderr, "", `adapter logged to stderr: ${stderr}`);
});
