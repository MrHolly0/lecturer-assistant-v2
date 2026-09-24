# Адаптер MAX: Node 22 без внешних зависимостей (только стандартная библиотека),
# поэтому ни package.json, ни npm install не нужны. Контекст сборки — корень репозитория.
FROM node:22-alpine
WORKDIR /app
COPY adapters/max/lib.mjs adapters/max/max-adapter.mjs ./

# Сертификат platform-api2.max.ru выдан Russian Trusted Sub CA (Минцифры), корня которого
# нет в хранилище Node: без него любой запрос к MAX API падает с
# UNABLE_TO_GET_ISSUER_CERT_LOCALLY. Корень добавляется только этому процессу.
# Источник: https://gu-st.ru/content/lending/russian_trusted_root_ca_pem.crt,
# SHA-256 D2:6D:2D:02:31:B7:C3:9F:92:CC:73:85:12:BA:54:10:35:19:E4:40:5D:68:B5:BD:70:3E:97:88:CA:8E:CF:31
COPY deploy/certs/russian_trusted_root_ca.pem /etc/ssl/max/russian_trusted_root_ca.pem
ENV NODE_EXTRA_CA_CERTS=/etc/ssl/max/russian_trusted_root_ca.pem

USER node
# Порт вебхука; наружу его публикует только Caddy на стенде.
EXPOSE 8090
# Без токена бота адаптер не запускается, а не падает в цикл перезапусков: локальный
# `docker compose up` без кабинета MAX должен поднимать остальной продукт.
CMD ["sh", "-c", "if [ -z \"$MAX_BOT_TOKEN\" ]; then echo 'MAX_BOT_TOKEN не задан — адаптер MAX не запущен. Задайте токен в .env и перезапустите: docker compose up -d max-adapter'; exec tail -f /dev/null; fi; exec node max-adapter.mjs"]
