############################################################
#  [*] NFT pinner — the permanent archive daemon
#
#  A background thread that makes every NFT file that ever
#  touched the marketplace PERMANENT on our IPFS node. The
#  gateway only caches what someone happened to view, and
#  the original copy usually lives on a student's free
#  pinning account that will lapse — this daemon races that
#  clock: for every distinct token in Marketplace_Events it
#  resolves tokenURI on-chain, pins the metadata CID and the
#  image CID on the local kubo node (a pin fetches the full
#  content from the network and exempts it from GC forever),
#  and records everything in Pinned_Files.
#
#  Pinning is a TWO-RUNG ladder: the p2p network first, and
#  when no provider is dialable, the public gateway caches —
#  fetched as a verified CAR archive (hash-checked block by
#  block on import, so the bytes are cryptographically the
#  CID's no matter who served them). Files that once lived
#  on a lapsed free pin often survive only in those caches.
#
#  Non-IPFS URIs (arweave.net, plain https) cannot be pinned
#  — recorded as 'skipped'. Wrongly minted metadata (not
#  JSON, no 'image' field) is recorded as 'invalid' — the
#  GUI diagnoses the same tokens for the student. Content
#  BOTH worlds deny ends as 'unreachable' after
#  PIN_MAX_ATTEMPTS, so a loss is a database row, never
#  silent. Everything else retries every cycle.
#
#  "Forever" physically means: pinned blocks in the
#  ./_DATA/ipfs volume — back that directory up.
#
#  Used by:
#    - main.py — one instance, started at startup (STEP 3)
############################################################


import re
import json
import time
import threading

import requests

from app.database.db import get_db_connection
from main import IPFS_API_URL, PINNER_POLL_SECONDS, PIN_MAX_ATTEMPTS


# tokenURI(uint256) — the one ERC-721 read the pinner needs
TOKENURI_SELECTOR = '0xc87b56dd'


# When the p2p network cannot deliver a CID, these public
# gateway caches get one chance each per attempt — content
# that outlived its original pin often survives nowhere else
RESCUE_GATEWAYS = (
    'https://ipfs.io/ipfs/',
    'https://trustless-gateway.link/ipfs/',
    'https://dweb.link/ipfs/',
)









############################################################
# _decode_abi_string
############################################################
#
# An eth_call result for a string-returning function →
# Python str (ABI head/tail encoding: offset word, length
# word, UTF-8 bytes). Empty/short results (a contract
# without tokenURI) come back as ''.
#
# Used by:
#   - Pinner._resolve_token_uri (below)
############################################################

def _decode_abi_string(hex_result):
    raw = bytes.fromhex(hex_result[2:])
    if len(raw) < 64:
        return ''
    offset = int.from_bytes(raw[0:32], 'big')
    length = int.from_bytes(raw[offset:offset + 32], 'big')
    return raw[offset + 32:offset + 32 + length].decode('utf-8', errors='replace')









############################################################
# _extract_ipfs_path
############################################################
#
# Any known IPFS URI shape → the path under /ipfs/ (root CID
# plus an optional subpath, query strings dropped), or None
# for URIs that are not IPFS-addressed at all (arweave.net,
# plain https, data:). Three shapes exist in the wild — all
# three occur in THIS marketplace's real tokens:
#
#   ipfs://<cid>/<path>
#   https://<host>/ipfs/<cid>/<path>     (path gateways)
#   https://<cid>.ipfs.<host>/<path>     (subdomain gateways:
#                                         dweb.link & friends)
#
# The ROOT CID is what gets pinned — a recursive pin covers
# every subpath.
#
# Used by:
#   - Pinner._sync_token (below)
############################################################

def _extract_ipfs_path(uri):
    if not uri:
        return None

    subdomain = re.match(r'^https?://([a-z0-9]+)\.ipfs\.[^/?]+(/[^?]*)?', uri)

    if uri.startswith('ipfs://'):
        path = uri[len('ipfs://'):]
        if path.startswith('ipfs/'):
            path = path[len('ipfs/'):]
    elif '/ipfs/' in uri:
        path = uri.split('/ipfs/', 1)[1]
    elif subdomain:
        path = subdomain.group(1) + (subdomain.group(2) or '')
    else:
        return None

    path = path.split('?')[0].strip('/')
    return path or None









