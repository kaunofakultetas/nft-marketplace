############################################################
#  [*] Marketplace API — what the Vite GUI reads
#
#  Every read the GUI needs. Three routes serve straight
#  from the indexer's SQLite tables; the fourth serves
#  wallet holdings through the WalletHoldings cache
#  (ownership.py). The handlers stay thin — the classes own
#  the logic.
#
#    GET  /api/stats                           — marketplace totals + indexer position
#    GET  /api/listings                        — active listings
#    GET  /api/activity?limit=N                — unified event feed, newest first
#    GET  /api/nft/<nftAddress>/<tokenId>      — one token: listing + history + archive
#    GET  /api/my-nfts/<walletAddress>         — tokens the wallet holds
#    POST /api/rpc                             — JSON-RPC relay to Infura
#
#  All addresses in and out are lowercase — the tables store
#  lowercase and the routes lowercase their path params.
#
#  Used by:
#    - main.py — blueprint registration (STEP 2)
#    - vite/app/src/pages/* — via utils/api.js
#    - the browser's wagmi/ethers providers — /api/rpc
############################################################


import requests

from flask import Blueprint, jsonify, request, Response

from app.database.db import get_db_connection
from app.marketplace.etherscan import EtherscanClient
from app.marketplace.ownership import WalletHoldings
from main import SEPOLIA_RPC_URL, NFT_MARKETPLACE_ADDRESS, SEPOLIA_CHAIN_ID, EVENT_TOPICS


bp_marketplace = Blueprint('marketplace', __name__)

etherscan = EtherscanClient()
wallet_holdings = WalletHoldings(etherscan)

# The deployment facts never change — fetched from Etherscan
# once per process, lazily, so a hiccup only delays them
_deployment = None









############################################################
# get_stats
############################################################
#
# GET /api/stats
#
# The marketplace at a glance — floor price, listing/sale
# counts, lifetime volume — plus the TECHNICAL vitals the
# GUI shows on purpose: network, contract address, the block
# the indexer has scanned to, total indexed events and the
# IPFS archive's per-status counts. Amounts are wei strings
# — the GUI formats them.
#
# Used by:
#   - pages/Home — the stats bar
#   - pages/About — the whole instance description
############################################################

@bp_marketplace.route('/api/stats', methods=['GET'])
def get_stats():
    global _deployment
    if _deployment is None:
        try:
            _deployment = etherscan.contract_creation(NFT_MARKETPLACE_ADDRESS)
        except Exception:
            _deployment = None

    with get_db_connection() as conn:
        active = conn.execute('SELECT Price FROM Marketplace_ActiveListings').fetchall()
        sales = conn.execute("SELECT Price FROM Marketplace_Events WHERE EventType = 'Bought'").fetchall()
        row = conn.execute("SELECT Value FROM Indexer_State WHERE Key = 'LastScannedBlock'").fetchone()
        scanned_at = conn.execute("SELECT Value FROM Indexer_State WHERE Key = 'LastScannedAt'").fetchone()
        events_total = conn.execute('SELECT COUNT(*) FROM Marketplace_Events').fetchone()[0]
        archive = conn.execute('SELECT Status, COUNT(*) n FROM Pinned_Files GROUP BY Status').fetchall()

    # Prices are uint256 wei — summed in Python, never in SQL,
    # where they would overflow or lose precision
    listing_prices = [int(r['Price']) for r in active]
    volume = sum(int(r['Price']) for r in sales if r['Price'])

    return jsonify({
        'network': 'Sepolia',
        'chainId': SEPOLIA_CHAIN_ID,
        'marketplaceAddress': NFT_MARKETPLACE_ADDRESS.lower(),
        'deploymentBlock': _deployment['block'] if _deployment else None,
        'deployedAt': _deployment['timestamp'] if _deployment else None,
        'lastScannedBlock': int(row['Value']) if row else None,
        'lastScannedAt': int(scanned_at['Value']) if scanned_at else None,
        'totalEvents': events_total,
        'activeListings': len(listing_prices),
        'totalSales': len(sales),
        'totalVolumeWei': str(volume),
        'floorPriceWei': str(min(listing_prices)) if listing_prices else None,
        'archive': {r['Status']: r['n'] for r in archive},
        'eventTopics': EVENT_TOPICS,
    })









############################################################
# get_listings
############################################################
#
# GET /api/listings
#
# Every currently-active listing, newest first. This IS the
# storefront — the rows of Marketplace_ActiveListings after
# the event replay.
#
# Used by:
#   - pages/Home — the "NFTs For Sale" grid
#   - pages/MyNfts — price/seller badge per owned NFT
############################################################

@bp_marketplace.route('/api/listings', methods=['GET'])
def get_listings():
    with get_db_connection() as conn:
        rows = conn.execute('''
            SELECT NftAddress, TokenId, Seller, Price
            FROM Marketplace_ActiveListings
            ORDER BY ListedBlock DESC
        ''').fetchall()

    return jsonify({'listings': [
        {
            'nftAddress': row['NftAddress'],
            'tokenId': row['TokenId'],
            'seller': row['Seller'],
            'price': row['Price'],
        }
        for row in rows
    ]})









