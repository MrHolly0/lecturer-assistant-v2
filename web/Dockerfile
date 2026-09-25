FROM node:22-alpine AS build
WORKDIR /workspace/web
ARG VITE_MAX_BOT_NAME=
ENV VITE_MAX_BOT_NAME=${VITE_MAX_BOT_NAME}
COPY web/package*.json ./
RUN npm ci
COPY openapi /workspace/openapi
COPY web /workspace/web
RUN npm run gen:api && npm run build

FROM nginx:1.27-alpine
COPY web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /workspace/web/dist /usr/share/nginx/html
