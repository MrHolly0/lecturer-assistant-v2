# Адаптер MAX: Node 24 без внешних зависимостей (только стандартная библиотека),
# поэтому ни package.json, ни npm install не нужны. Контекст сборки — корень репозитория.
ARG SERVICE_NODE_IMAGE=node:24-alpine@sha256:a34ab6d7f6f4813f4d0c5469d74685604b962fbdbf5793a7bc7b4998ecb867c8
FROM ${SERVICE_NODE_IMAGE}
WORKDIR /app
COPY adapters/max/inbox-admin.mjs adapters/max/inbox-snapshot.mjs adapters/max/inbox.mjs adapters/max/lib.mjs adapters/max/document-media.mjs adapters/max/max-adapter.mjs ./

# Сертификат platform-api2.max.ru выдан Russian Trusted Sub CA (Минцифры), корня которого
# нет в хранилище Node: без него любой запрос к MAX API падает с
# UNABLE_TO_GET_ISSUER_CERT_LOCALLY. Корень добавляется только этому процессу.
# Источник: https://gu-st.ru/content/lending/russian_trusted_root_ca_pem.crt,
# SHA-256 D2:6D:2D:02:31:B7:C3:9F:92:CC:73:85:12:BA:54:10:35:19:E4:40:5D:68:B5:BD:70:3E:97:88:CA:8E:CF:31
COPY deploy/certs/russian_trusted_root_ca.pem /etc/ssl/max/russian_trusted_root_ca.pem
ENV NODE_EXTRA_CA_CERTS=/etc/ssl/max/russian_trusted_root_ca.pem

RUN mkdir -p /data/max-inbox && chown node:node /data/max-inbox
USER node
# Порт вебхука; наружу его публикует только Caddy на стенде.
EXPOSE 8090
# Без токена бота адаптер не запускается, а не падает в цикл перезапусков: локальный
# `docker compose up` без кабинета MAX должен поднимать остальной продукт.
CMD ["sh", "-c", "if [ -z \"$MAX_BOT_TOKEN\" ]; then echo 'MAX_BOT_TOKEN не задан — адаптер MAX не запущен. Задайте токен в .env и перезапустите: docker compose up -d max-adapter'; exec tail -f /dev/null; fi; exec node max-adapter.mjs"]
