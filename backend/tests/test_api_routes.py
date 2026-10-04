############################################################
#  [*] API route tests — the answers the GUI reads
#
#  The GUI sees the backend only through these answers, and
#  the frontend's own suite answers its pages from fixtures
#  shaped like them. These tests send real requests through
#  the whole Flask app (built the way main.py builds it) over
#  a database the REAL indexer filled with the same marketplace
#  story those fixtures tell — so every answer here is pinned
#  to exactly what the frontend fixtures assume: the field
#  names, wei amounts and token ids as strings, lowercase
#  addresses, the orders (newest listing block first, newest
#  event first), the archive counts.
#
#    GET  /api/stats                      — totals, indexer position, archive, topics
#    GET  /api/listings                   — the storefront
#    GET  /api/activity                   — the feed, ?limit= defaulting to 100, capped at 500
#    GET  /api/nft/<nftAddress>/<tokenId> — one token's listing, history and archive
#    GET  /api/my-nfts/<wallet>           — the wallet's holdings, a 502 on failure
#    POST /api/rpc                        — the JSON-RPC relay, byte for byte
#
#  Etherscan is a fake; the relay's upstream is a mock — no
#  request leaves the test.
############################################################


import unittest
from unittest import mock

from tests import helpers

import requests

import main
from app.marketplace import routes
from app.marketplace.indexer import MarketplaceIndexer
from app.marketplace.ownership import WalletHoldings


PUG_JSON_CID = 'bafybeig37ioir76s7mg5oobetncojcm3c3hxasyd4rvid4jqhy4gkaheg4'
PUG_IMAGE_CID = 'QmSsYRx3LpDAb1GZQm7zZ1AuHZjfbPkD6J7s9r41xu1mf8'
ART_DIR = 'bafybei2kpehdmoemeamafvd7sbjdz5ycbvj7kq4ogpjm7eyobzzjjliius'
ART_1_IMAGE_CID = 'bafkreiyho67dkx3htkufgo5el2fubvoju36abw2vywisxwxyln7veddtn5'

SCANNED_AT = helpers.block_time(helpers.TIP_BLOCK) + 7

# The student's transfer history: PUG #1 and #3 minted, PUG #2
# minted and sold, ART #2 bought
STUDENT_TRANSFERS = [
    helpers.nft_transfer(helpers.PUGS, 1, helpers.ZERO_ADDRESS, helpers.STUDENT, 9700001),
    helpers.nft_transfer(helpers.PUGS, 2, helpers.ZERO_ADDRESS, helpers.STUDENT, 9700002),
    helpers.nft_transfer(helpers.PUGS, 3, helpers.ZERO_ADDRESS, helpers.STUDENT, 9700003),
    helpers.nft_transfer(helpers.ART, 2, helpers.SELLER, helpers.STUDENT, 9700004),
    helpers.nft_transfer(helpers.PUGS, 2, helpers.STUDENT, helpers.BUYER, 9712502),
]


def event(block, event_type, nft, token_id, seller=None, buyer=None, price=None, tx_hash=None):
    # One event as the feed carries it
    return {'blockNumber': block, 'buyer': buyer, 'nftAddress': nft, 'price': price, 'seller': seller,
            'timestamp': helpers.block_time(block), 'tokenId': str(token_id), 'txHash': tx_hash, 'type': event_type}


