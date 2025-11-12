FROM node:21.7.3-alpine AS base

# BUILD ENV VARIABLES
ARG NEXT_PUBLIC_NFT_MARKETPLACE_ADDRESS
ARG NEXT_PUBLIC_PROJECT_ID
ARG NEXT_PUBLIC_RPC_URL
ARG NEXT_PUBLIC_ETHERSCAN_API_KEY
ARG NEXT_PUBLIC_GRAPH_URL
ARG NEXT_PUBLIC_IPFS_GATEWAY
ARG NEXT_PUBLIC_IPFS_TIMEOUT





####################################
###### Dependencies container ######
####################################
FROM base AS deps
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm install






####################################
######### Builder container ########
####################################
FROM base AS builder
WORKDIR /app

# Copy node_modules folder
COPY --from=deps /app/node_modules ./node_modules

# Copy all text/program files (excluding directories)
COPY *.json *.ts *.js *.mjs *.d.ts ./

# Copy source code and public directory
COPY src/ ./src/
COPY public/ ./public/

# Build
RUN npm run build






################################
##### Production container #####
################################
FROM base AS prod

WORKDIR /app
ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

RUN mkdir .next
RUN chown -R nextjs:nodejs .next

COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

ENV PORT=3000
EXPOSE 3000
CMD HOSTNAME="0.0.0.0" node server.js
# CMD ["sleep", "infinity"]
