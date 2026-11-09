FROM node:22-alpine
WORKDIR /app
COPY services/package.json services/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY services/ ./
USER node
ENV NODE_ENV=production
EXPOSE 8091 8092 8094
CMD ["node", "realtime/index.mjs"]
