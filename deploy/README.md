# Deploy

Phase 0 provides compose skeletons only:

- `docker-compose.yml` starts `postgres`, `core`, and the web placeholder.
- `docker-compose.dev.yml --profile hot-reload` starts source-mounted dev services.
- `docker-compose.prod.yml --profile prod` adds Caddy, Prometheus, Grafana, and a converter placeholder.
- `docker-compose.standalone.yml --profile standalone` marks local offline mode.
- `docker-compose.tunnel.yml --profile tunnel` adds cloudflared.

Real tokens stay outside the repository. Use `.env.example` as the shape of local configuration.

