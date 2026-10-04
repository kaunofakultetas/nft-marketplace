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
#  the last known holdings instead of an error page. A wallet
#  nobody has asked for in a few minutes is forgotten: the
#  path takes any string a visitor types, and an entry per
#  string for the life of the process would only grow.
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

# How long a wallet nobody asks for keeps its entry — far
# past the refresh window, so the students still looking at
# their holdings keep the stale fallback through an Etherscan
# outage, since every ask restarts the clock.
FORGET_SECONDS = 5 * 60









############################################################
# WalletHoldings
############################################################
#
# One instance serves every wallet. Methods in groups:
#
#   setup  — __init__
#   serve  — get_nfts
#   upkeep — _forget_idle
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
        self._cache = {}   # wallet -> (fetched_at, asked_at, nfts)






    ############################################################
    # get_nfts
    ############################################################
    #
    # The wallet's current holdings as [{nftAddress, tokenId}]
    # (addresses lowercase). Serves the cache while it is
    # younger than REFRESH_SECONDS; on a failed refresh a
    # STALE cache still wins over an error — only a wallet
    # never seen before (or forgotten) propagates the
    # exception. Every ask restarts the wallet's forget clock
    # and lets the cache forget the wallets nobody asked for.
    # Two parallel first requests for one wallet may both
    # fetch; the second write wins and both return correct
    # data.
    #
    # Used by:
    #   - routes.py — GET /api/my-nfts/<wallet>
    ############################################################

    def get_nfts(self, wallet_address):
        wallet_address = wallet_address.lower()
        now = time.time()

        with self._lock:
            self._forget_idle(now)
            cached = self._cache.get(wallet_address)
            if cached:
                self._cache[wallet_address] = (cached[0], now, cached[2])
        if cached and now - cached[0] < REFRESH_SECONDS:
            return cached[2]


        try:
            transfers = self.etherscan.token_nft_transfers(wallet_address)
        except Exception:
            if cached:
                return cached[2]
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
            self._cache[wallet_address] = (time.time(), time.time(), nfts)
        return nfts






    ############################################################
    # _forget_idle
    ############################################################
    #
    # Drops every wallet nobody has asked for in FORGET_SECONDS.
    # Runs under the lock its caller holds. The map only ever
    # holds the wallets asked for in the last few minutes —
    # each one a successful Etherscan lookup, which the API's
    # rate limit paces — so walking it on every ask is cheap.
    #
    # Used by:
    #   - get_nfts (above)
    ############################################################

    def _forget_idle(self, now):
        idle = [wallet for wallet, entry in self._cache.items() if now - entry[1] >= FORGET_SECONDS]
        for wallet in idle:
            del self._cache[wallet]
