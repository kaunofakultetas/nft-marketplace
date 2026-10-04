############################################################
#  [*] Test helpers
#
#  Everything the test files share. Importing this module
#  FIRST is what makes the suite safe to run anywhere: it
#  puts a throwaway environment in place before main is ever
#  imported — a test marketplace address, an RPC URL and an
#  Etherscan key that are not real (shaped like the real ones,
#  so the leak tests mean something), and a DB_PATH pointing
#  at a scratch file, because app/database/db.py binds its
#  default path at import and in the running container that
#  default is the LIVE database. A late import is refused
#  loudly instead of silently testing against real data.
#
#  Then: the marketplace story the frontend suite's fixtures
#  tell, as the raw Etherscan logs the indexer reads; a
#  pure-Python Keccak-256 for checking event topic hashes
#  (the image carries no crypto library); a test-case base
#  class on a throwaway SQLite file with the REAL schema; the
#  fakes standing in for Etherscan and the kubo node; and the
#  app built the way main.py builds it, with no daemon
#  started.
#
#  Used by:
#    - every test_*.py file in this package
############################################################


import io
import os
import json
import socket
import sqlite3
import tempfile
import importlib
import unittest
import contextlib
from decimal import Decimal
from unittest import mock

import requests


# ---- The throwaway environment ------------------------------

TEST_MARKETPLACE = '0x9A9f2CCfdE556A7E9Ff0848998Aa4a0CFD8863AE'
TEST_ETHERSCAN_KEY = 'TESTKEY-not-a-real-etherscan-key-0000'
TEST_INFURA_PROJECT = 'test-infura-project-00000000000000'
TEST_RPC_URL = f'https://sepolia.infura.io/v3/{TEST_INFURA_PROJECT}'

TEST_ENV = {
    'NFT_MARKETPLACE_ADDRESS': TEST_MARKETPLACE,
    'SEPOLIA_RPC_URL': TEST_RPC_URL,
    'ETHERSCAN_API_KEY': TEST_ETHERSCAN_KEY,
    'DB_PATH': os.path.join(tempfile.gettempdir(), 'nft-backend-tests-unpointed.db'),
}

# The optional knobs main.py reads — cleared, so its own
# defaults are what the tests see
OPTIONAL_ENV = ('IPFS_GATEWAY', 'IPFS_TIMEOUT', 'IPFS_API_URL', 'INDEXER_POLL_SECONDS',
                'PINNER_POLL_SECONDS', 'PIN_MAX_ATTEMPTS', 'APP_DEBUG', 'WERKZEUG_RUN_MAIN')

os.environ.update(TEST_ENV)
for _name in OPTIONAL_ENV:
    os.environ.pop(_name, None)


from app.database import db as _db                               # noqa: E402 — after the environment

if _db.get_db_connection.__defaults__[0] != TEST_ENV['DB_PATH']:
    raise RuntimeError('app.database.db was imported before tests.helpers — import tests.helpers first, '
                       'so no test can reach the real database')


import main                                                      # noqa: E402
from app.database.db import get_db_connection                    # noqa: E402
from app.database.db_init import init_db                         # noqa: E402


# ---- The marketplace story (the frontend fixtures' world) ---

STUDENT = '0x519c864f4cb663758c864724dd7b178cb88a00a5'
OTHER_ACCOUNT = '0x49d364b9eb061a9acef9c6ad11d9e9054a9abd86'
SELLER = '0x69fdf463d634078171b418cf44983a0a2653c33f'
BUYER = '0x98897bceecad3f1f06b65648c2a0cc8c51422ba1'
PUGS = '0x9af3a7e9f86432ed7bf70f908d92b572f440340e'
ART = '0x24ad9a64b846a8ae5d3a833d7cf30de8199b0ba0'

ZERO_ADDRESS = '0x' + '00' * 20

