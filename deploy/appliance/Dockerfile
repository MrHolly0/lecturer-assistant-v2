ARG K3S_IMAGE=rancher/k3s:v1.35.10-k3s1@sha256:8262ca99a558dca0c0437443421986480b2359f9118f2371359f88a41514522f
FROM ${K3S_IMAGE} AS k3s
FROM python:3.12.14-slim@sha256:f77ac9e44ae96ef2c90b8053ea08c31f8be030f824196b0ae4db6d462c84e51f
RUN test -x /usr/bin/openssl && test -x /usr/bin/tar
COPY --from=k3s /bin/k3s /usr/local/bin/kubectl
WORKDIR /opt/lecturer
COPY deploy/appliance/download-platform.py /tmp/download-platform.py
RUN python3 /tmp/download-platform.py && rm /tmp/download-platform.py
COPY deploy/ deploy/
ENTRYPOINT ["python3", "deploy/appliance/control.py"]
CMD ["reconcile"]
