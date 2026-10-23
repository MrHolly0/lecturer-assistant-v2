// Чистая логика адаптера MAX, вынесенная отдельно ради юнит-тестов без сети и без токена.
// Сетевые вызовы и запуск процессов — в max-adapter.mjs.
import crypto from "node:crypto";

// CodeGenerator.readableCode (core) — алфавит без спутываемых символов, всегда укладывается
// в [A-Za-z0-9_-]; ограничение длины — защита от мусора во входящем payload/тексте команды.
const JOIN_CODE = /^[A-Za-z0-9_-]{1,64}$/;

export function extractJoinCode(payload) {
  if (typeof payload !== "string") {
    return undefined;
  }
  const trimmed = payload.trim();
  return JOIN_CODE.test(trimmed) ? trimmed : undefined;
}

// MAX_API_NOTES.md §7: неясно, какая комбинация полей web_app/contact_id/payload обязательна
// и доходит ли payload кнопки open_app до мини-приложения как start_param. Надёжный,
// задокументированный путь — диплинк `?startapp=<код>` (§1.7), поэтому код лекции кладём в URL,
// а payload передаём тоже, но не полагаемся только на него.
export function openAppButton(webAppUrl, text, joinCode) {
  const url = joinCode ? `${webAppUrl}?startapp=${encodeURIComponent(joinCode)}` : webAppUrl;
  return {
    type: "open_app",
    text,
    web_app: url,
    ...(joinCode ? { payload: joinCode } : {}),
  };
}

// User-объект MAX (bot_started.user, message.sender, callback.user): по официальному SDK
// (max-bot-api-client-ts, src/core/network/api/types/user.ts) поле называется user_id, а не id.
// MAX_API_NOTES.md приводил id по неполному пересказу — 24.09 подтверждено на живом боте
// (bot_started с чтением .id молчал). Проверяем оба варианта, id — как отступление на случай
// расхождения версий API.
export function extractUserId(user) {
  return user?.user_id ?? user?.id;
}

export function extractSenderId(update) {
  const message = update.message;
  return (
      extractUserId(message?.sender) ?? extractUserId(message?.from) ?? extractUserId(message?.user)
  );
}

export function parseStartCommand(text) {
  const match = /^\/start(?:@\S+)?(?:\s+(\S+))?/.exec((text ?? "").trim());
  if (!match) {
    return undefined;
  }
  return { joinCode: extractJoinCode(match[1]) };
}

// MAX_API_NOTES.md §1.3: секрет вебхука сверяется через timingSafeEqual, 404 на несовпадение.
export function timingSafeEqualStrings(a, b) {
  if (typeof a !== "string" || typeof b !== "string") {
    return false;
  }
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

export function webhookPathFor(token) {
  return `/webhook/${crypto.createHash("sha256").update(token).digest("hex")}`;
}

// core Channel SPI отдаёт keyboard как список рядов кнопок {text, payload}; MAX ждёт
// payload.buttons[][] с явным типом кнопки. Для сообщений из outbox core используем "callback".
export function renderKeyboard(keyboard) {
  if (!keyboard?.length) {
    return undefined;
  }
  return keyboard.map((row) => row.map((button) => ({ type: "callback", text: button.text, payload: button.payload })));
}

// Простой ограничитель темпа: минимальный интервал между слотами, без внешнего состояния
// кроме переданного объекта — удобно тестировать без реальных таймеров.
export function createRateLimiter(rps, now = () => Date.now()) {
  if (!Number.isFinite(rps) || rps <= 0) throw new Error("Rate limit must be positive");
  let nextSlotAt = 0;
  return function reserveSlot() {
    const current = now();
    const dueAt = Math.max(nextSlotAt, current);
    nextSlotAt = dueAt + Math.ceil(1000 / rps);
    return Math.max(0, dueAt - current);
  };
}

export function parseRetryAfter(value, now = Date.now()) {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const seconds = Number(value);
  const delay = Number.isFinite(seconds) && seconds >= 0
    ? Math.ceil(seconds * 1000) : Date.parse(value) - now;
  return Number.isSafeInteger(delay) && delay >= 0 ? delay : undefined;
}

export function retryDelay(attempt, { baseMs = 500, capMs = 30_000, random = Math.random } = {}) {
  return Math.floor(random() * Math.min(capMs, baseMs * 2 ** Math.min(attempt, 20)));
}

// A long provider cooldown belongs in the durable outbox; never shorten Retry-After.
export async function retry429(request, sleep, {
  maxAttempts = 3, maxDelayMs = 2000, budgetMs = 5000, random = Math.random, now = Date.now,
} = {}) {
  let waited = 0;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const response = await request();
    if (response.status !== 429 || attempt === maxAttempts - 1) return response;
    const requested = parseRetryAfter(response.headers?.get?.("retry-after"), now());
    const delay = Math.max(requested ?? 0, retryDelay(attempt, { random, capMs: maxDelayMs }));
    if (delay > maxDelayMs || waited + delay > budgetMs) return response;
    await response.body?.cancel();
    await sleep(delay);
    waited += delay;
  }
  throw new Error("Retry budget exhausted");
}
