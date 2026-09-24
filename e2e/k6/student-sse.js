// Нагрузочный прогон веб-канала студента (DoD Фазы 5): 150 одновременных SSE-клиентов
// одной сессии, p95 доставки слайда ≤2 с. Гоняется на стенде, не в unit-сборке.
//
// Подготовка: лектор стартует сессию и передаёт join-код.
//   k6 run -e BASE_URL=http://localhost:8080 -e JOIN_CODE=ABC123 e2e/k6/student-sse.js
// Через туннель стенда (реальная сеть, HTTPS):
//   k6 run -e BASE_URL=https://lecturer-assistant.ru.tuna.am -e JOIN_CODE=ABC123 e2e/k6/student-sse.js
//
// Каждый студент, как настоящий браузер, скачивает картинку текущего слайда — но только когда
// её URL изменился (иначе браузер берёт из кэша). Так видно эффект D-03: пока подпись ссылки
// стабильна, на студента приходится одна загрузка на слайд, а не одна в секунду.
//
// SSE-клиент — экспериментальный модуль k6 (k6 >= 0.59): k6/experimental/sse.

import { check, sleep } from "k6";
import http from "k6/http";
import sse from "k6/experimental/sse";
import { Counter, Trend, Rate } from "k6/metrics";

const BASE = __ENV.BASE_URL || "http://localhost:8080";
const JOIN_CODE = __ENV.JOIN_CODE;

const firstSlideMs = new Trend("slide_first_byte_ms", true);
const sseOpenRate = new Rate("sse_open_ok");
const slideImageMs = new Trend("slide_image_download_ms", true);
const slideImageDownloads = new Counter("slide_image_downloads");
const slideImageUrlChanges = new Counter("slide_image_url_changes");
const slideImageOk = new Rate("slide_image_ok");

export const options = {
  scenarios: {
    students: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "30s", target: 150 }, // разгон до полной аудитории
        { duration: "3m", target: 150 }, // удержание 150 одновременных SSE
        { duration: "10s", target: 0 }
      ]
    }
  },
  thresholds: {
    slide_first_byte_ms: ["p(95)<2000"], // DoD: доставка слайда p95 ≤2 с
    slide_image_ok: ["rate>0.99"],
    sse_open_ok: ["rate>0.99"],
    checks: ["rate>0.99"]
  }
};

export default function () {
  if (!JOIN_CODE) {
    throw new Error("Передайте join-код сессии: -e JOIN_CODE=...");
  }

  // 1) Эфемерный вход.
  const joinRes = http.post(
    `${BASE}/api/v1/student/sessions/${JOIN_CODE}/join`,
    JSON.stringify({ displayName: `k6-${__VU}` }),
    { headers: { "Content-Type": "application/json" } }
  );
  check(joinRes, { "join 200": (r) => r.status === 200 });
  const token = joinRes.json("participantToken");
  if (!token) {
    return;
  }

  // 2) SSE-поток: держим ~20 событий (≈20 с) и меряем время до первого снапшота слайда.
  const url = `${BASE}/api/v1/student/sessions/${JOIN_CODE}/events?participantToken=${token}`;
  const startedAt = Date.now();
  let seen = 0;
  let lastImageUrl = null;
  const response = sse.open(url, {}, function (client) {
    client.on("event", function (event) {
      if (seen === 0) {
        firstSlideMs.add(Date.now() - startedAt);
      }
      seen += 1;

      // Как браузер: картинку качаем, только если URL поменялся (иначе она уже в кэше).
      let imageUrl = null;
      try {
        const snapshot = JSON.parse(event.data);
        imageUrl = snapshot.currentSlide && snapshot.currentSlide.imageUrl;
      } catch (e) {
        // не снапшот (например, служебное событие) — пропускаем
      }
      if (imageUrl && imageUrl !== lastImageUrl) {
        if (lastImageUrl !== null) {
          slideImageUrlChanges.add(1);
        }
        lastImageUrl = imageUrl;
        const image = http.get(`${BASE}${imageUrl}`, { tags: { name: "slide_image" } });
        slideImageMs.add(image.timings.duration);
        slideImageDownloads.add(1);
        slideImageOk.add(image.status === 200);
      }

      if (seen >= 20) {
        client.close();
      }
    });
    client.on("error", function () {
      client.close();
    });
  });
  sseOpenRate.add(response && response.status === 200);

  // 3) Один сигнал светофора — нагрузка на запись агрегата (теперь UPSERT по студенту).
  const signal = http.post(
    `${BASE}/api/v1/student/sessions/${JOIN_CODE}/signals`,
    JSON.stringify({ participantToken: token, value: "GREEN" }),
    { headers: { "Content-Type": "application/json" } }
  );
  check(signal, { "signal 200": (r) => r.status === 200 });

  sleep(1);
}
