############################################################
#  [*] Wallet holdings — cached NFT ownership lookups
#
#  Which ERC-721 tokens a wallet CURRENTLY holds, rebuilt by
#  replaying its full transfer history from Etherscan
#  (sort=asc, so the last transfer per token decides
#  ownership). Ownership of arbitrary NFT contracts is not
#  something our single-contract event log can know — this
#  is the one marketplace read that cannot come from the
#  indexer's SQLite.
#
#  Results are cached per wallet for a refresh window, so a
#  classroom of students refreshing "My NFTs" costs one
#  Etherscan call per wallet per window instead of one per
#  page view — and an Etherscan outage degrades to serving
#  the last known holdings instead of an error page.
#
#  Deliberately in-memory: the cache resets on restart,
#  which is fine for a 60-second window. (Like the faucet's
#  cooldown table, this makes the backend single-process by
#  design.)
#
#  Used by:
#    - app/marketplace/routes.py — GET /api/my-nfts/<wallet>
############################################################


import time
import threading


# How long a wallet's holdings are served from cache. Fresh
# mints/trades show up within a minute — acceptable staleness
# for a page students refresh out of curiosity, and two
# orders of magnitude fewer Etherscan calls.
REFRESH_SECONDS = 60









############################################################
# WalletHoldings
############################################################
#
# One instance serves every wallet. Methods in groups:
#
#   setup — __init__
#   serve — get_nfts
#
# Used by:
#   - routes.py — the single shared instance
############################################################

class WalletHoldings:






    ############################################################
    # __init__
    ############################################################
    #
    # etherscan is an EtherscanClient. The lock guards the
    # cache map only — never held during a fetch, so a slow
    # Etherscan response cannot stall other wallets' lookups.
    #
    # Used by:
    #   - routes.py — at import time, the single instance
    ############################################################

    def __init__(self, etherscan):
        self.etherscan = etherscan
        self._lock = threading.Lock()
        self._cache = {}   # wallet -> (fetched_at, nfts)






    ############################################################
    # get_nfts
    ############################################################
    #
    # The wallet's current holdings as [{nftAddress, tokenId}]
    # (addresses lowercase). Serves the cache while it is
    # younger than REFRESH_SECONDS; on a failed refresh a
    # STALE cache still wins over an error — only a wallet
    # never seen before propagates the exception. Two parallel
    # first requests for one wallet may both fetch; the second
    # write wins and both return correct data.
    #
    # Used by:
    #   - routes.py — GET /api/my-nfts/<wallet>
    ############################################################

    def get_nfts(self, wallet_address):
        wallet_address = wallet_address.lower()

        with self._lock:
            cached = self._cache.get(wallet_address)
        if cached and time.time() - cached[0] < REFRESH_SECONDS:
            return cached[1]


        try:
            transfers = self.etherscan.token_nft_transfers(wallet_address)
        except Exception:
            if cached:
                return cached[1]
            raise


        # Later transfers overwrite earlier ones (sort=asc), so the
        # map ends up holding each token's LAST movement
        ownership = {}
        for tx in transfers:
            key = (tx['contractAddress'].lower(), tx['tokenID'])
            ownership[key] = (tx['to'].lower() == wallet_address)

        nfts = [
            {'nftAddress': nft_address, 'tokenId': token_id}
            for (nft_address, token_id), owned in ownership.items() if owned
        ]

        with self._lock:
            self._cache[wallet_address] = (time.time(), nfts)
        return nfts
