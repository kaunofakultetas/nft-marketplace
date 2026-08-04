############################################################
#  [*] Etherscan client — the one place that talks to
#      Etherscan
#
#  Every chain read the backend makes goes through this tool
#  class: the indexer's log scans and the wallet-holdings
#  lookups. One class owns the request plumbing (base URL,
#  chain id, API key, timeouts, error normalization, the
#  free-tier politeness pauses) so no other module ever
#  builds an Etherscan request by hand.
#
#  Why Etherscan and not an RPC provider: its logs API has
#  NO block-range cap, so any catch-up gap is one call —
#  the per-range eth_getLogs grind on free RPC tiers
#  (Alchemy: 10 blocks, Infura: 10,000) is what exhausted
#  this project's credits under graph-node.
#
#  Used by:
#    - app/marketplace/indexer.py — get_logs, block_number
#    - app/marketplace/ownership.py — token_nft_transfers
#    - app/marketplace/routes.py / main.py — construct the
#      shared instances
############################################################


import time

import requests

from main import ETHERSCAN_API_URL, SEPOLIA_CHAIN_ID, ETHERSCAN_API_KEY









############################################################
# hex_int
############################################################
#
# Etherscan encodes zero as a bare '0x' in some hex fields
# (logIndex of the first log in a block) — int(x, 16) would
# throw on it.
#
# Used by:
#   - EtherscanClient.block_number / get_logs (below)
#   - app/marketplace/indexer.py — log field decoding
############################################################

def hex_int(value):
    return int(value, 16) if len(value) > 2 else 0









############################################################
# EtherscanClient
############################################################
#
# One stateless instance per consumer — it holds only
# configuration, so instances are cheap and thread-safe.
# Methods in groups:
#
#   plumbing — _get
#   chain    — block_number, get_logs
#   wallet   — token_nft_transfers
#
# Used by:
#   - main.py — the indexer's instance (startup STEP 3)
#   - routes.py — the wallet-holdings instance
############################################################

class EtherscanClient:






    ############################################################
    # _get
    ############################################################
    #
    # One Etherscan V2 API call with the shared identity
    # params. Raises on transport errors — callers decide what
    # a payload-level error means for their action, because
    # Etherscan reports "no results" as an error-shaped
    # response.
    #
    # Used by:
    #   - every public method (below)
    ############################################################

    def _get(self, params):
        response = requests.get(ETHERSCAN_API_URL, params={
            'chainid': SEPOLIA_CHAIN_ID,
            'apikey': ETHERSCAN_API_KEY,
            **params,
        }, timeout=30)
        response.raise_for_status()
        return response.json()






    ############################################################
    # block_number
    ############################################################
    #
    # The current chain tip as an int (proxy eth_blockNumber).
    #
    # Used by:
    #   - indexer.py — every poll iteration
    ############################################################

    def block_number(self):
        return hex_int(self._get({
            'module': 'proxy',
            'action': 'eth_blockNumber',
        })['result'])






    ############################################################
    # contract_creation
    ############################################################
    #
    # The block and unix time a contract was deployed in —
    # the block is the natural start of any event scan (no
    # start block is ever configured by hand), the time feeds
    # the About page. Etherscan returns these as DECIMAL
    # strings here, unlike its hex proxy responses.
    #
    # Used by:
    #   - indexer.py — first run, when no LastScannedBlock
    #     is stored yet
    #   - routes.py — the deployment facts in /api/stats
    ############################################################

    def contract_creation(self, address):
        payload = self._get({
            'module': 'contract',
            'action': 'getcontractcreation',
            'contractaddresses': address,
        })

        result = payload.get('result')
        if payload.get('status') != '1' or not result:
            raise RuntimeError(f'Etherscan getcontractcreation error: {payload.get("message")} {result}')
        return {
            'block': int(result[0]['blockNumber']),
            'timestamp': int(result[0].get('timestamp') or result[0].get('timeStamp') or 0),
        }






    ############################################################
    # get_logs
    ############################################################
    #
    # Every log of a contract from from_block to the chain tip
    # — no range chunking, Etherscan does not cap the span.
    # Pages of 1000: after a full page the next request resumes
    # FROM THE LAST RETURNED BLOCK (not +1 — a block's logs can
    # straddle the page break; the caller's storage dedupes the
    # overlap). An empty history comes back as status 0 /
    # "No records found", which is a result, not an error.
    #
    # Used by:
    #   - indexer.py — backfill and every poll
    ############################################################

    def get_logs(self, address, from_block):
        logs = []

        while True:
            payload = self._get({
                'module': 'logs',
                'action': 'getLogs',
                'address': address,
                'fromBlock': from_block,
                'toBlock': 'latest',
                'page': 1,
                'offset': 1000,
            })

            result = payload.get('result') or []
            if payload.get('status') != '1':
                if 'No records found' in str(payload.get('message', '')) + str(result):
                    return logs
                raise RuntimeError(f'Etherscan getLogs error: {payload.get("message")} {result}')

            logs.extend(result)
            if len(result) < 1000:
                return logs

            from_block = hex_int(result[-1]['blockNumber'])
            time.sleep(0.25)   # free tier: 5 requests/second






    ############################################################
    # eth_call
    ############################################################
    #
    # One read-only contract call (proxy eth_call at the
    # latest block) — returns the raw hex result. Proxy
    # errors come back as an 'error' object rather than a
    # status field, hence the separate check.
    #
    # Used by:
    #   - pinner.py — tokenURI(tokenId) lookups
    ############################################################

    def eth_call(self, to, data):
        payload = self._get({
            'module': 'proxy',
            'action': 'eth_call',
            'to': to,
            'data': data,
            'tag': 'latest',
        })

        if 'error' in payload:
            raise RuntimeError(f'Etherscan eth_call error: {payload["error"]}')
        result = payload.get('result')
        if not isinstance(result, str) or not result.startswith('0x'):
            raise RuntimeError(f'Etherscan eth_call error: {payload.get("message")} {result}')
        return result






    ############################################################
    # token_nft_transfers
    ############################################################
    #
    # A wallet's full ERC-721 transfer history, oldest first
    # (sort=asc — the caller replays it, so order matters).
    # A fresh wallet is an empty list, not an error; anything
    # else error-shaped raises.
    #
    # Used by:
    #   - ownership.py — WalletHoldings refreshes
    ############################################################

    def token_nft_transfers(self, wallet_address):
        payload = self._get({
            'module': 'account',
            'action': 'tokennfttx',
            'address': wallet_address,
            'page': 1,
            'offset': 10000,
            'startblock': 0,
            'endblock': 99999999,
            'sort': 'asc',
        })

        if payload.get('status') != '1':
            if 'No transactions found' in str(payload.get('message', '')) + str(payload.get('result', '')):
                return []
            raise RuntimeError(
                f'Etherscan tokennfttx error: {payload.get("result") or payload.get("message")}'
            )

        return payload['result']
