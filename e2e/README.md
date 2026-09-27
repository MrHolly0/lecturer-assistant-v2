# E2E

End-to-end suites start in phase 1 with IAM and IDOR checks.

## Нагрузка (k6)

`k6/student-sse.js` — прогон веб-канала студента: одна или несколько
параллельных тестовых сессий. Каждый клиент загружает PNG при смене
слайда. Сценарий импортирует community-extension `k6/x/sse`. Обычный k6 его не
содержит; перед прогоном соберите фиксированный runner:

```sh
docker build -t lecturer-k6-sse:1.1.0 e2e/k6
docker run --rm lecturer-k6-sse:1.1.0 version
```

Ожидаемые версии: k6 1.1.0, `github.com/phymbert/xk6-sse` 0.1.11. На контрольном
прогоне auto-provisioning k6 2.3.0 вернул `unknown dependency: k6/x/sse`, поэтому он не
является воспроизводимым способом запуска.

Сначала smoke на одном клиенте:

```sh
docker run --rm -i -v "$PWD:/work" -w /work \
  lecturer-k6-sse:1.1.0 run -e SMOKE=true \
  -e BASE_URL=http://host.docker.internal:8080 -e JOIN_CODE="$JOIN_CODE" \
  e2e/k6/student-sse.js
```

Полный прогон запускается из корня репозитория. `JOIN_CODE` в артефакты не пишется:

```sh
set -o pipefail
RUN_DIR="e2e/reports/<UTC>-<short-sha>"
docker run --rm -i -v "$PWD:/work" -w /work \
  lecturer-k6-sse:1.1.0 run --summary-mode=full \
  --summary-export "$RUN_DIR/summary.json" \
  --summary-trend-stats='avg,min,med,max,p(90),p(95),p(99)' \
  -e BASE_URL="$BASE_URL" -e JOIN_CODE="$JOIN_CODE" \
  -e EXPECTED_SLIDE_CHANGES=4 -e SLIDE_CHANGE_SCHEDULE="$SLIDE_CHANGE_SCHEDULE" \
  e2e/k6/student-sse.js 2>&1 | tee "$RUN_DIR/stdout.log"
```

`SLIDE_CHANGE_SCHEDULE` — список `slideIdx:epochMillis`; в эти моменты лектор переключает слайды.
Так `slide_change_delivery_ms` меряет смену слайда до получения снапшота, а не только
открытие SSE. В папке прогона также сохраняются ревизия, окружение, команда с
`JOIN_CODE=<redacted>` и exit code.

SSE раздаётся одним планировщиком на сервере (`StudentSseBroadcaster`), поэтому 150
студентов одной лекции — это один запрос снапшота в секунду, а не 150.

Для проверки параллельных секций подготовьте в отдельном Compose-стеке 2 или 10
запущенных лекций с разными кодами. Передайте коды через `JOIN_CODES` и суммарное число
клиентов через `VUS`: например, `JOIN_CODES="код1,код2" VUS=300` или 10 кодов и `VUS=1500`.
Сценарий распределяет клиентов между лекциями по кругу. Не запускайте нагрузку на
публичном демостенде: каждый клиент создаёт участника и ответы.

`ARRIVAL_MS` задаёт интервал между входами соседних виртуальных студентов (например,
`50` — 1500 входов примерно за 75 секунд). При запланированных переключениях
`CLOSE_ON_SCHEDULE=true` удерживает поток, пока студент не увидит все
`EXPECTED_SLIDE_CHANGES`; без этого сценарий завершится по числу событий.
`snapshot_scope_ok` проверяет, что код лекции в каждом снимке совпадает с кодом
виртуального студента. Снимок из другой лекции считается ошибкой.

Для измерения самого core в Docker Desktop добавьте к `docker run` параметр
`--network <compose-project>_default` и задайте `BASE_URL=http://core:8080`.
Путь через `host.docker.internal` и опубликованный порт измеряйте отдельно:
27.09.2026 на нём возникали `dial: i/o timeout` со статусом 0 при 1500 клиентах,
тогда как внутренняя сеть прошла пороги. Это разные сетевые маршруты.

```sh
docker run --rm -i -v "$PWD:/work" -w /work \
  lecturer-k6-sse:1.1.0 run \
  -e BASE_URL="$BASE_URL" -e JOIN_CODES="$JOIN_CODES" -e VUS=1500 \
  -e ARRIVAL_MS=50 -e EXPECTED_SLIDE_CHANGES=4 -e CLOSE_ON_SCHEDULE=true \
  -e SLIDE_CHANGE_SCHEDULE="$SLIDE_CHANGE_SCHEDULE" e2e/k6/student-sse.js
```

Если управляете сменой слайдов, задайте `SLIDE_CHANGE_SCHEDULE` и проверяйте p95 доставки
для каждой секции отдельно. Методика и границы измерений: `docs/hackathon/PARALLEL_LECTURES.md`.