# The feed of the story, newest first — the frontend
# fixtures' activity() word for word
STORY_FEED = [
    event(9712915, 'Listed', helpers.ART, 0, seller=helpers.SELLER, price=str(helpers.wei('1.25')), tx_hash=helpers.TX['art0Listed']),
    event(9712801, 'Canceled', helpers.ART, 3, seller=helpers.SELLER, tx_hash=helpers.TX['art3Canceled']),
    event(9712760, 'Listed', helpers.ART, 3, seller=helpers.SELLER, price=str(helpers.wei('0.5')), tx_hash=helpers.TX['art3Listed']),
    event(9712633, 'Listed', helpers.ART, 1, seller=helpers.SELLER, price=str(helpers.wei('0.02')), tx_hash=helpers.TX['art1Listed']),
    event(9712502, 'Bought', helpers.PUGS, 2, seller=helpers.STUDENT, buyer=helpers.BUYER, price=str(helpers.wei('0.03')), tx_hash=helpers.TX['pug2Bought']),
    event(9712377, 'Updated', helpers.PUGS, 0, seller=helpers.SELLER, price=str(helpers.wei('0.05')), tx_hash=helpers.TX['pug0Updated']),
    event(9712240, 'Listed', helpers.PUGS, 2, seller=helpers.STUDENT, price=str(helpers.wei('0.03')), tx_hash=helpers.TX['pug2Listed']),
    event(9712118, 'Listed', helpers.PUGS, 1, seller=helpers.STUDENT, price=str(helpers.wei('0.1')), tx_hash=helpers.TX['pug1Listed']),
    event(9712004, 'Listed', helpers.PUGS, 0, seller=helpers.SELLER, price=str(helpers.wei('0.08')), tx_hash=helpers.TX['pug0Listed']),
]








############################################################
# RouteTestCase
############################################################
#
# One app per test class (building it is the slow part); per
# test a throwaway database the routes and the indexer share,
# a fake Etherscan behind the routes' module-level client and
# a fresh holdings cache over it, and the deployment lookup
# forgotten. story() fills the database the way the live
# backend would: the indexer stores the story's logs and the
# pinner's rows are those the frontend fixtures' archive
# describes.
#
# Used by:
#   - every test class in this file
############################################################

class RouteTestCase(helpers.DbTestCase):

    DB_MODULES = ('app.marketplace.routes', 'app.marketplace.indexer')

    @classmethod
    def setUpClass(cls):
        cls.client = helpers.make_app().test_client()

    def setUp(self):
        super().setUp()
        self.etherscan = helpers.FakeEtherscan(logs=helpers.STORY_LOGS, transfers={helpers.STUDENT: STUDENT_TRANSFERS})
        for name, value in (('etherscan', self.etherscan), ('wallet_holdings', WalletHoldings(self.etherscan)), ('_deployment', None)):
            patcher = mock.patch.object(routes, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)

    def story(self):
        with mock.patch('app.marketplace.indexer.time.time', return_value=SCANNED_AT), helpers.quiet():
            MarketplaceIndexer(self.etherscan)._store_logs(helpers.STORY_LOGS, helpers.TIP_BLOCK)
        for token_id in (0, 1, 2):
            self.seed_pin(helpers.PUGS, token_id, 'metadata', 'pinned', cid=PUG_JSON_CID)
            self.seed_pin(helpers.PUGS, token_id, 'image', 'pinned', cid=PUG_IMAGE_CID)
        self.seed_pin(helpers.ART, 0, 'metadata', 'pinned', cid=ART_DIR)
        self.seed_pin(helpers.ART, 0, 'image', 'pinned', cid=ART_DIR)
        self.seed_pin(helpers.ART, 1, 'metadata', 'pinned', cid=ART_1_IMAGE_CID)
        self.seed_pin(helpers.ART, 1, 'image', 'invalid')
        self.seed_pin(helpers.ART, 3, 'metadata', 'pinned', cid=ART_DIR)
        self.seed_pin(helpers.ART, 3, 'image', 'invalid')

    def get(self, path, **params):
        response = self.client.get(path, query_string=params)
        self.assertEqual(response.mimetype, 'application/json')
        return response.status_code, response.get_json()








############################################################
# StatsTests
############################################################

