############################################################
#  [*] API route defects — found by review, not yet fixed
#
#  Each test states the WANTED behaviour and fails today
#  (@unittest.expectedFailure). Once the fix lands, unittest
#  reports an "unexpected success" — which fails the run —
#  and that is the cue to drop the decorator and move the
#  test into test_api_routes.py.
#
#    - a failed Etherscan call puts the API KEY in the
#      /api/my-nfts answer: requests words its errors with
#      the full URL, query string — apikey= — included, and
#      the route passes the error text to the browser
#    - a failed relay call puts the Infura PROJECT ID in the
#      /api/rpc answer the same way: the very key the relay
#      exists to keep out of the browser
#    - a negative ?limit returns the WHOLE event history past
#      the 500 cap — SQLite reads LIMIT -1 as no limit at all
#    - a ?limit that is no number is Flask's HTML 500 page,
#      not a 400 saying what is wrong
#
#  The leaks are reproduced with requests' REAL error path:
#  no host name resolves (helpers.no_dns), so the error text
#  is exactly what a live outage produces — and not a packet
#  leaves the test.
############################################################


import logging
import unittest
from unittest import mock

from tests import helpers

from app.marketplace import routes
from app.marketplace.etherscan import EtherscanClient
from app.marketplace.ownership import WalletHoldings


# The 500 test makes Flask log a traceback ON PURPOSE —
# silenced for this module, so a passing run reads clean
def setUpModule():
    logging.disable(logging.CRITICAL)


def tearDownModule():
    logging.disable(logging.NOTSET)








############################################################
# DefectTestCase
############################################################
#
# The app the way main.py builds it, over a throwaway
# database, with the routes' holdings cache in front of a
# REAL EtherscanClient — the one whose failures are worded by
# requests itself.
#
# Used by:
#   - every test class in this file
############################################################

class DefectTestCase(helpers.DbTestCase):

    DB_MODULES = ('app.marketplace.routes',)

    @classmethod
    def setUpClass(cls):
        cls.client = helpers.make_app().test_client()

    def setUp(self):
        super().setUp()
        patcher = mock.patch.object(routes, 'wallet_holdings', WalletHoldings(EtherscanClient()))
        patcher.start()
        self.addCleanup(patcher.stop)








############################################################
# KeyLeakDefects
############################################################

class KeyLeakDefects(DefectTestCase):

    @unittest.expectedFailure
    def test_an_etherscan_outage_never_shows_the_api_key(self):
        with helpers.no_dns():
            response = self.client.get(f'/api/my-nfts/{helpers.STUDENT}')
        self.assertEqual(response.status_code, 502)
        self.assertNotIn(helpers.TEST_ETHERSCAN_KEY, response.get_data(as_text=True))

    @unittest.expectedFailure
    def test_an_etherscan_error_status_never_shows_the_api_key(self):
        # Etherscan answers 403: raise_for_status words it with
        # the request's full URL
        refused = helpers.scripted_get([helpers.etherscan_response({'message': 'Forbidden'}, status=403)])
        with mock.patch('app.marketplace.etherscan.requests.get', side_effect=refused):
            response = self.client.get(f'/api/my-nfts/{helpers.STUDENT}')
        self.assertEqual(response.status_code, 502)
        self.assertNotIn(helpers.TEST_ETHERSCAN_KEY, response.get_data(as_text=True))

    @unittest.expectedFailure
    def test_a_relay_outage_never_shows_the_rpc_providers_key(self):
        with helpers.no_dns():
            response = self.client.post('/api/rpc', data=b'{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}',
                                        content_type='application/json')
        self.assertEqual(response.status_code, 502)
        self.assertNotIn(helpers.TEST_INFURA_PROJECT, response.get_data(as_text=True))








############################################################
# ActivityLimitDefects
############################################################

class ActivityLimitDefects(DefectTestCase):

    @unittest.expectedFailure
    def test_a_negative_limit_still_respects_the_cap(self):
        with self.connect() as conn:
            conn.executemany('''
                INSERT INTO Marketplace_Events
                    (BlockNumber, Timestamp, TxHash, LogIndex, EventType, NftAddress, TokenId, Seller, Buyer, Price)
                VALUES (?, 1, ?, 0, 'Listed', ?, '0', ?, NULL, '1')
            ''', [(block, f'0x{block:064x}', helpers.PUGS, helpers.SELLER) for block in range(1, 601)])
        response = self.client.get('/api/activity', query_string={'limit': -1})
        self.assertEqual(response.status_code, 200)
        self.assertLessEqual(len(response.get_json()['activity']), 500)

    @unittest.expectedFailure
    def test_a_limit_that_is_no_number_is_a_400(self):
        response = self.client.get('/api/activity', query_string={'limit': 'lots'})
        self.assertEqual(response.status_code, 400)


if __name__ == '__main__':
    unittest.main()
