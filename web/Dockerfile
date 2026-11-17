FROM node:22-alpine AS build
WORKDIR /workspace/web
ARG VITE_MAX_BOT_NAME=
ENV VITE_MAX_BOT_NAME=${VITE_MAX_BOT_NAME}
COPY web/package*.json ./
COPY web/vendor ./vendor
RUN npm ci
COPY openapi /workspace/openapi
COPY web /workspace/web
RUN npm run gen:api && npm run build

FROM nginx:1.30.6-alpine@sha256:901e593c95dc85f5a729f5765516321366ef4ac401821431d408897e95287d0a
COPY web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /workspace/web/dist /usr/share/nginx/html
