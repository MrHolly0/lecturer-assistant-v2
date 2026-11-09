ARG SERVICE_NODE_IMAGE=node:24-alpine@sha256:a34ab6d7f6f4813f4d0c5469d74685604b962fbdbf5793a7bc7b4998ecb867c8
FROM ${SERVICE_NODE_IMAGE}
WORKDIR /app
COPY services/package.json services/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY services/ ./
USER node
ENV NODE_ENV=production
EXPOSE 8091 8092 8094
CMD ["node", "realtime/index.mjs"]