TX = {
    'pug0Listed': '0x857debe4a22570fb02b5884cd7f7ca097578b50a76d148ece820ba2f23fcffce',
    'pug1Listed': '0x9c5a342305af47ac6feb49d2fb85145fed749bf0ec87e1621543c4d99b88a748',
    'pug2Listed': '0xb3d6c2ed6cb97af24b98398e368ce821d2e5d7d27eb1f1a02d24234dcc8f06da',
    'pug0Updated': '0x70d55ac8841306d02664eeda63d7d9c5ffa782cd3ec41ecb14583614cbece0a7',
    'pug2Bought': '0x3dbcdcf2f3be1b12d75a1ffc49fdf025d9924f1a674e734f34f5e73d4b962999',
    'art1Listed': '0xb01c56c4b806aa93a29026ba5576142948a7ae520a8cbdb2ada94ced9351a6b7',
    'art3Listed': '0xde694485f3150070fe4adda995e222c0f95d4d21808a69ac20e8e68ae1487bb2',
    'art3Canceled': '0x2b7cf179594e5b4befa9e50430204cac850c21328e72027b650cf39b2d94006f',
    'art0Listed': '0x0f67bbc9a3d52730a35a3f8ccee53f50f8caa1d7fc10a53cc7cc7fdd42fe116b',
}

DEPLOYMENT_BLOCK = 9650112
TIP_BLOCK = 9713040

# Twelve seconds a block from a fixed anchor — the story's
# dates are the frontend fixtures' dates
_ANCHOR_BLOCK = 9712000
_ANCHOR_TIME = 1790060000


def block_time(block):
    return _ANCHOR_TIME + (block - _ANCHOR_BLOCK) * 12


def wei(ether):
    return int(Decimal(ether) * 10 ** 18)








############################################################
# keccak256
############################################################
#
# Ethereum's Keccak-256 (the original padding, not NIST's
# SHA3-256, which hashlib carries) in plain Python — the
# image has no crypto library, and the event topic hashes in
# main.py are worth checking against their own signatures.
# Slow and simple; the test of this module itself pins it to
# the published vectors.
#
# Used by:
#   - test_main.py — EVENT_TOPICS against their signatures
############################################################

_ROUND_CONSTANTS = (
    0x0000000000000001, 0x0000000000008082, 0x800000000000808A, 0x8000000080008000,
    0x000000000000808B, 0x0000000080000001, 0x8000000080008081, 0x8000000000008009,
    0x000000000000008A, 0x0000000000000088, 0x0000000080008009, 0x000000008000000A,
    0x000000008000808B, 0x800000000000008B, 0x8000000000008089, 0x8000000000008003,
    0x8000000000008002, 0x8000000000000080, 0x000000000000800A, 0x800000008000000A,
    0x8000000080008081, 0x8000000000008080, 0x0000000080000001, 0x8000000080008008,
)

# rho offsets, indexed [x][y]
_ROTATIONS = (
    (0, 36, 3, 41, 18),
    (1, 44, 10, 45, 2),
    (62, 6, 43, 15, 61),
    (28, 55, 25, 21, 56),
    (27, 20, 39, 8, 14),
)

_MASK = (1 << 64) - 1


def _rotl(value, shift):
    return ((value << shift) | (value >> (64 - shift))) & _MASK if shift else value


def _keccak_f(lanes):
    for constant in _ROUND_CONSTANTS:
        columns = [lanes[x] ^ lanes[x + 5] ^ lanes[x + 10] ^ lanes[x + 15] ^ lanes[x + 20] for x in range(5)]
        lanes = [lanes[i] ^ columns[(i % 5 - 1) % 5] ^ _rotl(columns[(i % 5 + 1) % 5], 1) for i in range(25)]

        moved = [0] * 25
        for x in range(5):
            for y in range(5):
                moved[y + 5 * ((2 * x + 3 * y) % 5)] = _rotl(lanes[x + 5 * y], _ROTATIONS[x][y])

        lanes = [moved[x + 5 * y] ^ ((~moved[(x + 1) % 5 + 5 * y] & _MASK) & moved[(x + 2) % 5 + 5 * y])
                 for y in range(5) for x in range(5)]
        lanes[0] ^= constant
    return lanes


