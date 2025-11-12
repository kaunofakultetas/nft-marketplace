#!/bin/bash
set -e

echo "Waiting for Graph Node to be ready..."
until curl -s "${GRAPH_NODE_URL}" > /dev/null 2>&1; do
  echo "Graph Node not ready yet, waiting..."
  sleep 5
done
echo "Graph Node is ready!"

echo "Waiting for IPFS to be ready..."
until curl -s "${IPFS_URL}/api/v0/version" > /dev/null 2>&1; do
  echo "IPFS not ready yet, waiting..."
  sleep 5
done
echo "IPFS is ready!"

echo "Creating subgraph: ${SUBGRAPH_NAME}..."
npx graph create --node "${GRAPH_NODE_URL}" "${SUBGRAPH_NAME}" || echo "Subgraph may already exist, continuing..."

echo "Deploying subgraph: ${SUBGRAPH_NAME}..."
npx graph deploy \
  --node "${GRAPH_NODE_URL}" \
  --ipfs "${IPFS_URL}" \
  --version-label v1.0.0 \
  "${SUBGRAPH_NAME}"

echo "Subgraph deployed successfully!"
echo "GraphQL endpoint: http://nft-graph-node:8000/subgraphs/name/${SUBGRAPH_NAME}"