# syntax=docker/dockerfile:1.19.0@sha256:b6afd42430b15f2d2a4c5a02b919e98a525b785b1aaff16747d2f623364e39b6

FROM node:24.18.1-bookworm-slim@sha256:235600a8101ab264e117b1768e925532262668dc9b581ef1dd7d96ced463b8e7 AS foreman-toolchain

ARG SOURCE_DATE_EPOCH
ENV LANG=C.UTF-8 \
    LC_ALL=C.UTF-8 \
    SOURCE_DATE_EPOCH=${SOURCE_DATE_EPOCH}

RUN test -n "${SOURCE_DATE_EPOCH}" \
    && case "${SOURCE_DATE_EPOCH}" in *[!0-9]*) exit 1;; esac \
    && apt-get update \
    && apt-get install -y --no-install-recommends \
      bash=5.2.15-2+b13 \
      ca-certificates=20250419~deb12u1 \
      curl=7.88.1-10+deb12u15 \
      git=1:2.39.5-0+deb12u3 \
      gosu=1.14-1+b10 \
      ipset=7.17-1 \
      iptables=1.8.9-2 \
      jq=1.6-2.1+deb12u2 \
      openssh-client=1:9.2p1-2+deb12u10 \
      python3=3.11.2-1+b1 \
      python3-pip=23.0.1+dfsg-1 \
      tini=0.19.0-1+b3 \
    && rm -rf /var/lib/apt/lists/*

COPY containers/appliance/vendor-cli/package.json containers/appliance/vendor-cli/package-lock.json /opt/vendor-cli/
RUN npm ci --omit=dev --prefix /opt/vendor-cli \
    && GROK_HOME=/opt/grok node /opt/vendor-cli/node_modules/@xai-official/grok/bin/postinstall.js \
    && test -x /opt/grok/bin/grok \
    && ln -s /opt/vendor-cli/node_modules/.bin/codex /usr/local/bin/codex \
    && ln -s /opt/grok/bin/grok /usr/local/bin/grok \
    && npm cache clean --force

COPY containers/appliance/graphify-requirements.txt /opt/foreman/graphify-requirements.txt
RUN python3 -m pip install \
      --break-system-packages \
      --disable-pip-version-check \
      --no-cache-dir \
      --require-hashes \
      --requirement /opt/foreman/graphify-requirements.txt

FROM foreman-toolchain AS foreman-build
WORKDIR /src
COPY . /src
RUN npm ci \
    && npm run verify:appliance-lock \
    && npm run build

FROM foreman-toolchain AS foreman-control
ARG SOURCE_DATE_EPOCH
LABEL org.opencontainers.image.title="Foreman control appliance" \
      org.opencontainers.image.version="0.4.0" \
      org.opencontainers.image.created="${SOURCE_DATE_EPOCH}"
RUN groupadd --gid 10001 foreman \
    && useradd --uid 10001 --gid 10001 --no-create-home --home-dir /state --shell /usr/sbin/nologin foreman \
    && install -d -o 10001 -g 10001 -m 0755 /workspace /state /run/foreman /opt/foreman/bin /opt/foreman/skills
COPY --from=foreman-build --chown=0:0 /src/skills/foreman/runtime/ /opt/foreman/bin/
COPY --from=foreman-build --chown=0:0 /src/skills/ /opt/foreman/skills/
COPY --from=foreman-build --chown=0:0 /src/containers/appliance/lock.json /opt/foreman/appliance-lock.json
USER 10001:10001
WORKDIR /workspace
VOLUME ["/state"]
ENTRYPOINT ["/usr/bin/tini", "--", "node", "/opt/foreman/bin/dist/appliance-doctor.js"]
CMD ["doctor"]

FROM foreman-toolchain AS foreman-worker
RUN groupmod --new-name worker node \
    && usermod --login worker --home /home/worker --move-home node
ENV HOME=/home/worker
COPY sandbox/init-firewall.sh sandbox/entrypoint.sh /
RUN chmod 0755 /init-firewall.sh /entrypoint.sh
ENTRYPOINT ["/entrypoint.sh"]
