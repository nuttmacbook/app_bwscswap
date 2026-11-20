# bridge-signer on Railway (or any Docker host). Build from the REPO ROOT, not this folder:
#   docker build -f bridge-signer/Dockerfile .
# Railway: Variables → RAILWAY_DOCKERFILE_PATH=bridge-signer/Dockerfile (Root Directory empty, no build/start command).
# Secrets come from the host's variables (SIGNER_PRIVATE_KEY, RELAYER_PRIVATE_KEY …), never from a file in the image.

FROM node:20-slim

WORKDIR /app

# Only what the signer needs: its code, the wallet library, and the website's settings (chains, node, bridges)
COPY vendor/bwscbox ./vendor/bwscbox
COPY settings/config.js ./settings/config.js
COPY bridge-signer/package.json ./bridge-signer/package.json
RUN cd bridge-signer && npm install --omit=dev --no-audit --no-fund
COPY bridge-signer/src ./bridge-signer/src

WORKDIR /app/bridge-signer

# The signer looks for a .env file; on Railway the values come from Variables instead (they win over the file)
RUN touch .env

ENV NODE_ENV=production
CMD ["node", "src/main.mjs"]
