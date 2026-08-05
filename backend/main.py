############################################################
#  [*] NFT Marketplace Backend — entrypoint & config API
#
#  The server side of the marketplace: it INDEXES the
#  NftMarketplace contract into SQLite (indexer.py), ARCHIVES
#  every NFT's files as permanent IPFS pins (pinner.py) and
#  SERVES everything the Vite GUI reads (routes.py). Every
#  setting comes from ENV VARS on the nft-backend compose
#  service — changing one takes a
#  `docker-compose up -d nft-backend`, never an image
#  rebuild.
#
#  Routes (the marketplace reads live in routes.py):
#    GET /api/config
#
#  The route modules import THIS module back for their
#  settings — that is why the blueprint imports sit inside
#  __main__: by the time they run, main is fully defined and
#  the circular import resolves cleanly.
#
#  Used by:
#    - app/marketplace/etherscan.py — the Etherscan settings
#    - app/marketplace/indexer.py — the contract address and
#      the indexer tuning knobs
#    - vite/app/src/config.js — GET /api/config before React
#      mounts
#    - Dockerfile — CMD ["python3", "-u", "main.py"]
############################################################


import os

from flask import Flask, jsonify
from werkzeug.middleware.proxy_fix import ProxyFix


app = Flask(__name__)









############################################################
# Settings — assembled from the compose environment
############################################################
#
# The first four env vars are REQUIRED — a missing one kills
# the boot with a precise error in the container logs
# instead of becoming a broken GUI later. Everything else
# has defaults and only needs a compose entry to override.
############################################################

_REQUIRED_ENV_VARS = (
    'NFT_MARKETPLACE_ADDRESS',
    'SEPOLIA_RPC_URL',
    'ETHERSCAN_API_KEY',
)

_missing = [name for name in _REQUIRED_ENV_VARS if not os.getenv(name)]
if _missing:
    raise SystemExit(
        f'Missing required environment variables: {", ".join(_missing)}'
    )

NFT_MARKETPLACE_ADDRESS = os.getenv('NFT_MARKETPLACE_ADDRESS')
SEPOLIA_RPC_URL = os.getenv('SEPOLIA_RPC_URL')
ETHERSCAN_API_KEY = os.getenv('ETHERSCAN_API_KEY')

# Etherscan V2: one domain for every chain, Sepolia =
# 11155111. ALL backend chain reads go through Etherscan —
# its logs API has no block-range cap, so indexing never
# touches the metered RPC providers. SEPOLIA_RPC_URL
# (Infura) is the UPSTREAM of the /api/rpc relay (routes.py)
# — the browser gets the relay path, never this URL, so the
# key stays server-side.
ETHERSCAN_API_URL = 'https://api.etherscan.io/v2/api'
SEPOLIA_CHAIN_ID = 11155111

# The marketplace contract's four events: the signature and
# the topic hash (keccak-256 of it) that raw logs carry.
# HARDCODED on purpose — the exact same hex lives in
# smart-contract/tests/EventSignatures.t.sol, where the test
# suite compares it against what the contract REALLY emits;
# matching the two files is a plain eyeball diff with no
# derivation to distrust. When an event changes, the suite
# goes red and prints the new hash — paste it here and there.
# The decode layout the indexer assumes: three indexed params
# (actor, nftAddress, tokenId); the data field holds price on
# Listed/Updated, (seller, price) on Bought, nothing on
# Canceled — see indexer._decode_log.
EVENT_TOPICS = {
    'Listed': {
        'signature': 'ItemListed(address,address,uint256,uint256)',
        'topic0': '0xd547e933094f12a9159076970143ebe73234e64480317844b0dcb36117116de4',
    },
    'Updated': {
        'signature': 'ItemUpdated(address,address,uint256,uint256)',
        'topic0': '0x3c33e65e8698294810b631d476d60b44425303828da0b1f8b635231bfda12be2',
    },
    'Bought': {
        'signature': 'ItemBought(address,address,uint256,address,uint256)',
        'topic0': '0x93c830507acd24c092e291f65f36eccf9df2be394d8b7a1802669761ff1ed995',
    },
    'Canceled': {
        'signature': 'ItemCanceled(address,address,uint256)',
        'topic0': '0x9ba1a3cb55ce8d63d072a886f94d2a744f50cddf82128e897d0661f5ec623158',
    },
}

