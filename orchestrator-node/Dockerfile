FROM --platform=linux/amd64 oven/bun:1.2.9 AS builder

WORKDIR /home/builder/app

# Install dependencies
COPY package.json ./
COPY bun.lock ./
RUN bun install

# Copy source files and configuration
COPY tsconfig.json ./
COPY src/ ./src/

FROM --platform=linux/amd64 oven/bun:1.2.9 AS runtime

RUN addgroup --gid 10001 --system nonroot
RUN adduser  --uid 10000 --system --ingroup nonroot --home /home/nonroot nonroot

RUN apt-get update && apt-get install -y \
    tini \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /usr/src/app

COPY --from=builder /home/builder/app/ ./

USER nonroot

ENTRYPOINT ["/usr/bin/tini", "--"]

CMD ["bun", "run", "start"]