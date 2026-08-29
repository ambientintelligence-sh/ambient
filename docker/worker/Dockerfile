FROM node:22-slim

# Tools a coding worker is likely to reach for. Kept small on purpose.
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
     ca-certificates git ripgrep curl jq zip unzip sqlite3 chromium \
     python3 python3-venv python3-pip build-essential \
  && rm -rf /var/lib/apt/lists/*

# A practical Python workbench for data, documents, APIs, testing, and small web
# services. Keep it in a writable venv so workers can add uncommon packages.
RUN python3 -m venv /opt/pyenv \
  && /opt/pyenv/bin/pip install --no-cache-dir --upgrade pip setuptools wheel \
  && /opt/pyenv/bin/pip install --no-cache-dir \
     requests httpx aiohttp beautifulsoup4 lxml \
     numpy pandas polars scipy scikit-learn \
     openpyxl xlsxwriter python-docx python-pptx PyPDF2 pillow \
     matplotlib seaborn \
     pydantic fastapi flask uvicorn sqlalchemy \
     pyyaml python-dateutil jinja2 cryptography boto3 \
     pytest pytest-asyncio ruff mypy rich tabulate \
  && chown -R node:node /opt/pyenv
ENV PATH="/opt/pyenv/bin:${PATH}" \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PYTHONDONTWRITEBYTECODE=1

WORKDIR /app
COPY package.json ./
RUN npm install --ignore-scripts --omit=dev --no-audit --no-fund
COPY entry.mjs exa-tool.mjs show-widget-tool.mjs mcp-extension.ts ./

# Workers start in an empty scratch directory. Nothing from the host is mounted.
RUN mkdir -p /work && chown -R node:node /work /app
USER node
WORKDIR /work

ENTRYPOINT ["node", "/app/entry.mjs"]
