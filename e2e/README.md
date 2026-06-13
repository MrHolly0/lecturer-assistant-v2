# E2E

End-to-end suites start in phase 1 with IAM and IDOR checks.

## Нагрузка (k6)

`k6/student-sse.js` — прогон веб-канала студента под DoD Фазы 5: 150 одновременных
SSE-клиентов одной сессии, p95 доставки слайда ≤2 с. Запуск на стенде:

```sh
# Лектор стартует сессию и берёт join-код, затем:
k6 run -e BASE_URL=http://localhost:8080 -e JOIN_CODE=ABC123 k6/student-sse.js
```

SSE раздаётся одним планировщиком на сервере (`StudentSseBroadcaster`), поэтому 150
студентов одной лекции — это один запрос снапшота в секунду, а не 150.

