# First Stage: builder
FROM --platform=linux/amd64 rust:1.92-bookworm AS builder

ENV APP_PATH=/app 

WORKDIR ${APP_PATH}

RUN apt-get update && apt-get install -y --no-install-recommends \
    libssl-dev \
    pkg-config

# Cache dependencies
# Only copy Cargo files, which should change less frequently than source code
COPY Cargo.toml Cargo.lock ${APP_PATH}

# Now copy the actual source code
COPY . ${APP_PATH}

# Install Anvil
RUN git clone --depth 1 https://github.com/foundry-rs/foundry.git /tmp/foundry && \
    cd /tmp/foundry && \
    cargo build --release --bin anvil && \
    mv target/release/anvil /usr/local/bin/anvil && \
    chmod +x /usr/local/bin/anvil

# Build the actual application
RUN cargo build --release

# Second Stage: Execution
FROM --platform=linux/amd64 debian:bookworm-slim as execution

RUN apt-get update && apt-get install -y --no-install-recommends \
    tini \
    libssl-dev \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*
    
# Add a non-root user for security
RUN addgroup --gid 10001 --system nonroot \
  && adduser --uid 10000 --system --ingroup nonroot --home /home/nonroot nonroot

WORKDIR /home/nonroot

# Copy the built binary from the builder stage
COPY --from=builder /app/target/release/token-storage-detection /usr/local/bin/token-storage-detection
COPY --from=builder /usr/local/bin/anvil /usr/local/bin/anvil
COPY . .

USER nonroot

# Use tini as the entrypoint
ENTRYPOINT ["/usr/bin/tini", "--"]

# Default command to run the app
CMD ["/usr/local/bin/token-storage-detection"]