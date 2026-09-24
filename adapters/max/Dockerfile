# Адаптер MAX: Node 22 без внешних зависимостей (только стандартная библиотека),
# поэтому ни package.json, ни npm install не нужны. Контекст сборки — adapters/max.
FROM node:22-alpine
WORKDIR /app
COPY lib.mjs max-adapter.mjs ./
USER node
# Порт вебхука; наружу его публикует только Caddy на стенде.
EXPOSE 8090
# Без токена бота адаптер не запускается, а не падает в цикл перезапусков: локальный
# `docker compose up` без кабинета MAX должен поднимать остальной продукт.
CMD ["sh", "-c", "if [ -z \"$MAX_BOT_TOKEN\" ]; then echo 'MAX_BOT_TOKEN не задан — адаптер MAX не запущен. Задайте токен в .env и перезапустите: docker compose up -d max-adapter'; exec tail -f /dev/null; fi; exec node max-adapter.mjs"]
