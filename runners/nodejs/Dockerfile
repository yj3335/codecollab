FROM node:20-slim

WORKDIR /app

RUN useradd --create-home --uid 1000 runner
USER 1000

CMD ["node", "--version"]
