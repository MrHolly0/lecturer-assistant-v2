#!/usr/bin/env node
// Тестовые данные для проверки: администратор, преподаватель, ассистент, курс, лекция с
// загруженной презентацией и два вопроса-проверки в банке курса. Всё помечено «[ТЕСТ]».
// Работает через публичный API, поэтому данные проходят те же проверки, что и ручной ввод.
// Повторный запуск ничего не дублирует: существующие записи находятся и переиспользуются.
//
// Запуск после `docker compose up`:  docker compose run --rm seed
// Пароли — только из окружения (.env): SEED_PASSWORD_ADMIN, SEED_PASSWORD_LECTURER,
// SEED_PASSWORD_ASSISTANT. В репозитории их нет.
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const baseUrl = (process.env.SEED_BASE_URL ?? "http://web:80").replace(/\/$/, "");
const api = `${baseUrl}/api/v1`;
// Адрес для человека: внутри compose скрипт ходит на web:80, а браузер — на порт хоста.
const publicUrl = (process.env.SEED_PUBLIC_URL || baseUrl).replace(/\/$/, "");


const fixture = JSON.parse(await readFile(new URL("./test-data.json", import.meta.url), "utf8"));
const deckFile = fileURLToPath(new URL(fixture.deck.file, import.meta.url));
const COURSE_TITLE = fixture.course.title;
const DECK_TITLE = fixture.deck.title;
const LECTURE_TITLE = fixture.lecture.title;
const accounts = fixture.accounts;
const questions = fixture.questions;

function fail(message) {
  console.error(`\nОШИБКА: ${message}`);
  process.exit(1);
}