class StatsTests(RouteTestCase):

    def test_the_marketplace_at_a_glance(self):
        self.story()
        status, stats = self.get('/api/stats')
        self.assertEqual(status, 200)
        self.assertEqual(stats, {
            'activeListings': 4,
            'archive': {'invalid': 2, 'pinned': 10},
            'chainId': 11155111,
            'deployedAt': helpers.block_time(helpers.DEPLOYMENT_BLOCK),
            'deploymentBlock': helpers.DEPLOYMENT_BLOCK,
            'eventTopics': main.EVENT_TOPICS,
            'floorPriceWei': str(helpers.wei('0.02')),
            'lastScannedAt': SCANNED_AT,
            'lastScannedBlock': helpers.TIP_BLOCK,
            'marketplaceAddress': helpers.TEST_MARKETPLACE.lower(),
            'network': 'Sepolia',
            'totalEvents': 9,
            'totalSales': 1,
            'totalVolumeWei': str(helpers.wei('0.03')),
        })

    def test_an_empty_marketplace(self):
        _, stats = self.get('/api/stats')
        self.assertEqual({key: stats[key] for key in ('activeListings', 'archive', 'floorPriceWei', 'lastScannedAt',
                                                      'lastScannedBlock', 'totalEvents', 'totalSales', 'totalVolumeWei')}, {
            'activeListings': 0, 'archive': {}, 'floorPriceWei': None, 'lastScannedAt': None,
            'lastScannedBlock': None, 'totalEvents': 0, 'totalSales': 0, 'totalVolumeWei': '0',
        })

    def test_amounts_beyond_64_bits_are_summed_exactly(self):
        huge = 10 ** 30 + 1
        self.seed_event('Bought', helpers.PUGS, 0, 100, seller=helpers.SELLER, buyer=helpers.BUYER, price=huge)
        self.seed_event('Bought', helpers.PUGS, 1, 101, seller=helpers.SELLER, buyer=helpers.BUYER, price=huge)
        self.seed_listing(helpers.ART, 0, helpers.SELLER, huge, 102)
        _, stats = self.get('/api/stats')
        self.assertEqual((stats['totalVolumeWei'], stats['floorPriceWei']), (str(2 * huge), str(huge)))

    def test_the_deployment_is_looked_up_once_per_process(self):
        self.get('/api/stats')
        self.get('/api/stats')
        self.assertEqual(self.etherscan.called('contract_creation'), [(helpers.TEST_MARKETPLACE,)])

    def test_a_failed_deployment_lookup_only_delays_the_deployment_facts(self):
        self.etherscan.fail('contract_creation', RuntimeError('Etherscan getcontractcreation error: NOTOK'), once=True)
        _, first = self.get('/api/stats')
        self.assertEqual((first['deploymentBlock'], first['deployedAt']), (None, None))
        _, second = self.get('/api/stats')
        self.assertEqual(second['deploymentBlock'], helpers.DEPLOYMENT_BLOCK)








############################################################
# StorefrontTests
############################################################

class StorefrontTests(RouteTestCase):

    def test_the_listings_newest_listing_block_first(self):
        self.story()
        status, body = self.get('/api/listings')
        self.assertEqual(status, 200)
        self.assertEqual(body, {'listings': [
            {'nftAddress': helpers.ART, 'price': str(helpers.wei('1.25')), 'seller': helpers.SELLER, 'tokenId': '0'},
            {'nftAddress': helpers.ART, 'price': str(helpers.wei('0.02')), 'seller': helpers.SELLER, 'tokenId': '1'},
            {'nftAddress': helpers.PUGS, 'price': str(helpers.wei('0.05')), 'seller': helpers.SELLER, 'tokenId': '0'},
            {'nftAddress': helpers.PUGS, 'price': str(helpers.wei('0.1')), 'seller': helpers.STUDENT, 'tokenId': '1'},
        ]})

    def test_an_empty_storefront(self):
        self.assertEqual(self.get('/api/listings'), (200, {'listings': []}))








############################################################
# ActivityTests
############################################################