def keccak256(data):
    rate = 136
    padded = bytearray(data) + b'\x01'
    while len(padded) % rate:
        padded.append(0)
    padded[-1] |= 0x80

    lanes = [0] * 25
    for start in range(0, len(padded), rate):
        block = padded[start:start + rate]
        for i in range(rate // 8):
            lanes[i] ^= int.from_bytes(block[8 * i:8 * i + 8], 'little')
        lanes = _keccak_f(lanes)

    return b''.join(lane.to_bytes(8, 'little') for lane in lanes[:4])








############################################################
# make_log / STORY_LOGS
############################################################
#
# One marketplace event as Etherscan's getLogs hands it over:
# the topic hash from main.py's EVENT_TOPICS, the three
# indexed params (actor, collection, token id) as 32-byte
# topics, the data words the event carries (the price; the
# seller and the price of a sale; nothing for a
# cancellation), and the hex fields — with a zero logIndex
# written as Etherscan writes it, a bare '0x'.
#
# STORY_LOGS is the marketplace story the frontend suite's
# fixtures tell, oldest first: a classmate lists PUG #0 and
# lowers its price; the student lists PUG #1 and PUG #2 and
# sells PUG #2; the classmate lists two tokens of the ART
# collection, cancels one and lists a third.
#
# Used by:
#   - test_indexer.py, test_api_routes.py — the replay and
#     the answers built from it
############################################################

def _topic(address):
    return '0x' + address.lower()[2:].rjust(64, '0')


def _word(number):
    return format(number, '064x')


def make_log(event, nft, token_id, actor, block, log_index=0, price=None, seller=None, tx_hash=None, timestamp=None):
    data = ''
    if event in ('Listed', 'Updated'):
        data = _word(price)
    elif event == 'Bought':
        data = seller.lower()[2:].rjust(64, '0') + _word(price)

    return {
        'address': TEST_MARKETPLACE.lower(),
        'topics': [main.EVENT_TOPICS[event]['topic0'], _topic(actor), _topic(nft), '0x' + _word(token_id)],
        'data': '0x' + data,
        'blockNumber': hex(block),
        'blockHash': '0x' + format(block, '064x'),
        'timeStamp': hex(timestamp if timestamp is not None else block_time(block)),
        'gasPrice': hex(1_500_000_000),
        'gasUsed': hex(84_000),
        'logIndex': hex(log_index) if log_index else '0x',
        'transactionHash': tx_hash or '0x' + format(block * 1000 + log_index, '064x'),
        'transactionIndex': '0x',
    }


STORY_LOGS = [
    make_log('Listed', PUGS, 0, SELLER, 9712004, price=wei('0.08'), tx_hash=TX['pug0Listed']),
    make_log('Listed', PUGS, 1, STUDENT, 9712118, price=wei('0.1'), tx_hash=TX['pug1Listed']),
    make_log('Listed', PUGS, 2, STUDENT, 9712240, price=wei('0.03'), tx_hash=TX['pug2Listed']),
    make_log('Updated', PUGS, 0, SELLER, 9712377, price=wei('0.05'), tx_hash=TX['pug0Updated']),
    make_log('Bought', PUGS, 2, BUYER, 9712502, log_index=3, price=wei('0.03'), seller=STUDENT, tx_hash=TX['pug2Bought']),
    make_log('Listed', ART, 1, SELLER, 9712633, price=wei('0.02'), tx_hash=TX['art1Listed']),
    make_log('Listed', ART, 3, SELLER, 9712760, price=wei('0.5'), tx_hash=TX['art3Listed']),
    make_log('Canceled', ART, 3, SELLER, 9712801, tx_hash=TX['art3Canceled']),
    make_log('Listed', ART, 0, SELLER, 9712915, price=wei('1.25'), tx_hash=TX['art0Listed']),
]








############################################################
# DbTestCase
############################################################
#
# A throwaway SQLite file carrying the PRODUCTION schema
# (init_db, pointed at it), with every module named in
# DB_MODULES reading and writing that file instead of the
# real one. Rows are seeded and read back through small
# helpers, so a test states the state it needs in one line.
#
# Used by:
#   - every test class that touches the database
############################################################

class DbTestCase(unittest.TestCase):

    DB_MODULES = ()

    def setUp(self):
        handle, self.db_path = tempfile.mkstemp(suffix='.db')
        os.close(handle)
        self.addCleanup(self._remove_db)

        with mock.patch('app.database.db_init.get_db_connection', side_effect=self.connect):
            init_db()

        for module in self.DB_MODULES:
            patcher = mock.patch(f'{module}.get_db_connection', side_effect=self.connect)
            patcher.start()
            self.addCleanup(patcher.stop)

    def _remove_db(self):
        for suffix in ('', '-journal', '-wal', '-shm'):
            with contextlib.suppress(FileNotFoundError):
                os.unlink(self.db_path + suffix)

    def connect(self):
        return get_db_connection(self.db_path)

    def query(self, sql, params=()):
        with contextlib.closing(self.connect()) as conn:
            return [dict(row) for row in conn.execute(sql, params).fetchall()]

    def execute(self, sql, params=()):
        with contextlib.closing(self.connect()) as conn, conn:
            conn.execute(sql, params)

    def seed_event(self, event_type, nft, token_id, block, log_index=0, seller=None, buyer=None, price=None,
                   tx_hash=None, timestamp=None):
        self.execute('''
            INSERT INTO Marketplace_Events
                (BlockNumber, Timestamp, TxHash, LogIndex, EventType, NftAddress, TokenId, Seller, Buyer, Price)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', (block, timestamp if timestamp is not None else block_time(block),
              tx_hash or '0x' + format(block * 1000 + log_index, '064x'), log_index, event_type, nft,
              str(token_id), seller, buyer, None if price is None else str(price)))

    def seed_listing(self, nft, token_id, seller, price, listed_block):
        self.execute('''
            INSERT INTO Marketplace_ActiveListings (NftAddress, TokenId, Seller, Price, ListedBlock)
            VALUES (?, ?, ?, ?, ?)
        ''', (nft, str(token_id), seller, str(price), listed_block))

    def seed_pin(self, nft, token_id, kind, status, cid=None, uri='', attempts=1):
        self.execute('''
            INSERT INTO Pinned_Files (NftAddress, TokenId, Kind, Uri, Cid, Status, Attempts)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        ''', (nft, str(token_id), kind, uri, cid, status, attempts))

    def seed_state(self, key, value):
        self.execute('INSERT OR REPLACE INTO Indexer_State (Key, Value) VALUES (?, ?)', (key, str(value)))

    def state(self, key):
        rows = self.query('SELECT Value FROM Indexer_State WHERE Key = ?', (key,))
        return rows[0]['Value'] if rows else None








############################################################
# FakeEtherscan
############################################################
#
# Stands in for an EtherscanClient wherever a daemon or a
# route holds one: the chain tip, the contract's deployment,
# the logs from a block onwards (filtered from the story it
# is given), tokenURI answers per (collection, token id) —
# ABI-encoded like the proxy's eth_call — and wallets'
# transfer histories. Every call is recorded in `calls`; a
# method named in `errors` raises the exception given for it
# instead (for one call or for good).
#
# Used by:
#   - test_indexer.py, test_pinner.py, test_ownership.py,
#     test_api_routes.py and the defect files
############################################################

class FakeEtherscan:

    def __init__(self, tip=TIP_BLOCK, deployment_block=DEPLOYMENT_BLOCK, logs=(), token_uris=None, transfers=None):
        self.tip = tip
        self.deployment = {'block': deployment_block, 'timestamp': block_time(deployment_block)}
        self.logs = list(logs)
        self.token_uris = {(nft.lower(), str(token)): uri for (nft, token), uri in (token_uris or {}).items()}
        self.transfers = {wallet.lower(): list(history) for wallet, history in (transfers or {}).items()}
        self.calls = []
        self.errors = {}

    def fail(self, method, error, once=False):
        self.errors[method] = (error, once)
        return self

    def _call(self, method, *args):
        self.calls.append((method, *args))
        if method in self.errors:
            error, once = self.errors[method]
            if once:
                del self.errors[method]
            raise error

    def called(self, method):
        return [call[1:] for call in self.calls if call[0] == method]

    def block_number(self):
        self._call('block_number')
        return self.tip

    def contract_creation(self, address):
        self._call('contract_creation', address)
        return dict(self.deployment)

    def get_logs(self, address, from_block):
        self._call('get_logs', address, from_block)
        return [dict(log) for log in self.logs if int(log['blockNumber'], 16) >= from_block]

    def eth_call(self, to, data):
        self._call('eth_call', to, data)
        token_id = str(int(data[10:], 16))
        uri = self.token_uris.get((to.lower(), token_id))
        if uri is None:
            raise RuntimeError("Etherscan eth_call error: {'code': 3, 'message': 'execution reverted'}")
        return abi_string(uri)

    def token_nft_transfers(self, wallet_address):
        self._call('token_nft_transfers', wallet_address)
        return [dict(transfer) for transfer in self.transfers.get(wallet_address.lower(), [])]








############################################################
# abi_string / nft_transfer
############################################################
#
# abi_string is a string-returning function's eth_call result
# — the head/tail ABI encoding the pinner decodes: an offset
# word, a length word, the UTF-8 bytes padded to whole words.
# nft_transfer is one entry of Etherscan's tokennfttx history,
# with the fields the holdings replay reads and the ones
# around them.
#
# Used by:
#   - FakeEtherscan (above), test_pinner.py
#   - test_ownership.py, test_api_routes.py
############################################################

def abi_string(text):
    raw = text.encode('utf-8')
    padded = raw + b'\x00' * (-len(raw) % 32)
    return '0x' + _word(32) + _word(len(raw)) + padded.hex()


def nft_transfer(nft, token_id, sender, recipient, block):
    return {
        'blockNumber': str(block),
        'timeStamp': str(block_time(block)),
        'hash': '0x' + format(block, '064x'),
        'from': sender,
        'contractAddress': nft,
        'to': recipient,
        'tokenID': str(token_id),
        'tokenName': 'Dogie',
        'tokenSymbol': 'DOG',
    }








############################################################
# etherscan_response / scripted_get
############################################################
#
# etherscan_response is a REAL requests.Response carrying a
# JSON body and a status, its URL the one requests itself
# prepares from the call (so raise_for_status words its error
# exactly as it would live). scripted_get stands in for
# requests.get: each reply answers the NEXT call — a body (a
# 200 response is built for it), a ready response, or an
# exception to raise — and every call's URL, params and
# timeout are recorded.
#
# Used by:
#   - test_etherscan.py, the routes defect file
############################################################

def etherscan_response(payload, status=200, url=None, params=None):
    response = requests.Response()
    response.status_code = status
    response.reason = {200: 'OK', 403: 'Forbidden', 429: 'Too Many Requests', 502: 'Bad Gateway'}.get(status, 'Error')
    response._content = json.dumps(payload).encode('utf-8')
    response.headers['Content-Type'] = 'application/json'
    response.url = requests.Request('GET', url or main.ETHERSCAN_API_URL, params=params).prepare().url
    response.encoding = 'utf-8'
    return response


def scripted_get(replies, calls=None):
    queue = list(replies)

    def get(url, params=None, **kwargs):
        if calls is not None:
            calls.append({'url': url, 'params': dict(params or {}), **kwargs})
        reply = queue.pop(0)
        if isinstance(reply, BaseException):
            raise reply
        if isinstance(reply, requests.Response):
            reply.url = requests.Request('GET', url, params=params).prepare().url
            return reply
        return etherscan_response(reply, url=url, params=params)

    return get








############################################################
# FakeKubo
############################################################
#
# The local kubo node and the public gateway caches, as the
# pinner reaches them over HTTP (it stands in for the pinner
# module's requests.post and requests.get). The p2p network
# can deliver the CIDs in `network` — pin/add pins them;
# others time out like kubo does after its 45 s. The gateway
# caches hold the CIDs `gateways` lists per host: a CAR fetch
# from one of them, imported with dag/import, puts the
# blocks on the local node, which block/stat (offline) then
# finds and a second pin/add pins at once. cat reads a pinned
# file's bytes from `files` (keyed by the path below /ipfs/).
# Every call is recorded; `down` makes the node itself refuse
# every request.
#
# Used by:
#   - test_pinner.py, the pinner defect file
############################################################

class FakeKubo:

    def __init__(self, network=(), gateways=None, files=None, down=False):
        self.network = set(network)
        self.gateways = {host: set(cids) for host, cids in (gateways or {}).items()}
        self.files = dict(files or {})
        self.down = down
        self.pinned = []
        self.local = set()
        self.calls = []

    def _answer(self, status, body=b'', json_body=None):
        response = requests.Response()
        response.status_code = status
        response._content = json.dumps(json_body).encode() if json_body is not None else body
        return response

    def post(self, url, params=None, files=None, timeout=None, **kwargs):
        endpoint = url.rsplit('/api/v0/', 1)[-1]
        arg = (params or {}).get('arg')
        self.calls.append((endpoint, arg, timeout))
        if self.down:
            raise requests.ConnectionError(f"HTTPConnectionPool(host='nft-ipfs', port=5001): Max retries exceeded with url: /api/v0/{endpoint}")

        if endpoint == 'pin/add':
            if arg in self.network or arg in self.local:
                self.pinned.append(arg)
                self.local.add(arg)
                return self._answer(200, json_body={'Pins': [arg]})
            return self._answer(500, json_body={'Message': f'pin: context deadline exceeded ({arg})', 'Code': 0, 'Type': 'error'})

        if endpoint == 'cat':
            path = arg[len('/ipfs/'):]
            if path.split('/')[0] in self.local and path in self.files:
                return self._answer(200, self.files[path])
            return self._answer(500, b'{"Message":"context deadline exceeded","Code":0,"Type":"error"}')

        if endpoint == 'dag/import':
            car = files['file'][1]
            self.local.add(car.decode().removeprefix('CAR:'))
            return self._answer(200, json_body={'Root': {'Cid': {'/': car.decode()[4:]}, 'PinErrorMsg': ''}})

        if endpoint == 'block/stat':
            if arg in self.local:
                return self._answer(200, json_body={'Key': arg, 'Size': 1024})
            return self._answer(500, b'{"Message":"block was not found locally (offline): ipld: could not find node"}')

        raise AssertionError(f'unexpected kubo call {endpoint}')

    def get(self, url, headers=None, timeout=None, **kwargs):
        host = url.split('/')[2]
        cid = url.rsplit('/ipfs/', 1)[-1]
        self.calls.append(('gateway', host, cid, (headers or {}).get('Accept'), timeout))
        if cid in self.gateways.get(host, set()):
            return self._answer(200, f'CAR:{cid}'.encode())
        return self._answer(504, b'gateway timeout')

    # The patch itself; the two mocks keep every call's full
    # arguments for the tests that read them
    def patched(self):
        stack = contextlib.ExitStack()
        self.post_mock = stack.enter_context(mock.patch('app.marketplace.pinner.requests.post', side_effect=self.post))
        self.get_mock = stack.enter_context(mock.patch('app.marketplace.pinner.requests.get', side_effect=self.get))
        return stack








############################################################
# quiet / StopLoop / sleeps
############################################################
#
# quiet captures what the daemons print — their log is
# stdout — so a passing run reads clean, and hands the text
# back for the tests that assert on it. StopLoop ends a daemon
# loop from inside: it is a BaseException, so the loops'
# catch-all `except Exception` lets it through. sleeps stands
# in for time.sleep, records every pause and raises StopLoop
# at the given call, so a test runs a loop exactly so many
# rounds without waiting.
#
# Used by:
#   - test_indexer.py, test_pinner.py, test_etherscan.py,
#     test_main.py and the defect files
############################################################

@contextlib.contextmanager
def quiet():
    captured = io.StringIO()
    with contextlib.redirect_stdout(captured):
        yield captured


class StopLoop(BaseException):
    pass


def sleeps(stop_at=None):
    paused = []

    def sleep(seconds):
        paused.append(seconds)
        if stop_at is not None and len(paused) >= stop_at:
            raise StopLoop()

    sleep.paused = paused
    return sleep








############################################################
# no_dns
############################################################
#
# A network where no host name resolves: every lookup fails
# the way a resolver does, so requests raises its REAL
# connection error — worded exactly as it is live, URL and
# all — without a single packet leaving, even in a container
# that has a network.
#
# Used by:
#   - the routes defect file — what a failed call tells the
#     browser
############################################################

@contextlib.contextmanager
def no_dns():
    def unresolvable(*args, **kwargs):
        raise socket.gaierror(-2, 'Name or service not known')

    with mock.patch('socket.getaddrinfo', side_effect=unresolvable):
        yield








############################################################
# make_app
############################################################
#
# The backend's Flask app the way `python main.py` assembles
# it, minus the daemons and the dev server: a fresh main
# module (reloaded, so every test class gets an app object of
# its own) with the marketplace blueprint registered on it
# exactly as main.py's STEP 2 does. Nothing is started and no
# database is touched — the route tests point the routes'
# get_db_connection at their own file.
#
# Used by:
#   - test_api_routes.py, test_main.py, the routes defect file
############################################################

def make_app():
    from app.marketplace.routes import bp_marketplace

    fresh = importlib.reload(main)
    fresh.app.register_blueprint(bp_marketplace, url_prefix='')
    return fresh.app








############################################################
# sqlite_error
############################################################
#
# The error a locked database raises — what a daemon meets
# when dbgate holds a write on the shared file.
#
# Used by:
#   - the indexer defect file
############################################################

def sqlite_error(message='database is locked'):
    return sqlite3.OperationalError(message)
