# Адаптер Telegram: Node 22 без внешних зависимостей, контекст сборки — adapters/telegram.
FROM node:22-alpine
WORKDIR /app
COPY telegram-adapter.mjs ./
USER node
# Без токена бота адаптер не запускается, а не падает в цикл перезапусков.
CMD ["sh", "-c", "if [ -z \"$TELEGRAM_BOT_TOKEN\" ]; then echo 'TELEGRAM_BOT_TOKEN не задан — адаптер Telegram не запущен. Задайте токен в .env и перезапустите: docker compose up -d telegram-adapter'; exec tail -f /dev/null; fi; exec node telegram-adapter.mjs"]
