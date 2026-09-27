#!/usr/bin/env node
// B-01: адаптер MAX по образцу adapters/telegram/telegram-adapter.mjs.
// Core не импортирует MAX SDK: адаптер общается с core только через Channel SPI
// (/internal/v1/channels/max/...) и с MAX — через Bot API (https://dev.max.ru/docs-api).
//
// Источник фактов о протоколе — docs/hackathon/research/MAX_API_NOTES.md. Там, где справка
// оставляет вопрос открытым, это отмечено комментарием «ТРЕБУЕТ ПРОВЕРКИ» и решение выбрано
// в пользу задокументированного, а не предполагаемого поведения. Чистая логика (без сети и
// без процесса) вынесена в lib.mjs и покрыта тестами в lib.test.mjs.
import http from "node:http";
import {
  createRateLimiter,
  extractJoinCode,
  extractSenderId,
  extractUserId,
  openAppButton,
  parseStartCommand,
  renderKeyboard,
  timingSafeEqualStrings,
  webhookPathFor,
} from "./lib.mjs";

const coreUrl = process.env.CORE_URL ?? "http://localhost:8080";
const apiKey = process.env.CHANNEL_INTERNAL_API_KEY ?? "phase-4-local-channel-key";
const apiBase = process.env.MAX_API_BASE ?? "https://platform-api2.max.ru";
const botToken = process.env.MAX_BOT_TOKEN;
const webAppUrl = process.env.MAX_WEBAPP_URL;
const webhookUrl = process.env.MAX_WEBHOOK_URL; // если задан — вебхук, иначе long polling
const webhookSecret = process.env.MAX_WEBHOOK_SECRET;
const webhookPort = Number(process.env.MAX_WEBHOOK_PORT ?? 8090);
// MAX_API_NOTES.md §1.3: «рекомендуемый путь — /webhook/<sha256(token)>, чтобы URL не угадывался».
const webhookPath = process.env.MAX_WEBHOOK_PATH ?? (botToken ? webhookPathFor(botToken) : undefined);
// MAX_API_NOTES.md §1.2: лимит 30 rps на хост, разбивка (на бота/на IP/на метод) не документирована.
// Практическая рекомендация справки — держать запас, целимся в 10–15 rps.
const rateLimitRps = Number(process.env.MAX_RATE_LIMIT_RPS ?? 15);
const channelType = "max";

if (!botToken) {
  throw new Error("MAX_BOT_TOKEN is required");
}
if (!webAppUrl) {
  throw new Error("MAX_WEBAPP_URL is required (URL мини-приложения, зарегистрированный в кабинете партнёра)");
}
if (webhookUrl && !webhookSecret) {
  throw new Error("MAX_WEBHOOK_SECRET is required when MAX_WEBHOOK_URL is set");
}

// ---------- core Channel SPI ----------

