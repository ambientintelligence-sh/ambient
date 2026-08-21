FROM node:22-slim

# Tools a coding worker is likely to reach for. Kept small on purpose.
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
     ca-certificates git ripgrep curl jq python3 \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json ./
RUN npm install --ignore-scripts --omit=dev --no-audit --no-fund
COPY entry.mjs ./

# Workers start in an empty scratch directory. Nothing from the host is mounted.
RUN mkdir -p /work && chown -R node:node /work /app
USER node
WORKDIR /work

ENTRYPOINT ["node", "/app/entry.mjs"]