############################################################
# Pinner
############################################################
#
# One instance owns the archive. Methods in groups:
#
#   setup — __init__, start
#   loop  — _loop, _sync, _sync_token
#   chain — _resolve_token_uri
#   kubo  — _pin, _pin_direct, _rescue, _cat
#   state — _record
#
# Used by:
#   - main.py — Pinner(etherscan).start()
############################################################

class Pinner:






    ############################################################
    # __init__
    ############################################################
    #
    # etherscan is an EtherscanClient (tokenURI lookups); kubo
    # is reached over the isolated docker network at
    # IPFS_API_URL.
    #
    # Used by:
    #   - main.py — startup STEP 3
    ############################################################

    def __init__(self, etherscan):
        self.etherscan = etherscan






    ############################################################
    # start
    ############################################################
    #
    # Fires the daemon thread. daemon=True — the thread dies
    # with Flask, nothing to join on shutdown.
    #
    # Used by:
    #   - main.py — startup STEP 3
    ############################################################

    def start(self):
        threading.Thread(target=self._loop, daemon=True).start()






    ############################################################
    # _loop
    ############################################################
    #
    # The daemon body: one full sync per cycle. The first
    # cycle IS the retroactive backfill — it walks the whole
    # event history and pins everything still findable.
    #
    # Used by:
    #   - start (above) — thread target
    ############################################################

    def _loop(self):
        print('[pinner] starting', flush=True)

        while True:
            try:
                self._sync()
                time.sleep(PINNER_POLL_SECONDS)
            except Exception as error:
                print(f'[pinner] error: {error} — retrying in 30s', flush=True)
                time.sleep(30)






    ############################################################
    # _sync
    ############################################################
    #
    # Every distinct token the indexer has ever seen, checked
    # against the Pinned_Files state; only tokens with work
    # left (no row yet, or a 'pending' row) cost anything —
    # a fully-archived marketplace is one SQL query per cycle.
    #
    # Never-attempted tokens go FIRST: a failed pin blocks for
    # its full 45s timeout, and a handful of long-dead CIDs
    # retrying every cycle must not starve a student's
    # brand-new NFT of its race against the original pin
    # lapsing.
    #
    # Used by:
    #   - _loop (above)
    ############################################################

    def _sync(self):
        # The UNION keeps unfinished archive work alive across a
        # contract switch: reset_if_contract_changed wipes the
        # events table, but a previous era's still-pending pins
        # deserve their remaining retries
        with get_db_connection() as conn:
            tokens = conn.execute('''
                SELECT DISTINCT NftAddress, TokenId FROM Marketplace_Events
                UNION
                SELECT NftAddress, TokenId FROM Pinned_Files WHERE Status = 'pending'
            ''').fetchall()
            rows = conn.execute('SELECT * FROM Pinned_Files').fetchall()

        state = {(row['NftAddress'], row['TokenId'], row['Kind']): row for row in rows}

        # Fewest metadata attempts first — 0 for unseen tokens
        def attempts_so_far(token):
            meta = state.get((token['NftAddress'], token['TokenId'], 'metadata'))
            return meta['Attempts'] if meta else 0

        for token in sorted(tokens, key=attempts_so_far):
            self._sync_token(token['NftAddress'], token['TokenId'], state)






    ############################################################
    # _sync_token
    ############################################################
    #
    # One token through both stages. Stage 1: resolve tokenURI
    # and pin the METADATA root CID. Stage 2 (only once the
    # metadata is pinned, so the cat is a local read): parse
    # the metadata JSON and pin the IMAGE root CID. Each
    # stage's failures increment Attempts and flip to
    # 'unreachable' at the cap; early returns keep the happy
    # path readable.
    #
    # Used by:
    #   - _sync (above)
    ############################################################

    def _sync_token(self, nft_address, token_id, state):

        # Stage 1 — the metadata
        meta = state.get((nft_address, token_id, 'metadata'))
        if meta is None or meta['Status'] == 'pending':
            attempts = (meta['Attempts'] if meta else 0) + 1

            try:
                uri = self._resolve_token_uri(nft_address, token_id)
                meta_path = _extract_ipfs_path(uri)

                if meta_path is None:
                    self._record(nft_address, token_id, 'metadata', uri, None, 'skipped', attempts)
                    print(f'[pinner] skipped metadata of {nft_address}#{token_id}: not IPFS ({uri[:60]})', flush=True)
                    return

                root_cid = meta_path.split('/')[0]
                self._pin(root_cid)
                self._record(nft_address, token_id, 'metadata', uri, root_cid, 'pinned', attempts)
                print(f'[pinner] pinned metadata of {nft_address}#{token_id}: {root_cid}', flush=True)
                meta = {'Uri': uri, 'Status': 'pinned'}
            except Exception as error:
                status = 'unreachable' if attempts >= PIN_MAX_ATTEMPTS else 'pending'
                self._record(nft_address, token_id, 'metadata', '', None, status, attempts)
                if status == 'unreachable':
                    print(f'[pinner] gave up on metadata of {nft_address}#{token_id}: {error}', flush=True)
                return

        if meta['Status'] != 'pinned':
            return   # skipped / unreachable — the image is unknowable


        # Stage 2 — the image
        image = state.get((nft_address, token_id, 'image'))
        if image is not None and image['Status'] != 'pending':
            return
        attempts = (image['Attempts'] if image else 0) + 1

        try:
            raw = self._cat(_extract_ipfs_path(meta['Uri']))
        except Exception as error:
            status = 'unreachable' if attempts >= PIN_MAX_ATTEMPTS else 'pending'
            self._record(nft_address, token_id, 'image', '', None, status, attempts)
            if status == 'unreachable':
                print(f'[pinner] gave up on image of {nft_address}#{token_id}: {error}', flush=True)
            return

        # DIAGNOSE, don't repair (mirrors the GUI): metadata that
        # is not JSON, or lacks the standard 'image' field, is a
        # WRONGLY MINTED token — recorded as 'invalid' once, no
        # retries. The non-standard 'image_url' is deliberately
        # not honored.
        try:
            image_uri = json.loads(raw).get('image') or ''
        except ValueError:
            image_uri = ''

        if not image_uri:
            self._record(nft_address, token_id, 'image', '', None, 'invalid', attempts)
            print(f'[pinner] invalid metadata of {nft_address}#{token_id}: not JSON or no "image" field', flush=True)
            return

        image_path = _extract_ipfs_path(image_uri)
        if image_path is None:
            self._record(nft_address, token_id, 'image', image_uri, None, 'skipped', attempts)
            print(f'[pinner] skipped image of {nft_address}#{token_id}: not IPFS ({image_uri[:60]})', flush=True)
            return

        try:
            root_cid = image_path.split('/')[0]
            self._pin(root_cid)
            self._record(nft_address, token_id, 'image', image_uri, root_cid, 'pinned', attempts)
            print(f'[pinner] pinned image of {nft_address}#{token_id}: {root_cid}', flush=True)
        except Exception as error:
            status = 'unreachable' if attempts >= PIN_MAX_ATTEMPTS else 'pending'
            self._record(nft_address, token_id, 'image', image_uri, None, status, attempts)
            if status == 'unreachable':
                print(f'[pinner] gave up on image of {nft_address}#{token_id}: {error}', flush=True)






    ############################################################
    # _resolve_token_uri
    ############################################################
    #
    # tokenURI(tokenId) on the NFT contract, via the Etherscan
    # proxy. The politeness pause keeps a first backfill of
    # many tokens under Etherscan's 5 req/s.
    #
    # Used by:
    #   - _sync_token (above)
    ############################################################

    def _resolve_token_uri(self, nft_address, token_id):
        data = f'{TOKENURI_SELECTOR}{int(token_id):064x}'
        result = self.etherscan.eth_call(nft_address, data)
        time.sleep(0.25)

        uri = _decode_abi_string(result)
        if not uri:
            raise RuntimeError('empty tokenURI')
        return uri






    ############################################################
    # _pin
    ############################################################
    #
    # The two-rung ladder: the p2p network first, then the
    # public gateway caches (_rescue) — and a second direct
    # pin after a rescue, instant because the blocks are
    # local by then. Raises only when BOTH rungs fail.
    #
    # Used by:
    #   - _sync_token (above) — both stages
    ############################################################

    def _pin(self, cid):
        try:
            self._pin_direct(cid)
            return
        except Exception as network_error:
            gateway = self._rescue(cid)
            if gateway is None:
                raise network_error

        self._pin_direct(cid)
        print(f'[pinner] rescued {cid} from a gateway cache ({gateway})', flush=True)






    ############################################################
    # _pin_direct
    ############################################################
    #
    # Recursive pin on the local kubo node — kubo fetches the
    # full content from the network first, so this call BLOCKS
    # while content is being found; the 45s kubo-side timeout
    # turns "nobody has it right now" into a retryable error
    # instead of a stuck daemon.
    #
    # Used by:
    #   - _pin (above) — both rungs
    ############################################################

    def _pin_direct(self, cid):
        response = requests.post(f'{IPFS_API_URL}/pin/add', params={
            'arg': cid,
            'timeout': '45s',
        }, timeout=60)
        if not response.ok or 'Pins' not in response.json():
            raise RuntimeError(f'kubo pin/add failed: {response.text[:200]}')






    ############################################################
    # _rescue
    ############################################################
    #
    # Fetches the CID's complete CAR archive from public
    # gateway caches over HTTPS and imports it into kubo —
    # every block is hash-verified on import, so a lying or
    # corrupted gateway cannot poison the archive; the final
    # offline block-stat proves the content really landed.
    # Returns the winning gateway's host, or None when no
    # cache has the file either.
    #
    # Used by:
    #   - _pin (above) — the second rung
    ############################################################

    def _rescue(self, cid):
        for gateway in RESCUE_GATEWAYS:
            try:
                response = requests.get(gateway + cid, headers={
                    'Accept': 'application/vnd.ipld.car',
                }, timeout=25)
                if not response.ok or not response.content:
                    continue

                requests.post(f'{IPFS_API_URL}/dag/import',
                              files={'file': ('rescue.car', response.content)}, timeout=60)

                check = requests.post(f'{IPFS_API_URL}/block/stat', params={
                    'arg': cid,
                    'offline': 'true',
                }, timeout=10)
                if check.ok:
                    return gateway.split('/')[2]
            except Exception:
                continue
        return None






    ############################################################
    # _cat
    ############################################################
    #
    # Reads a file from the local node (only ever called after
    # its root is pinned, so this is a local disk read, not a
    # network fetch).
    #
    # Used by:
    #   - _sync_token (above) — metadata JSON parse
    ############################################################

    def _cat(self, ipfs_path):
        response = requests.post(f'{IPFS_API_URL}/cat', params={
            'arg': f'/ipfs/{ipfs_path}',
            'timeout': '30s',
        }, timeout=45)
        if not response.ok:
            raise RuntimeError(f'kubo cat failed: {response.text[:200]}')
        return response.content






    ############################################################
    # _record
    ############################################################
    #
    # Upserts one (token, kind) row — the UNIQUE constraint
    # makes INSERT OR REPLACE the whole state machine.
    #
    # Used by:
    #   - _sync_token (above) — every outcome
    ############################################################

    def _record(self, nft_address, token_id, kind, uri, cid, status, attempts):
        with get_db_connection() as conn:
            conn.execute('''
                INSERT OR REPLACE INTO Pinned_Files
                    (NftAddress, TokenId, Kind, Uri, Cid, Status, Attempts)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            ''', (nft_address, token_id, kind, uri, cid, status, attempts))
