FROM node:21.7.3-alpine

# Install necessary tools
RUN apk add --no-cache curl bash

WORKDIR /app

# Copy package files
COPY package.json yarn.lock* package-lock.json* ./

# Install dependencies
RUN if [ -f yarn.lock ]; then yarn install --frozen-lockfile; \
    elif [ -f package-lock.json ]; then npm ci; \
    else npm install; fi

# Copy source files
COPY . .

# Build arguments for configuration
ARG GRAPH_NODE_URL=http://nft-graph-node:8020
ARG IPFS_URL=http://nft-ipfs:5001
ARG SUBGRAPH_NAME=nftmarketplace

# Set as environment variables
ENV GRAPH_NODE_URL=${GRAPH_NODE_URL}
ENV IPFS_URL=${IPFS_URL}
ENV SUBGRAPH_NAME=${SUBGRAPH_NAME}

# Generate code and build
RUN npm run codegen && npm run build

# Deployment script
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

ENTRYPOINT ["/docker-entrypoint.sh"]