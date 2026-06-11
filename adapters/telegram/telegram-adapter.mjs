#!/usr/bin/env node
const coreUrl = process.env.CORE_URL ?? "http://localhost:8080";
const apiKey = process.env.CHANNEL_INTERNAL_API_KEY ?? "phase-4-local-channel-key";
const token = process.env.TELEGRAM_BOT_TOKEN;
const channelType = "telegram";

if (!token) {
  throw new Error("TELEGRAM_BOT_TOKEN is required");
}

let offset = 0;
let globalNextAt = 0;
const chatNextAt = new Map();

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

async function telegram(method, payload) {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await response.json();
  if (response.status === 429 && body.parameters?.retry_after) {
    await sleep(body.parameters.retry_after * 1000);
    return telegram(method, payload);
  }
  if (!body.ok) {
    throw new Error(body.description ?? `telegram ${response.status}`);
  }
  return body.result;
}

async function registerCapabilities() {
  await core(`/internal/v1/channels/${channelType}/capabilities`, {
    method: "PUT",
    body: JSON.stringify({
      inlineButtons: true,
      editMessage: true,
      images: true,
      maxTextLength: 4096,
      maxButtonsPerRow: 4,
    }),
  });
}

async function pollTelegramUpdates() {
  const updates = await telegram("getUpdates", { timeout: 25, offset });
  for (const update of updates) {
    offset = update.update_id + 1;
    const message = update.message;
    const callback = update.callback_query;
    if (message?.text) {
      await sendInbound(String(message.chat.id), message.text, message.from);
    }
    if (callback?.data) {
      await sendInbound(String(callback.message.chat.id), callback.data, callback.from, "CALLBACK");
    }
  }
}

async function sendInbound(externalUserId, text, from, kind = undefined) {
  await core(`/internal/v1/channels/${channelType}/inbound`, {
    method: "POST",
    body: JSON.stringify({
      externalUserId,
      kind: kind ?? (text.startsWith("/") ? "COMMAND" : "TEXT"),
      text,
      displayHint: [from?.last_name, from?.first_name].filter(Boolean).join(" ") || from?.username,
      occurredAt: new Date().toISOString(),
    }),
  });
}

async function pollCoreOutbox() {
  const batch = await core(`/internal/v1/channels/${channelType}/outbox?wait=1s&limit=100`);
  const reports = [];
  for (const message of batch.messages ?? []) {
    const started = Date.now();
    try {
      const result = await deliver(message);
      reports.push({
        messageId: message.id,
        status: "DELIVERED",
        adapterMessageId: String(result.message_id),
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

async function deliver(message) {
  await waitForRateLimit(message.externalUserId);
  const text = message.content.text ?? message.content.caption ?? "";
  return telegram("sendMessage", {
    chat_id: message.externalUserId,
    text,
    reply_markup: renderKeyboard(message.keyboard),
  });
}

function renderKeyboard(keyboard) {
  if (!keyboard?.length) {
    return undefined;
  }
  return {
    inline_keyboard: keyboard.map((row) => row.map((button) => ({
      text: button.text,
      callback_data: button.payload,
    }))),
  };
}

async function waitForRateLimit(chatId) {
  const now = Date.now();
  const dueAt = Math.max(globalNextAt, chatNextAt.get(chatId) ?? 0);
  if (dueAt > now) {
    await sleep(dueAt - now);
  }
  globalNextAt = Date.now() + 40;
  chatNextAt.set(chatId, Date.now() + 1000);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

await registerCapabilities();
for (;;) {
  await Promise.all([pollTelegramUpdates(), pollCoreOutbox()]);
}