async function call(method, path, { token, setupToken, json, form, expect = [200, 201, 202, 204] } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (setupToken) headers["X-Admin-Setup-Token"] = setupToken;
  let body;
  if (json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(json);
  } else if (form) {
    body = form;
  }
  let response;
  try {
    response = await fetch(`${api}${path}`, { method, headers, body });
  } catch (error) {
    fail(`нет связи с ${api} (${error.cause?.code ?? error.message}). Продукт запущен? docker compose ps`);
  }
  const text = await response.text();
  const data = text ? safeJson(text) : undefined;
  if (!expect.includes(response.status)) {
    return { ok: false, status: response.status, data, text };
  }
  return { ok: true, status: response.status, data };
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function login(account) {
  const result = await call("POST", "/auth/login", {
    json: { email: account.email, password: account.password },
    expect: [200],
  });
  return result.ok ? result.data.accessToken : undefined;
}

async function registerByInvitation(account, invitationCode) {
  const result = await call("POST", "/auth/register", {
    json: { displayName: account.displayName, email: account.email, password: account.password, invitationCode },
    expect: [200],
  });
  if (!result.ok) fail(`не удалось зарегистрировать ${account.email}: ${result.status} ${result.text}`);
  return result.data.accessToken;
}

async function ensureAdmin() {
  const admin = accounts.admin;
  const existing = await login(admin);
  if (existing) return { token: existing, created: false };
  const setupToken = process.env.ADMIN_SETUP_TOKEN;
  if (!setupToken) fail(
    "тестовый администратор не вошёл. Если установка новая, задайте ADMIN_SETUP_TOKEN в .env " +
    "и пересоздайте core; если администратор уже есть, проверьте SEED_PASSWORD_ADMIN."
  );
  const result = await call("POST", "/auth/bootstrap-admin", {
    setupToken,
    json: { displayName: admin.displayName, email: admin.email, password: admin.password },
    expect: [200],
  });
  if (result.ok) return { token: result.data.accessToken, created: true };
  if (result.status === 409) {
    fail(
      "в базе уже есть администратор, а войти как тестовый администратор не удалось. " +
        "Либо база заполнена вручную, либо SEED_PASSWORD_ADMIN отличается от того, с которым " +
        "запускали в первый раз. Не удаляйте данные стенда: используйте существующего администратора.",
    );
  }
  fail(`bootstrap-admin: ${result.status} ${result.text}`);
}

async function ensureLecturer(adminToken) {
  const lecturer = accounts.lecturer;
  const existing = await login(lecturer);
  if (existing) return { token: existing, created: false };
  const invitation = await call("POST", "/admin/invitations", {
    token: adminToken,
    json: { role: "LECTURER", ttlHours: 1 },
  });
  if (!invitation.ok) fail(`приглашение преподавателя: ${invitation.status} ${invitation.text}`);
  return { token: await registerByInvitation(lecturer, invitation.data.code), created: true };
}

async function ensureCourse(lecturerToken) {
  const list = await call("GET", "/courses", { token: lecturerToken });
  if (!list.ok) fail(`список курсов: ${list.status} ${list.text}`);
  const found = (list.data ?? []).find((course) => course.title === COURSE_TITLE && !course.archived);
  if (found) return { course: found, created: false };
  const created = await call("POST", "/courses", { token: lecturerToken, json: { title: COURSE_TITLE } });
  if (!created.ok) fail(`создание курса: ${created.status} ${created.text}`);
  return { course: created.data, created: true };
}

async function ensureAssistant(lecturerToken, courseId) {
  const assistant = accounts.assistant;
  const existing = await login(assistant);
  if (existing) return { created: false };
  const invitation = await call("POST", `/courses/${courseId}/invitations`, {
    token: lecturerToken,
    json: { role: "ASSISTANT", ttlHours: 1 },
  });
  if (!invitation.ok) fail(`приглашение ассистента: ${invitation.status} ${invitation.text}`);
  await registerByInvitation(assistant, invitation.data.code);
  return { created: true };
}

async function ensureDeck(lecturerToken, courseId) {
  const list = await call("GET", `/courses/${courseId}/decks`, { token: lecturerToken });
  if (!list.ok) fail(`список презентаций: ${list.status} ${list.text}`);
  const found = (list.data ?? []).find((deck) => deck.title === DECK_TITLE && !deck.archived);
  if (found) return { deckId: found.id, slides: found.slideCount, created: false };

  const form = new FormData();
  const bytes = await readFile(deckFile);
  form.append(
    "file",
    new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.presentationml.presentation" }),
    "test-lecture.pptx",
  );
  form.append("title", DECK_TITLE);
  const started = await call("POST", `/courses/${courseId}/decks`, { token: lecturerToken, form });
  if (!started.ok) fail(`загрузка презентации: ${started.status} ${started.text}`);

  const jobId = started.data.id;
  const deadline = Date.now() + 5 * 60 * 1000;
  process.stdout.write("  конвертация презентации");
  for (;;) {
    const job = await call("GET", `/courses/${courseId}/import-jobs/${jobId}`, { token: lecturerToken });
    if (!job.ok) fail(`статус импорта: ${job.status} ${job.text}`);
    const { status, deckId, totalSlides, errorMessage } = job.data;
    if (status === "COMPLETED" || status === "PARTIAL") {
      process.stdout.write(" — готово\n");
      return { deckId, slides: totalSlides, created: true };
    }
    if (status === "FAILED") fail(`конвертация не удалась: ${errorMessage ?? "без описания"}`);
    if (Date.now() > deadline) fail("конвертация не завершилась за 5 минут");
    process.stdout.write(".");
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
}

async function ensureLecture(lecturerToken, courseId, deckId) {
  const list = await call("GET", `/courses/${courseId}/lectures`, { token: lecturerToken });
  if (!list.ok) fail(`список лекций: ${list.status} ${list.text}`);
  const found = (list.data ?? []).find((lecture) => lecture.title === LECTURE_TITLE && !lecture.archived);
  if (found) return { lecture: found, created: false };
  const created = await call("POST", `/courses/${courseId}/lectures`, {
    token: lecturerToken,
    json: { title: LECTURE_TITLE, deckId },
  });
  if (!created.ok) fail(`создание лекции: ${created.status} ${created.text}`);
  return { lecture: created.data, created: true };
}

async function ensureQuestions(lecturerToken, courseId) {
  const list = await call("GET", `/courses/${courseId}/questions`, { token: lecturerToken });
  if (!list.ok) fail(`банк вопросов: ${list.status} ${list.text}`);
  const existingTexts = new Set((list.data ?? []).map((question) => question.text));
  let created = 0;
  for (const question of questions) {
    if (existingTexts.has(question.text)) continue;
    const result = await call("POST", `/courses/${courseId}/questions`, { token: lecturerToken, json: question });
    if (!result.ok) fail(`вопрос «${question.text}»: ${result.status} ${result.text}`);
    created += 1;
  }
  return created;
}

// ---------- запуск ----------

const missing = Object.values(accounts).filter((account) => !process.env[account.env]);
if (missing.length > 0) {
  fail(
    `не заданы пароли: ${missing.map((account) => account.env).join(", ")}.\n` +
      "Задайте их в .env (не короче 8 символов) и повторите: docker compose run --rm seed",
  );
}
for (const account of Object.values(accounts)) {
  account.password = process.env[account.env];
  if (account.password.length < 8) fail(`${account.env} короче 8 символов`);
}

console.log(`Тестовые данные → ${baseUrl}`);
const mark = (created, word = "создан") => (created ? word : "уже есть");

const admin = await ensureAdmin();
console.log(`  администратор ${accounts.admin.email} — ${mark(admin.created)}`);
const lecturer = await ensureLecturer(admin.token);
console.log(`  преподаватель ${accounts.lecturer.email} — ${mark(lecturer.created)}`);
const { course, created: courseCreated } = await ensureCourse(lecturer.token);
console.log(`  курс «${COURSE_TITLE}» — ${mark(courseCreated)}`);
const assistant = await ensureAssistant(lecturer.token, course.id);
console.log(`  ассистент ${accounts.assistant.email} — ${mark(assistant.created)}`);
const deck = await ensureDeck(lecturer.token, course.id);
console.log(`  презентация «${DECK_TITLE}» — ${deck.created ? "загружена" : "уже есть"}`);
const { created: lectureCreated } = await ensureLecture(lecturer.token, course.id, deck.deckId);
console.log(`  лекция «${LECTURE_TITLE}» — ${mark(lectureCreated, "создана")}`);
const createdQuestions = await ensureQuestions(lecturer.token, course.id);
console.log(`  вопросы-проверки: добавлено ${createdQuestions}, всего тестовых ${questions.length}`);

console.log(`
Готово. Вход: ${publicUrl}/#/login
  администратор  ${accounts.admin.email}      пароль: SEED_PASSWORD_ADMIN из .env
  преподаватель  ${accounts.lecturer.email}   пароль: SEED_PASSWORD_LECTURER из .env
  ассистент      ${accounts.assistant.email}  пароль: SEED_PASSWORD_ASSISTANT из .env`);