class ActivityTests(RouteTestCase):

    def seed_many(self, count):
        with self.connect() as conn:
            conn.executemany('''
                INSERT INTO Marketplace_Events
                    (BlockNumber, Timestamp, TxHash, LogIndex, EventType, NftAddress, TokenId, Seller, Buyer, Price)
                VALUES (?, 1, ?, 0, 'Listed', ?, '0', ?, NULL, '1')
            ''', [(block, f'0x{block:064x}', helpers.PUGS, helpers.SELLER) for block in range(1, count + 1)])

    def test_the_whole_story_newest_first(self):
        self.story()
        self.assertEqual(self.get('/api/activity'), (200, {'activity': STORY_FEED}))

    def test_a_hundred_events_unless_asked_otherwise(self):
        self.seed_many(150)
        _, body = self.get('/api/activity')
        self.assertEqual([row['blockNumber'] for row in body['activity']], list(range(150, 50, -1)))

    def test_the_limit_asked_for(self):
        self.seed_many(20)
        _, body = self.get('/api/activity', limit=5)
        self.assertEqual([row['blockNumber'] for row in body['activity']], [20, 19, 18, 17, 16])

    def test_never_more_than_500(self):
        self.seed_many(600)
        _, body = self.get('/api/activity', limit=1000)
        self.assertEqual(len(body['activity']), 500)








############################################################
# TokenTests
############################################################

class TokenTests(RouteTestCase):

    def test_a_listed_token_its_history_newest_first_and_its_archive(self):
        # The archive's files come in their kind's alphabetical
        # order — the unique index's, the query asks for none:
        # the image, then the metadata
        self.story()
        status, body = self.get(f'/api/nft/{helpers.PUGS}/0')
        self.assertEqual(status, 200)
        self.assertEqual(body, {
            'activeListing': {'price': str(helpers.wei('0.05')), 'seller': helpers.SELLER},
            'archive': [
                {'cid': PUG_IMAGE_CID, 'kind': 'image', 'status': 'pinned'},
                {'cid': PUG_JSON_CID, 'kind': 'metadata', 'status': 'pinned'},
            ],
            'events': [
                {key: value for key, value in STORY_FEED[5].items() if key not in ('nftAddress', 'tokenId')},
                {key: value for key, value in STORY_FEED[8].items() if key not in ('nftAddress', 'tokenId')},
            ],
        })

    def test_a_sold_token_is_listed_no_more_and_names_its_buyer(self):
        self.story()
        _, body = self.get(f'/api/nft/{helpers.PUGS}/2')
        self.assertIsNone(body['activeListing'])
        self.assertEqual([(row['type'], row['buyer'], row['seller']) for row in body['events']],
                         [('Bought', helpers.BUYER, helpers.STUDENT), ('Listed', None, helpers.STUDENT)])

    def test_a_wrongly_minted_tokens_archive_says_so(self):
        self.story()
        _, body = self.get(f'/api/nft/{helpers.ART}/1')
        self.assertEqual(body['archive'], [
            {'cid': None, 'kind': 'image', 'status': 'invalid'},
            {'cid': ART_1_IMAGE_CID, 'kind': 'metadata', 'status': 'pinned'},
        ])

    def test_the_address_in_the_path_is_lowercased(self):
        self.story()
        _, lowercase = self.get(f'/api/nft/{helpers.PUGS}/0')
        _, checksummed = self.get('/api/nft/0x9AF3a7E9F86432eD7bF70f908D92b572f440340e/0')
        self.assertEqual(checksummed, lowercase)

    def test_a_token_the_marketplace_never_saw(self):
        self.story()
        self.assertEqual(self.get(f'/api/nft/{helpers.PUGS}/3'), (200, {'activeListing': None, 'archive': [], 'events': []}))








############################################################
# WalletTests
############################################################

