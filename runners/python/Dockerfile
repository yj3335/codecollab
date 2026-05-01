FROM python:3.11-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends gosu iptables tini \
  && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir matplotlib numpy pandas

RUN useradd --create-home --uid 1000 runner

WORKDIR /app

COPY entrypoint.sh /app/entrypoint.sh
COPY runner.py /app/runner.py

RUN chmod +x /app/entrypoint.sh

ENTRYPOINT ["/usr/bin/tini", "--", "/app/entrypoint.sh"]
