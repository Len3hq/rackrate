# Rackrate CRE publisher (oracle publisher A): runs the workflow simulation with real onchain writes once an hour.
# Build from the repository root:
#   docker build -f cre/Dockerfile -t rackrate-cre .
# Variables (see README, "Hosting"): CRE_MONAD_RPC_URL, CRE_PRICE_MASTER_SECRET, CRE_ETH_PRIVATE_KEY, and either
# CRE_API_KEY (needs CRE deploy access) or CRE_CREDENTIALS (a CLI login) with a volume at /root/.cre.
FROM oven/bun:1-debian
ARG CRE_VERSION=v1.36.0
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates gnupg tar \
  && rm -rf /var/lib/apt/lists/*
# Chainlink's installer checks the release's GPG signature before installing. The binary moves out of
# /root/.cre so a volume there (holding the login) doesn't hide it.
RUN curl -fsSL https://cre.chain.link/install.sh | bash -s -- "$CRE_VERSION" \
  && mv /root/.cre/bin/cre /usr/local/bin/cre && rm -rf /root/.cre

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
