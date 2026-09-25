FROM ghcr.io/grafana/xk6:1.4.14 AS build

RUN xk6 build v1.1.0 \
    --with github.com/phymbert/xk6-sse@v0.1.11 \
    --output /tmp/k6-sse

# Runtime image supplies CA certificates and the unprivileged k6 user. The binary
# itself is replaced by the reproducible v1.1.0 + xk6-sse v0.1.11 build above.
FROM grafana/k6:2.3.0
COPY --from=build /tmp/k6-sse /usr/bin/k6
ENTRYPOINT ["k6"]
