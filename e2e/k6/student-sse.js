// Нагрузочный прогон веб-канала студента (DoD Фазы 5): 150 одновременных SSE-клиентов
// одной сессии, p95 доставки слайда ≤2 с. Гоняется на отдельной тестовой сессии.
//
// Использует фиксированный runner k6 1.1.0 + xk6-sse 0.1.11 из e2e/k6/Dockerfile.
// Точный запуск и формат артефактов описаны в e2e/README.md.
//
// Каждый студент, как настоящий браузер, скачивает картинку текущего слайда — но только когда
// её URL изменился (иначе браузер берёт из кэша). Так видно эффект D-03: пока подпись ссылки
// стабильна, на студента приходится одна загрузка на слайд, а не одна в секунду.

import { check } from "k6";
import http from "k6/http";
import sse from "k6/x/sse";
import { Counter, Trend, Rate } from "k6/metrics";

const BASE = __ENV.BASE_URL || "http://localhost:8080";
const JOIN_CODE = __ENV.JOIN_CODE;
const SMOKE = (__ENV.SMOKE || "").toLowerCase() === "true";
const EVENTS_PER_CONNECTION = Number(__ENV.EVENTS_PER_CONNECTION || (SMOKE ? 10 : 150));
const EXPECTED_SLIDE_CHANGES = Number(__ENV.EXPECTED_SLIDE_CHANGES || 0);

// Формат: "2:1790331000000,3:1790331030000" (slideIdx:epochMillis).
// Контроллер лектора должен переключать слайды в эти моменты. Это позволяет измерить
// change -> snapshot, а не только время открытия SSE -> первый snapshot.
const scheduledSlideChanges = new Map(
  (__ENV.SLIDE_CHANGE_SCHEDULE || "")
    .split(",")
    .filter(Boolean)
    .map((item) => item.split(":").map(Number))
    .filter(([slideIdx, epochMs]) => Number.isFinite(slideIdx) && Number.isFinite(epochMs))
);

const joinOk = new Rate("join_ok");
const firstSlideMs = new Trend("slide_first_snapshot_ms", true);
const sseOpenRate = new Rate("sse_open_ok");
const streamComplete = new Rate("stream_complete");
const scheduledSlidesSeen = new Rate("scheduled_slides_seen");
const sseErrors = new Counter("sse_errors");
const slideChangeDeliveryMs = new Trend("slide_change_delivery_ms", true);
const slideImageMs = new Trend("slide_image_download_ms", true);
const slideImageDownloads = new Counter("slide_image_downloads");
const slideImageUrlChanges = new Counter("slide_image_url_changes");
const slideImageOk = new Rate("slide_image_ok");

export const options = {
  scenarios: {
    students: {
      executor: "per-vu-iterations",
      vus: SMOKE ? 1 : 150,
      iterations: 1,
      maxDuration: SMOKE ? "30s" : "4m"
    }
  },
  thresholds: {
    join_ok: ["rate>0.99"],
    slide_first_snapshot_ms: ["p(95)<2000"],
    slide_change_delivery_ms: ["p(95)<2000"], // применяется, когда задан schedule
    slide_image_ok: ["rate>0.99"],
    slide_image_download_ms: ["p(95)<2000"],
    sse_open_ok: ["rate>0.99"],
    stream_complete: ["rate>0.99"],
    scheduled_slides_seen: ["rate>0.99"],
    sse_errors: ["count==0"],
    checks: ["rate>0.99"],
    http_req_failed: ["rate<0.01"]
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
  const joined = check(joinRes, { "join 200": (r) => r.status === 200 });
  joinOk.add(joined);
  const token = joinRes.json("participantToken");
  if (!token) {
    streamComplete.add(false);
    scheduledSlidesSeen.add(false);
    return;
  }

  // 2) Один SSE-поток на VU. Сценарий создаёт ровно одного участника на клиента.
  const url = `${BASE}/api/v1/student/sessions/${JOIN_CODE}/events?participantToken=${token}`;
  const startedAt = Date.now();
  let seen = 0;
  let lastImageUrl = null;
  let firstSnapshotRecorded = false;
  const observedScheduledSlides = new Set();
  const response = sse.open(url, {}, function (client) {
    client.on("event", function (event) {
      seen += 1;

      let snapshot = null;
      try {
        snapshot = JSON.parse(event.data);
      } catch (e) {
        // не снапшот (например, служебное событие) — пропускаем
      }
      const slide = snapshot && snapshot.currentSlide;
      const imageUrl = slide && slide.imageUrl;
      if (slide && !firstSnapshotRecorded) {
        firstSnapshotRecorded = true;
        firstSlideMs.add(Date.now() - startedAt);
      }

      const scheduledAt = slide && scheduledSlideChanges.get(slide.idx);
      if (scheduledAt && !observedScheduledSlides.has(slide.idx)) {
        observedScheduledSlides.add(slide.idx);
        slideChangeDeliveryMs.add(Math.max(0, Date.now() - scheduledAt));
      }

      // Как браузер: картинку качаем только при смене URL внутри одного подключения.
      if (imageUrl && imageUrl !== lastImageUrl) {
        if (lastImageUrl !== null) {
          slideImageUrlChanges.add(1);
        }
        lastImageUrl = imageUrl;
        const absoluteImageUrl = imageUrl.startsWith("http") ? imageUrl : `${BASE}${imageUrl}`;
        const image = http.get(absoluteImageUrl, { tags: { name: "slide_image" } });
        slideImageMs.add(image.timings.duration);
        slideImageDownloads.add(1);
        slideImageOk.add(image.status === 200);
      }

      if (seen >= EVENTS_PER_CONNECTION) {
        client.close();
      }
    });
    client.on("error", function () {
      sseErrors.add(1);
      client.close();
    });
  });
  sseOpenRate.add(response && response.status === 200);
  streamComplete.add(firstSnapshotRecorded && seen >= EVENTS_PER_CONNECTION);
  scheduledSlidesSeen.add(observedScheduledSlides.size >= EXPECTED_SLIDE_CHANGES);
}
