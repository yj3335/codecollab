FROM node:20-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends gosu iptables tini \
  && rm -rf /var/lib/apt/lists/*

# node:20-slim already provides a `node` user with uid 1000. Alias it to
# `runner` for parity with the python runner so entrypoint.sh's `gosu runner`
# works without a hard-coded user name diff.
RUN userdel -r node 2>/dev/null || true \
  && useradd --create-home --uid 1000 runner

WORKDIR /app

COPY package.json /app/package.json
RUN npm install --omit=dev --no-audit --no-fund

COPY runner.js /app/runner.js
COPY entrypoint.sh /app/entrypoint.sh

RUN chmod +x /app/entrypoint.sh /app/runner.js

ENTRYPOINT ["/usr/bin/tini", "--", "/app/entrypoint.sh"]
