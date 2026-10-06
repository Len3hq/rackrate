# Rackrate CRE publisher (oracle publisher A): runs the workflow simulation with real onchain writes once an hour.
# Build from the repository root:
#   docker build -f cre/Dockerfile -t rackrate-cre .
# Variables (see README, "Hosting"): CRE_API_KEY, CRE_MONAD_RPC_URL, CRE_PRICE_MASTER_SECRET, CRE_ETH_PRIVATE_KEY.
FROM oven/bun:1-debian
ARG CRE_VERSION=v1.36.0
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates gnupg tar \
  && rm -rf /var/lib/apt/lists/*
# Chainlink's installer checks the release's GPG signature before installing.
RUN curl -fsSL https://cre.chain.link/install.sh | bash -s -- "$CRE_VERSION"
ENV PATH="/root/.cre/bin:$PATH"

WORKDIR /repo
COPY cre/price-publisher/package.json cre/price-publisher/bun.lock cre/price-publisher/
RUN cd cre/price-publisher && bun install --frozen-lockfile && bunx cre-setup
COPY cre/project.yaml cre/secrets.yaml cre/
COPY cre/scripts cre/scripts
COPY cre/price-publisher cre/price-publisher
# The workflow shares the bots' price model; it resolves viem from the workflow's own packages.
COPY bots/src/lib/priceModel.ts bots/src/lib/priceModel.ts
RUN ln -s /repo/cre/price-publisher/node_modules bots/node_modules

WORKDIR /repo/cre
CMD ["bash", "scripts/run.sh", "loop"]
