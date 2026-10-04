############################################################
#  [*] Entrypoint regression tests
#
#  main.py is the backend's settings and its boot. Pinned
#  down here:
#
#    settings — the three required variables stop the boot
#               with ONE precise message naming every missing
#               one (in a subprocess: main exits at import);
#               the optional knobs' defaults and their
#               overrides; the four event topic hashes are
#               each the Keccak-256 of its own signature
#    config   — GET /api/config is exactly the four public
#               values: the relay's PATH, never the RPC URL
#               with its key, and no Etherscan key either
#    boot     — main.py run as a script (as __main__, the
#               daemons and the dev server patched out): the
#               schema first, ProxyFix, every route, the
#               contract check BEFORE the daemons start, the
#               daemons started once — not in the debug
#               reloader's parent — and the server on
#               0.0.0.0:8000 with debug off
#
#  Offline: nothing is started for real, every database is a
#  throwaway file.
############################################################


import os
import sys
import json
import runpy
import tempfile
import unittest
import subprocess
from unittest import mock

from tests import helpers

import flask
from werkzeug.middleware.proxy_fix import ProxyFix

import main
from app.database.db import get_db_connection
from app.marketplace import indexer as indexer_module
from app.marketplace.indexer import MarketplaceIndexer
from app.marketplace.pinner import Pinner


BACKEND_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

MARKETPLACE_ROUTES = {
    '/api/config', '/api/stats', '/api/listings', '/api/activity',
    '/api/nft/<nft_address>/<token_id>', '/api/my-nfts/<wallet_address>', '/api/rpc',
}


def run_python(code, env_overrides=None, drop=()):
    # A fresh interpreter in the backend folder, so main is
    # imported from scratch under exactly this environment
    env = {k: v for k, v in os.environ.items() if k not in drop}
    env.update(env_overrides or {})
    return subprocess.run([sys.executable, '-c', code], cwd=BACKEND_ROOT, env=env,
                          capture_output=True, text=True, timeout=60)








############################################################
# RequiredSettingsTests
############################################################
#
# The three required variables, each test in a subprocess:
# a missing or empty one stops the boot, every missing one
# named in one message.
############################################################

class RequiredSettingsTests(unittest.TestCase):

    def test_a_missing_required_variable_stops_the_boot_with_its_name(self):
        result = run_python('import main', drop=('ETHERSCAN_API_KEY',))
        self.assertEqual(result.returncode, 1)
        self.assertEqual(result.stderr.strip(), 'Missing required environment variables: ETHERSCAN_API_KEY')

    def test_every_missing_variable_is_named_in_one_message(self):
        result = run_python('import main', drop=('NFT_MARKETPLACE_ADDRESS', 'SEPOLIA_RPC_URL', 'ETHERSCAN_API_KEY'))
        self.assertEqual(result.returncode, 1)
        self.assertEqual(result.stderr.strip(), 'Missing required environment variables: '
                                                'NFT_MARKETPLACE_ADDRESS, SEPOLIA_RPC_URL, ETHERSCAN_API_KEY')

    def test_an_empty_variable_counts_as_missing(self):
        result = run_python('import main', env_overrides={'SEPOLIA_RPC_URL': ''})
        self.assertEqual(result.returncode, 1)
        self.assertIn('SEPOLIA_RPC_URL', result.stderr)

    def test_with_all_three_set_the_import_succeeds(self):
        result = run_python('import main; print("ok")')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(), 'ok')








############################################################
# OptionalSettingsTests
############################################################
#
# The optional knobs: their defaults, and the overrides the
# environment gives them.
############################################################

class OptionalSettingsTests(unittest.TestCase):

    def test_the_defaults(self):
        self.assertEqual(main.ETHERSCAN_API_URL, 'https://api.etherscan.io/v2/api')
        self.assertEqual(main.SEPOLIA_CHAIN_ID, 11155111)
        self.assertEqual(main.INDEXER_POLL_SECONDS, 30)
        self.assertEqual(main.PINNER_POLL_SECONDS, 60)
        self.assertEqual(main.PIN_MAX_ATTEMPTS, 20)
        self.assertEqual(main.IPFS_API_URL, 'http://nft-ipfs:5001/api/v0')

    def test_the_knobs_take_their_overrides_from_the_environment(self):
        result = run_python(
            'import json, main; print(json.dumps([main.INDEXER_POLL_SECONDS, main.PINNER_POLL_SECONDS, '
            'main.PIN_MAX_ATTEMPTS, main.IPFS_API_URL, main.FRONTEND_CONFIG]))',
            env_overrides={'INDEXER_POLL_SECONDS': '15', 'PINNER_POLL_SECONDS': '120', 'PIN_MAX_ATTEMPTS': '5',
                           'IPFS_API_URL': 'http://ipfs.test:5001/api/v0', 'IPFS_GATEWAY': '/archive/ipfs/',
                           'IPFS_TIMEOUT': '2500'})
        self.assertEqual(result.returncode, 0, result.stderr)
        indexer_poll, pinner_poll, max_attempts, api_url, frontend = json.loads(result.stdout)
        self.assertEqual((indexer_poll, pinner_poll, max_attempts, api_url), (15, 120, 5, 'http://ipfs.test:5001/api/v0'))
        self.assertEqual(frontend['ipfsGateway'], '/archive/ipfs/')
        self.assertEqual(frontend['ipfsTimeout'], 2500)








############################################################
# EventTopicTests
############################################################
#
# The topic hashes are hardcoded on purpose (main.py says
# why); what can still drift is a hash and its signature
# within the same entry.
############################################################