# Indexer tuning: 30s staleness is invisible on a classroom
# marketplace and keeps the poll at ~6% of Etherscan's free
# daily quota. No start block here — the indexer discovers
# the contract's deployment block itself (etherscan.py's
# contract-creation lookup).
INDEXER_POLL_SECONDS = int(os.getenv('INDEXER_POLL_SECONDS', '30'))

# Pinner tuning: the kubo API over the isolated network; a
# token's files are pinned within a minute of its first
# marketplace event, and content nobody still hosts stops
# retrying after PIN_MAX_ATTEMPTS cycles
IPFS_API_URL = os.getenv('IPFS_API_URL', 'http://nft-ipfs:5001/api/v0')
PINNER_POLL_SECONDS = int(os.getenv('PINNER_POLL_SECONDS', '60'))
PIN_MAX_ATTEMPTS = int(os.getenv('PIN_MAX_ATTEMPTS', '20'))

# No secrets here: the Etherscan key stays server-side (the
# GUI reads ownership via /api/my-nfts) and the Infura key
# stays server-side too — the browser's chain reads go to
# the /api/rpc relay, a same-origin path
FRONTEND_CONFIG = {
    'nftMarketplaceAddress': NFT_MARKETPLACE_ADDRESS,
    'rpcUrl': '/api/rpc',
    'ipfsGateway': os.getenv('IPFS_GATEWAY', '/ipfs/'),
    'ipfsTimeout': int(os.getenv('IPFS_TIMEOUT', '10000')),
}









############################################################
# get_config
############################################################
#
# GET /api/config
#
# The Vite GUI's runtime configuration as one JSON object —
# contract address, RPC/Etherscan endpoints and the
# same-origin subgraph/IPFS paths. Everything in it ends up
# in the browser, so nothing here is secret — treat it as
# public.
#
# Used by:
#   - vite/app/src/config.js — loadConfig() before React
#     mounts
############################################################

@app.route('/api/config', methods=['GET'])
def get_config():
    return jsonify(FRONTEND_CONFIG)









############################################################
# Entrypoint
############################################################
#
# Wires the whole backend when run directly: schema, the
# marketplace blueprint, the indexer daemon, then the dev
# server. Debug mode means hot reload AND the Werkzeug
# debugger — never expose it publicly.
############################################################

if __name__ == '__main__':
    APP_DEBUG = os.getenv('APP_DEBUG', 'false').lower() == 'true'


    # STEP 1: the SQLite schema (idempotent).
    # =======================================
    from app.database.db_init import init_db
    init_db()



    # STEP 2: ProxyFix for correct IP address detection.
    # ==================================================
    app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1, x_prefix=1)



    # STEP 2: the marketplace read API.
    # =================================
    from app.marketplace.routes import bp_marketplace
    app.register_blueprint(bp_marketplace, url_prefix='')



    # STEP 3: the daemons — the indexer (chain → SQLite) and the
    # pinner (NFT files → permanent IPFS pins). In debug mode
    # Werkzeug runs TWO processes (reloader parent + serving child)
    # — the guard starts the threads only in the child, or exactly
    # once without debug.
    # ==============================================================
    if not APP_DEBUG or os.environ.get('WERKZEUG_RUN_MAIN') == 'true':
        from app.marketplace.etherscan import EtherscanClient
        from app.marketplace.indexer import MarketplaceIndexer, reset_if_contract_changed
        from app.marketplace.pinner import Pinner

        # A changed NFT_MARKETPLACE_ADDRESS wipes the derived
        # marketplace state BEFORE the daemons start — the pinned
        # archive survives every contract generation
        reset_if_contract_changed()

        etherscan = EtherscanClient()
        MarketplaceIndexer(etherscan).start()
        Pinner(etherscan).start()



    # STEP 4: the dev server.
    # =======================
    app.run(host='0.0.0.0', port=8000, debug=APP_DEBUG)