class WalletTests(RouteTestCase):

    def test_the_wallets_nfts(self):
        status, body = self.get(f'/api/my-nfts/{helpers.STUDENT}')
        self.assertEqual(status, 200)
        self.assertEqual(body, {'nfts': [
            {'nftAddress': helpers.PUGS, 'tokenId': '1'},
            {'nftAddress': helpers.PUGS, 'tokenId': '3'},
            {'nftAddress': helpers.ART, 'tokenId': '2'},
        ]})

    def test_the_wallet_from_the_path_whatever_its_case(self):
        _, body = self.get('/api/my-nfts/0x519C864F4cb663758C864724dD7b178Cb88a00A5')
        self.assertEqual(len(body['nfts']), 3)
        self.assertEqual(self.etherscan.called('token_nft_transfers'), [(helpers.STUDENT,)])

    def test_a_fresh_wallet_holds_nothing(self):
        self.assertEqual(self.get(f'/api/my-nfts/{helpers.OTHER_ACCOUNT}'), (200, {'nfts': []}))

    def test_an_etherscan_failure_is_a_502_saying_why(self):
        self.etherscan.fail('token_nft_transfers', RuntimeError('Etherscan tokennfttx error: Max rate limit reached'))
        self.assertEqual(self.get(f'/api/my-nfts/{helpers.STUDENT}'),
                         (502, {'error': 'Etherscan request failed: Etherscan tokennfttx error: Max rate limit reached'}))








############################################################
# RelayTests
############################################################
#
# The relay's upstream is a mock answering with a real
# requests.Response — what Infura sends back is under the
# test's control, and nothing leaves the test.
############################################################

class RelayTests(RouteTestCase):

    def upstream(self, body=b'{"jsonrpc":"2.0","id":1,"result":"0xaa36a7"}', status=200, error=None):
        response = requests.Response()
        response.status_code = status
        response._content = body
        post = mock.patch('app.marketplace.routes.requests.post', side_effect=error, return_value=response)
        self.post = post.start()
        self.addCleanup(post.stop)

    def relay(self, body):
        return self.client.post('/api/rpc', data=body, content_type='application/json')

    def test_the_request_goes_upstream_byte_for_byte(self):
        self.upstream()
        body = b'{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}'
        self.relay(body)
        self.post.assert_called_once_with(helpers.TEST_RPC_URL, data=body, headers={'Content-Type': 'application/json'}, timeout=30)

    def test_a_batch_goes_upstream_untouched(self):
        self.upstream(body=b'[{"jsonrpc":"2.0","id":1,"result":"0x1"},{"jsonrpc":"2.0","id":2,"result":"0x2"}]')
        batch = b'[{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber"},{"jsonrpc":"2.0","id":2,"method":"eth_chainId"}]'
        response = self.relay(batch)
        self.assertEqual(self.post.call_args.kwargs['data'], batch)
        self.assertEqual(response.get_data(), b'[{"jsonrpc":"2.0","id":1,"result":"0x1"},{"jsonrpc":"2.0","id":2,"result":"0x2"}]')

    def test_the_answer_comes_back_as_infura_sent_it(self):
        self.upstream()
        response = self.relay(b'{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}')
        self.assertEqual((response.status_code, response.mimetype), (200, 'application/json'))
        self.assertEqual(response.get_data(), b'{"jsonrpc":"2.0","id":1,"result":"0xaa36a7"}')

    def test_an_upstream_refusal_keeps_its_status(self):
        self.upstream(body=b'{"jsonrpc":"2.0","id":1,"error":{"code":-32005,"message":"daily request count exceeded"}}', status=429)
        response = self.relay(b'{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}')
        self.assertEqual(response.status_code, 429)
        self.assertIn(b'daily request count exceeded', response.get_data())

    def test_an_unreachable_upstream_is_a_502_saying_why(self):
        self.upstream(error=requests.ConnectionError('connection refused'))
        response = self.relay(b'{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}')
        self.assertEqual((response.status_code, response.get_json()), (502, {'error': 'RPC relay failed: connection refused'}))

    def test_the_relay_only_takes_posts(self):
        self.assertEqual(self.client.get('/api/rpc').status_code, 405)








############################################################
# UnknownRouteTests
############################################################

class UnknownRouteTests(RouteTestCase):

    def test_an_unknown_path_is_a_404(self):
        self.assertEqual(self.client.get('/api/nothing-here').status_code, 404)

    def test_a_token_route_missing_its_id_is_a_404(self):
        self.assertEqual(self.client.get(f'/api/nft/{helpers.PUGS}').status_code, 404)


if __name__ == '__main__':
    unittest.main()