class EventTopicTests(unittest.TestCase):

    def test_the_test_keccak_matches_the_published_vectors(self):
        self.assertEqual(helpers.keccak256(b'').hex(), 'c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470')
        self.assertEqual(helpers.keccak256(b'Transfer(address,address,uint256)').hex(),
                         'ddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef')

    def test_the_four_marketplace_events_are_known_by_their_signatures(self):
        self.assertEqual({key: entry['signature'] for key, entry in main.EVENT_TOPICS.items()}, {
            'Listed': 'ItemListed(address,address,uint256,uint256)',
            'Updated': 'ItemUpdated(address,address,uint256,uint256)',
            'Bought': 'ItemBought(address,address,uint256,address,uint256)',
            'Canceled': 'ItemCanceled(address,address,uint256)',
        })

    def test_every_topic_is_the_keccak_of_its_signature(self):
        for key, entry in main.EVENT_TOPICS.items():
            with self.subTest(event=key):
                self.assertEqual(entry['topic0'], '0x' + helpers.keccak256(entry['signature'].encode()).hex())








############################################################
# ConfigRouteTests
############################################################
#
# GET /api/config: exactly the four public values — the
# relay's path, never a key — and nothing but reads.
############################################################

class ConfigRouteTests(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        cls.client = helpers.make_app().test_client()

    def test_the_config_is_exactly_the_four_public_values(self):
        response = self.client.get('/api/config')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json(), {
            'nftMarketplaceAddress': helpers.TEST_MARKETPLACE,
            'rpcUrl': '/api/rpc',
            'ipfsGateway': '/ipfs/',
            'ipfsTimeout': 10000,
        })

    def test_the_config_hands_out_the_relay_path_never_a_key(self):
        # Everything here ends up in every student's browser
        text = self.client.get('/api/config').get_data(as_text=True)
        self.assertNotIn(helpers.TEST_INFURA_PROJECT, text)
        self.assertNotIn(helpers.TEST_ETHERSCAN_KEY, text)
        self.assertNotIn('infura', text.lower())

    def test_the_config_is_read_only(self):
        self.assertEqual(self.client.post('/api/config').status_code, 405)








############################################################
# BootTests
############################################################
#
# main.py run the way the container starts it, its every
# outside effect patched: the schema goes into a throwaway
# file, the daemons' start() and the dev server only record
# that they were called, and the contract check runs for
# real against the throwaway file. `order` is the sequence
# the boot went through.
############################################################

class BootTests(unittest.TestCase):

    def boot(self, env=None):
        handle, db_path = tempfile.mkstemp(suffix='.db')
        os.close(handle)
        self.addCleanup(os.unlink, db_path)
        connect = lambda: get_db_connection(db_path)

        order = []
        self.started = {}
        real_reset = indexer_module.reset_if_contract_changed

        def reset():
            order.append('contract check')
            with helpers.quiet():
                real_reset()

        def recording(name):
            def record(*args, **kwargs):
                order.append(name)
                self.started[name] = kwargs
            return record

        patches = [
            mock.patch.dict(os.environ, env or {}),
            mock.patch('app.database.db_init.get_db_connection', side_effect=lambda: (order.append('schema'), connect())[1]),
            mock.patch('app.marketplace.indexer.get_db_connection', side_effect=connect),
            mock.patch('app.marketplace.indexer.reset_if_contract_changed', side_effect=reset),
            mock.patch.object(MarketplaceIndexer, 'start', recording('indexer')),
            mock.patch.object(Pinner, 'start', recording('pinner')),
            mock.patch.object(flask.Flask, 'run', recording('server')),
        ]
        for patcher in patches:
            patcher.start()
            self.addCleanup(patcher.stop)

        namespace = runpy.run_path(os.path.join(BACKEND_ROOT, 'main.py'), run_name='__main__')
        return namespace['app'], order

    def test_the_boot_order(self):
        _, order = self.boot()
        self.assertEqual(order, ['schema', 'contract check', 'indexer', 'pinner', 'server'])

    def test_every_route_is_served(self):
        app, _ = self.boot()
        self.assertTrue(MARKETPLACE_ROUTES.issubset({rule.rule for rule in app.url_map.iter_rules()}))

    def test_the_proxy_headers_are_trusted_one_hop_deep(self):
        app, _ = self.boot()
        self.assertIsInstance(app.wsgi_app, ProxyFix)
        self.assertEqual((app.wsgi_app.x_for, app.wsgi_app.x_proto, app.wsgi_app.x_host, app.wsgi_app.x_prefix),
                         (1, 1, 1, 1))

    def test_the_server_listens_on_every_interface_at_8000_with_debug_off(self):
        self.boot()
        self.assertEqual(self.started['server'], {'host': '0.0.0.0', 'port': 8000, 'debug': False})

    def test_the_debug_reloaders_parent_starts_no_daemon(self):
        # Werkzeug's reloader runs TWO processes — the daemons
        # belong to the serving child only
        _, order = self.boot({'APP_DEBUG': 'true'})
        self.assertEqual(order, ['schema', 'server'])
        self.assertEqual(self.started['server']['debug'], True)

    def test_the_debug_reloaders_child_starts_the_daemons(self):
        _, order = self.boot({'APP_DEBUG': 'true', 'WERKZEUG_RUN_MAIN': 'true'})
        self.assertEqual(order, ['schema', 'contract check', 'indexer', 'pinner', 'server'])


if __name__ == '__main__':
    unittest.main()
