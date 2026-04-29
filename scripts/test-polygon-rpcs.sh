#!/usr/bin/env bash
URLS=(
  "https://polygon-bor-rpc.publicnode.com"
  "https://polygon.llamarpc.com"
  "https://polygon-mainnet.public.blastapi.io"
  "https://1rpc.io/matic"
  "https://rpc.ankr.com/polygon"
  "https://polygon-rpc.thirdweb.com"
  "https://polygon.drpc.org"
)
PAYLOAD='{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'
for url in "${URLS[@]}"; do
  printf "=== %s\n" "$url"
  curl -s -m 8 -X POST -H 'Content-Type: application/json' -d "$PAYLOAD" "$url" | head -c 200
  printf "\n"
done
