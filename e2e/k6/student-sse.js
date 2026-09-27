// Нагрузочный прогон веб-канала студента: от одной тестовой лекции до нескольких
// параллельных секций. Измеряет p95 доставки слайда и успешность загрузки PNG.
//
// Использует фиксированный runner k6 1.1.0 + xk6-sse 0.1.11 из e2e/k6/Dockerfile.
// Точный запуск и формат артефактов описаны в e2e/README.md.
//
// Каждый студент, как настоящий браузер, скачивает картинку текущего слайда — но только когда
// её URL изменился (иначе браузер берёт из кэша). Так видно эффект D-03: пока подпись ссылки
// стабильна, на студента приходится одна загрузка на слайд, а не одна в секунду.

import { check, sleep } from "k6";
import http from "k6/http";
import sse from "k6/x/sse";
import { Counter, Trend, Rate } from "k6/metrics";

const BASE = __ENV.BASE_URL || "http://localhost:8080";
const JOIN_CODES = (__ENV.JOIN_CODES || __ENV.JOIN_CODE || "")
  .split(",")
  .map((code) => code.trim())
  .filter(Boolean);
const SMOKE = (__ENV.SMOKE || "").toLowerCase() === "true";
const VUS = Number(__ENV.VUS || 150);
const EVENTS_PER_CONNECTION = Number(__ENV.EVENTS_PER_CONNECTION || (SMOKE ? 10 : 150));
const EXPECTED_SLIDE_CHANGES = Number(__ENV.EXPECTED_SLIDE_CHANGES || 0);
const CLOSE_ON_SCHEDULE = (__ENV.CLOSE_ON_SCHEDULE || "").toLowerCase() === "true";
const ARRIVAL_MS = Number(__ENV.ARRIVAL_MS || 0);

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
const slideImageFailures = new Counter("slide_image_failures");
const snapshotScopeOk = new Rate("snapshot_scope_ok");

export const options = {
  scenarios: {
    students: {
      executor: "per-vu-iterations",
      vus: SMOKE ? 1 : VUS,
      iterations: 1,
      maxDuration: __ENV.MAX_DURATION || (SMOKE ? "30s" : "4m")
    }
  },
  thresholds: {
    join_ok: ["rate>0.99"],
    slide_first_snapshot_ms: ["p(95)<2000"],
    slide_change_delivery_ms: ["p(95)<2000"], // применяется, когда задан schedule
    slide_image_ok: ["rate>0.99"],
    snapshot_scope_ok: ["rate==1"],
    slide_image_download_ms: ["p(95)<2000"],
    sse_open_ok: ["rate>0.99"],
    stream_complete: ["rate>0.99"],
    scheduled_slides_seen: ["rate>0.99"],
    sse_errors: ["count==0"],
    checks: ["rate>0.99"],
    http_req_failed: ["rate<0.01"],
    ...Object.fromEntries(
      JOIN_CODES.flatMap((_, index) => {
        const section = index + 1;
        return [
          [`slide_first_snapshot_ms{section:${section}}`, ["p(95)<2000"]],
          [`sse_open_ok{section:${section}}`, ["rate>0.99"]],
          [`slide_image_ok{section:${section}}`, ["rate>0.99"]],
          ...(EXPECTED_SLIDE_CHANGES > 0
            ? [[`slide_change_delivery_ms{section:${section}}`, ["p(95)<2000"]]]
            : [])
        ];
      })
    )
  }
};

export default function () {
  if (JOIN_CODES.length === 0) {
    throw new Error("Передайте JOIN_CODE или список JOIN_CODES через запятую");
  }
  const joinCode = JOIN_CODES[(__VU - 1) % JOIN_CODES.length];
  const tags = { section: String((__VU - 1) % JOIN_CODES.length + 1) };
  if (ARRIVAL_MS > 0) sleep(((__VU - 1) * ARRIVAL_MS) / 1000);

  // 1) Эфемерный вход.
  const joinRes = http.post(
    `${BASE}/api/v1/student/sessions/${joinCode}/join`,
    JSON.stringify({ displayName: `k6-${__VU}` }),
    { headers: { "Content-Type": "application/json" } }
  );
  const joined = check(joinRes, { "join 200": (r) => r.status === 200 });
  joinOk.add(joined, tags);
  if (!joined) console.error(`join section=${tags.section} status=${joinRes.status} error=${joinRes.error || ""}`);
  const token = joinRes.json("participantToken");
  if (!token) {
    streamComplete.add(false, tags);
    scheduledSlidesSeen.add(false, tags);
    return;
  }

  // 2) Один SSE-поток на VU. Сценарий создаёт ровно одного участника на клиента.
  const url = `${BASE}/api/v1/student/sessions/${joinCode}/events?participantToken=${token}`;
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
      if (snapshot && snapshot.joinCode) {
        snapshotScopeOk.add(snapshot.joinCode === joinCode, tags);
      }
      const imageUrl = slide && slide.imageUrl;
      if (slide && !firstSnapshotRecorded) {
        firstSnapshotRecorded = true;
        firstSlideMs.add(Date.now() - startedAt, tags);
      }

      const scheduledAt = slide && scheduledSlideChanges.get(slide.idx);
      if (scheduledAt && !observedScheduledSlides.has(slide.idx)) {
        observedScheduledSlides.add(slide.idx);
        slideChangeDeliveryMs.add(Math.max(0, Date.now() - scheduledAt), tags);
      }

      // Как браузер: картинку качаем только при смене URL внутри одного подключения.
      if (imageUrl && imageUrl !== lastImageUrl) {
        if (lastImageUrl !== null) {
          slideImageUrlChanges.add(1, tags);
        }
        lastImageUrl = imageUrl;
        const absoluteImageUrl = imageUrl.startsWith("http") ? imageUrl : `${BASE}${imageUrl}`;
        const image = http.get(absoluteImageUrl, { tags: { name: "slide_image" } });
        slideImageMs.add(image.timings.duration, tags);
        slideImageDownloads.add(1, tags);
        slideImageOk.add(image.status === 200, tags);
        if (image.status !== 200) {
          slideImageFailures.add(1, { ...tags, status: String(image.status) });
          console.error(`image section=${tags.section} status=${image.status} error=${image.error || ""}`);
        }
      }

      if (CLOSE_ON_SCHEDULE && EXPECTED_SLIDE_CHANGES > 0
          ? observedScheduledSlides.size >= EXPECTED_SLIDE_CHANGES
          : seen >= EVENTS_PER_CONNECTION) {
        client.close();
      }
    });
    client.on("error", function () {
      sseErrors.add(1, tags);
      client.close();
    });
  });
  sseOpenRate.add(response && response.status === 200, tags);
  if (!response || response.status !== 200) {
    console.error(`sse section=${tags.section} status=${response?.status ?? "none"}`);
  }
  streamComplete.add(firstSnapshotRecorded && (CLOSE_ON_SCHEDULE
    ? observedScheduledSlides.size >= EXPECTED_SLIDE_CHANGES
    : seen >= EVENTS_PER_CONNECTION), tags);
  scheduledSlidesSeen.add(observedScheduledSlides.size >= EXPECTED_SLIDE_CHANGES, tags);
}
