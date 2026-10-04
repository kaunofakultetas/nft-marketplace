############################################################
#  [*] Live smoke tests (opt-in: RUN_LIVE=1)
#
#  Hits the RUNNING backend on localhost:8000 — every public
#  read answers, in the shape the GUI reads, the public
#  config leaks no key, the indexer is keeping up with the
#  chain, a listed token reads back as listed, and the relay
#  really reaches Sepolia. Run from inside the backend
#  container (tests/README.md has the command) — this module
#  alone: the offline layers need a writable /tmp, which the
#  running container's read-only filesystem does not give.
#
#  Read-only: no transaction is ever sent. The relay test
#  costs one RPC call and the wallet test one Etherscan call
#  (then cached for a minute).
############################################################


import os
import re
import json
import time
import unittest
import urllib.request

BASE = 'http://localhost:8000'

ADDRESS = re.compile(r'^0x[0-9a-f]{40}$')
DECIMAL = re.compile(r'^\d+$')


def get(path):
    with urllib.request.urlopen(BASE + path, timeout=60) as response:
        return json.load(response)


def post(path, body):
    request = urllib.request.Request(BASE + path, data=json.dumps(body).encode(), method='POST',
                                     headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(request, timeout=60) as response:
        return json.load(response)








############################################################
# LiveSmokeTests
############################################################
#
# The running backend, read-only: every public read in the
# shape the GUI reads, the indexer keeping up, the relay
# reaching Sepolia — skipped unless RUN_LIVE is set.
############################################################

@unittest.skipUnless(os.getenv('RUN_LIVE'), 'live smoke is opt-in: set RUN_LIVE=1')
class LiveSmokeTests(unittest.TestCase):

    def test_the_config_is_public_and_points_at_the_relay(self):
        config = get('/api/config')
        self.assertEqual(set(config), {'nftMarketplaceAddress', 'rpcUrl', 'ipfsGateway', 'ipfsTimeout'})
        self.assertEqual(config['rpcUrl'], '/api/rpc')
        self.assertRegex(config['nftMarketplaceAddress'].lower(), ADDRESS)
        payload = json.dumps(config).lower()
        self.assertNotIn('infura', payload)
        self.assertNotIn('apikey', payload)

    def test_the_stats_describe_the_configured_contract(self):
        stats = get('/api/stats')
        self.assertEqual((stats['network'], stats['chainId']), ('Sepolia', 11155111))
        self.assertEqual(stats['marketplaceAddress'], get('/api/config')['nftMarketplaceAddress'].lower())
        self.assertEqual(set(stats['eventTopics']), {'Listed', 'Updated', 'Bought', 'Canceled'})
        for key in ('activeListings', 'totalSales', 'totalEvents'):
            self.assertGreaterEqual(stats[key], 0)
        self.assertRegex(stats['totalVolumeWei'], DECIMAL)

    def test_the_indexer_is_keeping_up(self):
        # It polls every 30 seconds; ten minutes of silence means
        # it is stuck
        stats = get('/api/stats')
        self.assertIsInstance(stats['lastScannedBlock'], int)
        self.assertGreater(stats['lastScannedAt'], time.time() - 600)

    def test_the_listings_are_in_the_storefronts_shape(self):
        for listing in get('/api/listings')['listings']:
            self.assertEqual(set(listing), {'nftAddress', 'tokenId', 'seller', 'price'})
            self.assertRegex(listing['nftAddress'], ADDRESS)
            self.assertRegex(listing['seller'], ADDRESS)
            self.assertRegex(listing['tokenId'], DECIMAL)
            self.assertRegex(listing['price'], DECIMAL)

    def test_the_activity_is_newest_first_and_honours_its_limit(self):
        activity = get('/api/activity?limit=5')['activity']
        self.assertLessEqual(len(activity), 5)
        blocks = [event['blockNumber'] for event in activity]
        self.assertEqual(blocks, sorted(blocks, reverse=True))

    def test_a_listed_token_reads_back_as_listed(self):
        listings = get('/api/listings')['listings']
        if not listings:
            self.skipTest('nothing is listed right now')
        first = listings[0]
        token = get(f'/api/nft/{first["nftAddress"]}/{first["tokenId"]}')
        self.assertEqual(token['activeListing'], {'price': first['price'], 'seller': first['seller']})

    def test_the_relay_reaches_sepolia(self):
        answer = post('/api/rpc', {'jsonrpc': '2.0', 'id': 1, 'method': 'eth_chainId', 'params': []})
        self.assertEqual(answer['result'], '0xaa36a7')

    def test_a_sellers_holdings_answer_in_the_gui_shape(self):
        listings = get('/api/listings')['listings']
        if not listings:
            self.skipTest('nothing is listed right now')
        holdings = get(f'/api/my-nfts/{listings[0]["seller"]}')
        self.assertIsInstance(holdings['nfts'], list)
        for nft in holdings['nfts']:
            self.assertEqual(set(nft), {'nftAddress', 'tokenId'})


if __name__ == '__main__':
    unittest.main()