############################################################
# get_activity
############################################################
#
# GET /api/activity?limit=N
#
# The marketplace's WHOLE story as one feed, newest first —
# every Listed/Bought/Canceled event with its actor, price,
# block time, block number and tx hash. One list instead of
# three: the GUI renders it as a real marketplace activity
# feed and filters client-side. limit defaults to 100,
# capped at 500.
#
# Used by:
#   - pages/History — the activity feed
############################################################

@bp_marketplace.route('/api/activity', methods=['GET'])
def get_activity():
    limit = min(int(request.args.get('limit', 100)), 500)

    with get_db_connection() as conn:
        rows = conn.execute('''
            SELECT EventType, NftAddress, TokenId, Seller, Buyer, Price, BlockNumber, Timestamp, TxHash
            FROM Marketplace_Events
            ORDER BY Id DESC LIMIT ?
        ''', (limit,)).fetchall()

    return jsonify({'activity': [
        {
            'type': row['EventType'],
            'nftAddress': row['NftAddress'],
            'tokenId': row['TokenId'],
            'seller': row['Seller'],
            'buyer': row['Buyer'],
            'price': row['Price'],
            'blockNumber': row['BlockNumber'],
            'timestamp': row['Timestamp'],
            'txHash': row['TxHash'],
        }
        for row in rows
    ]})









############################################################
# get_nft
############################################################
#
# GET /api/nft/<nftAddress>/<tokenId>
#
# Everything the backend knows about ONE token: its active
# listing (null when not for sale), its full event history
# as ONE chronological list — NEWEST FIRST, the way the
# detail page renders it — and its IPFS ARCHIVE state (the
# pinner's per-file status, shown so students see the course
# node preserving their files).
#
# Used by:
#   - pages/NftDetail — price, actions, history, archive
############################################################

@bp_marketplace.route('/api/nft/<nft_address>/<token_id>', methods=['GET'])
def get_nft(nft_address, token_id):
    nft_address = nft_address.lower()

    with get_db_connection() as conn:
        listing = conn.execute('''
            SELECT Seller, Price FROM Marketplace_ActiveListings
            WHERE NftAddress = ? AND TokenId = ?
        ''', (nft_address, token_id)).fetchone()

        events = conn.execute('''
            SELECT EventType, Seller, Buyer, Price, BlockNumber, Timestamp, TxHash FROM Marketplace_Events
            WHERE NftAddress = ? AND TokenId = ?
            ORDER BY Id DESC
        ''', (nft_address, token_id)).fetchall()

        pins = conn.execute('''
            SELECT Kind, Cid, Status FROM Pinned_Files
            WHERE NftAddress = ? AND TokenId = ?
        ''', (nft_address, token_id)).fetchall()

    return jsonify({
        'activeListing': {
            'seller': listing['Seller'],
            'price': listing['Price'],
        } if listing else None,
        'events': [
            {
                'type': row['EventType'],
                'seller': row['Seller'],
                'buyer': row['Buyer'],
                'price': row['Price'],
                'blockNumber': row['BlockNumber'],
                'timestamp': row['Timestamp'],
                'txHash': row['TxHash'],
            }
            for row in events
        ],
        'archive': [
            {'kind': row['Kind'], 'cid': row['Cid'], 'status': row['Status']}
            for row in pins
        ],
    })









############################################################
# get_my_nfts
############################################################
#
# GET /api/my-nfts/<walletAddress>
#
# The tokens the wallet currently holds, served through the
# WalletHoldings cache — one Etherscan call per wallet per
# refresh window, the browser never sees the API key. A
# fresh wallet is an empty list; a failing Etherscan with no
# cached fallback is 502.
#
# Used by:
#   - pages/MyNfts — the wallet's NFT grid
############################################################

@bp_marketplace.route('/api/my-nfts/<wallet_address>', methods=['GET'])
def get_my_nfts(wallet_address):
    try:
        return jsonify({'nfts': wallet_holdings.get_nfts(wallet_address)})
    except Exception as error:
        return jsonify({'error': f'Etherscan request failed: {error}'}), 502









############################################################
# rpc_proxy
############################################################
#
# POST /api/rpc
#
# A transparent JSON-RPC relay to SEPOLIA_RPC_URL (Infura):
# the raw
# request body is forwarded untouched — single calls and
# batch arrays alike — and the upstream answer comes back
# verbatim. The browser only ever sees /api/rpc, so the
# Infura key never leaves the server, and the endpoint's
# password gate means only logged-in students can spend the
# quota. Wallet WRITES don't come through here — MetaMask
# signs and broadcasts over its own provider.
#
# Used by:
#   - main.jsx — the wagmi http transport
#   - pages/SellNft, pages/NftDetail — ethers JsonRpcProvider
############################################################

@bp_marketplace.route('/api/rpc', methods=['POST'])
def rpc_proxy():
    try:
        upstream = requests.post(
            SEPOLIA_RPC_URL,
            data=request.get_data(),
            headers={'Content-Type': 'application/json'},
            timeout=30,
        )
        return Response(upstream.content, status=upstream.status_code, mimetype='application/json')
    except Exception as error:
        return jsonify({'error': f'RPC relay failed: {error}'}), 502