async function core(path, options = {}) {
  const response = await fetch(`${coreUrl}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "X-Internal-Api-Key": apiKey,
      ...(options.headers ?? {}),
    },
  });
  if (!response.ok) {
    throw new Error(`core ${response.status}: ${await response.text()}`);
  }
  if (response.status === 204 || response.status === 202) {
    return undefined;
  }
  return response.json();
}

async function registerCapabilities() {
  await core(`/internal/v1/channels/${channelType}/capabilities`, {
    method: "PUT",
    body: JSON.stringify({
      inlineButtons: true,
      // Эндпоинта редактирования сообщения в справке нет (есть только POST/GET/DELETE /messages).
      editMessage: false,
      images: true,
      // ТРЕБУЕТ ПРОВЕРКИ: MAX_API_NOTES.md §1.5 — лимит длины text не задокументирован,
      // значение ниже — осторожная оценка, не факт из справки.
      maxTextLength: 4000,
      // MAX_API_NOTES.md §1.6: «до 7 кнопок в ряду, до 3 — если это link/open_app/...».
      // Наши кнопки почти всегда open_app, поэтому берём более строгий предел.
      maxButtonsPerRow: 3,
    }),
  });
}

// ---------- MAX Bot API ----------

// Глобальный ограничитель на весь процесс. Per-chat лимита MAX не документирует
// (в отличие от Telegram) — отдельно его не вводим.
const reserveSlot = createRateLimiter(rateLimitRps);

async function maxApi(path, { method = "GET", query, body } = {}) {
  const url = new URL(`${apiBase}${path}`);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null) {
      url.searchParams.set(key, String(value));
    }
  }
  await sleep(reserveSlot());
  const response = await fetch(url, {
    method,
    // MAX_API_NOTES.md §1.1: заголовок `Authorization: <token>` без префикса Bearer.
    headers: { Authorization: botToken, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (response.status === 429) {
    // ТРЕБУЕТ ПРОВЕРКИ: формат ответа при превышении лимита в справке не описан (нет
    // подтверждённого Retry-After). Разовый защитный повтор с задержкой по умолчанию.
    const retryAfterHeader = response.headers.get("retry-after");
    const retryAfterMs = retryAfterHeader ? Number(retryAfterHeader) * 1000 : 1000;
    await sleep(Number.isFinite(retryAfterMs) ? retryAfterMs : 1000);
    return maxApi(path, { method, query, body });
  }
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`MAX API ${method} ${path} -> ${response.status}: ${text}`);
  }
  return text ? JSON.parse(text) : undefined;
}

// buttonRows: массив рядов, ряд — массив кнопок MAX (payload.buttons[][]).
async function sendMessage(userId, text, buttonRows, imageUrl) {
  const attachments = [
    ...(imageUrl ? [{ type: "image", payload: { url: new URL(imageUrl, webAppUrl).toString() } }] : []),
    ...(buttonRows?.length ? [{ type: "inline_keyboard", payload: { buttons: buttonRows } }] : []),
  ];
  return maxApi("/messages", {
    method: "POST",
    query: { user_id: userId },
    body: { text, attachments: attachments.length ? attachments : undefined, notify: true },
  });
}

// ---------- обработка событий бота ----------

async function handleBotStarted(update) {
  const userId = extractUserId(update.user);
  if (!userId) {
    return;
  }
  const joinCode = extractJoinCode(update.payload);
  const text = joinCode
      ? `Открой лекцию по коду ${joinCode} 👇`
      : "Привет! Нажми кнопку, чтобы открыть мини-приложение, и введи код лекции с проектора.";
  await sendMessage(userId, text, [[openAppButton(webAppUrl, "Открыть лекцию", joinCode)]]);
}

async function handleMessageCreated(update) {
  const userId = extractSenderId(update);
  if (!userId) {
    // ТРЕБУЕТ ПРОВЕРКИ: точная схема Message (поле отправителя) в справке не описана.
    console.warn("[max-adapter] message_created without a recognizable sender id, skipped");
    return;
  }
  const start = parseStartCommand(update.message?.text);
  if (start) {
    await sendMessage(userId, "Открой лекцию по коду 👇", [
      [openAppButton(webAppUrl, "Открыть лекцию", start.joinCode)],
    ]);
    return;
  }
  await sendMessage(userId, "Чтобы участвовать в лекции, открой мини-приложение и введи код с проектора.", [
    [openAppButton(webAppUrl, "Открыть мини-приложение")],
  ]);
}

async function handleUpdate(update) {
  try {
    if (update.update_type === "bot_started") {
      await handleBotStarted(update);
    } else if (update.update_type === "message_created") {
      await handleMessageCreated(update);
    }
  } catch (error) {
    console.error(`[max-adapter] failed to handle ${update.update_type}:`, error.message);
  }
}

// ---------- приём событий: вебхук (продакшен) ----------

function startWebhookServer() {
  const server = http.createServer((request, response) => {
    if (request.method !== "POST" || request.url !== webhookPath) {
      response.writeHead(404).end();
      return;
    }
    const secretHeader = request.headers["x-max-bot-api-secret"];
    if (!timingSafeEqualStrings(String(secretHeader ?? ""), webhookSecret)) {
      response.writeHead(404).end();
      return;
    }
    let raw = "";
    request.on("data", (chunk) => (raw += chunk));
    request.on("end", async () => {
      response.writeHead(200).end();
      try {
        await handleUpdate(JSON.parse(raw));
      } catch (error) {
        console.error("[max-adapter] webhook payload error:", error.message);
      }
    });
  });
  server.listen(webhookPort, () => {
    console.log(`[max-adapter] webhook listening on :${webhookPort}${webhookPath}`);
  });
}

async function registerWebhookSubscription() {
  // SDK-поведение (max-bot-api-client-ts): при старте в режиме вебхука удаляются прочие подписки.
  // Полезно при смене адреса стенда (туннель меняется между перезапусками).
  const existing = await maxApi("/subscriptions");
  for (const subscription of existing.subscriptions ?? []) {
    if (subscription.url !== webhookUrl) {
      await maxApi("/subscriptions", { method: "DELETE", query: { url: subscription.url } });
    }
  }
  await maxApi("/subscriptions", { method: "POST", body: { url: webhookUrl, secret: webhookSecret } });
}

// ---------- приём событий: long polling (локальная разработка) ----------
// MAX_API_NOTES.md §1.3: «для локальной разработки документация рекомендует long polling,
// а не туннель»; «этот способ не подходит для production».

async function runLongPolling() {
  let marker;
  for (;;) {
    try {
      const response = await maxApi("/updates", { query: { timeout: 25, limit: 100, marker } });
      for (const update of response.updates ?? []) {
        await handleUpdate(update);
      }
      marker = response.marker ?? marker;
    } catch (error) {
      console.error("[max-adapter] long polling error:", error.message);
      await sleep(1000);
    }
  }
}

// ---------- отправка из outbox core (сигналы/сводки будущих задач B-06…B-08) ----------

async function pollCoreOutbox() {
  const batch = await core(`/internal/v1/channels/${channelType}/outbox?wait=1s&limit=100`);
  const reports = [];
  for (const message of batch.messages ?? []) {
    const started = Date.now();
    try {
      const result = await sendMessage(
          message.externalUserId,
          message.content.type === "IMAGE" ? message.content.caption ?? "Слайд лекции" : message.content.text ?? "",
          renderKeyboard(message.keyboard),
          message.content.type === "IMAGE" ? message.content.ref : undefined);
      reports.push({
        messageId: message.id,
        status: "DELIVERED",
        // ТРЕБУЕТ ПРОВЕРКИ: точное имя поля идентификатора сообщения (mid/id) не подтверждено.
        adapterMessageId: String(result?.message?.mid ?? result?.message?.id ?? ""),
        latencyMs: Date.now() - started,
      });
    } catch (error) {
      reports.push({
        messageId: message.id,
        status: "FAILED",
        errorMessage: error.message,
        latencyMs: Date.now() - started,
      });
    }
  }
  if (reports.length > 0) {
    await core(`/internal/v1/channels/${channelType}/delivery-reports`, {
      method: "POST",
      body: JSON.stringify({ reports }),
    });
  }
}

// Опрос outbox уже сам обрабатывает сбой отправки в MAX на каждое сообщение (try/catch внутри
// pollCoreOutbox), но обращение к самому core (outbox/delivery-reports) может кратко упасть
// при рестарте контейнера core — без этой обвязки один такой сбой рушил бы весь процесс адаптера.
async function runOutboxLoop() {
  for (;;) {
    try {
      await pollCoreOutbox();
    } catch (error) {
      console.error("[max-adapter] outbox poll error:", error.message);
      await sleep(1000);
    }
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------- запуск ----------

await registerCapabilities();

if (webhookUrl) {
  await registerWebhookSubscription();
  startWebhookServer();
} else {
  runLongPolling();
}
runOutboxLoop();
