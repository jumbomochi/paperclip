FROM ghcr.io/astral-sh/uv:python3.13-bookworm-slim

# Install Node for MCP subprocess spawning + pnpm for workspace builds
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl gnupg \
 && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
 && apt-get install -y --no-install-recommends nodejs \
 && rm -rf /var/lib/apt/lists/* \
 && npm install -g pnpm@9 corepack

WORKDIR /app

# Python deps first (better cache hits)
COPY agents-runtime/pyproject.toml agents-runtime/uv.lock /app/agents-runtime/
RUN cd /app/agents-runtime && uv sync --frozen --no-dev

# Then the rest (TS sources for MCP spawning)
COPY . /app
RUN pnpm install --frozen-lockfile --prod=false \
 && pnpm --filter @paperclip/db build \
 && pnpm --filter @paperclip/shared build \
 && pnpm --filter './mcp/**' build

WORKDIR /app/agents-runtime
CMD ["uv", "run", "paperclip-agents", "serve"]
