# Rackrate bots (publishers, keeper, market maker). Build from the repository root:
#   docker build -f bots/Dockerfile -t rackrate-bots .
# On Railway one service runs every bot with `node src/all.ts` (see README, "Hosting").
FROM node:26-slim
WORKDIR /repo
COPY bots/package.json bots/
RUN cd bots && npm install --omit=dev --no-audit --no-fund
COPY bots/src bots/src
COPY contracts/deployments contracts/deployments
COPY app/src/lib/generated.ts app/src/lib/generated.ts
# generated.ts is an ES module; its package isn't copied, so mark the folder as ESM.
RUN printf '{"type":"module"}\n' > app/package.json
WORKDIR /repo/bots
ENV NODE_ENV=production
CMD ["node", "src/settlement.ts"]
