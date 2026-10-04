############################################################
#  [*] Etherscan client regression tests
#
#  The one place that talks to Etherscan, against a scripted
#  requests.get — no network. Pinned down here:
#
#    plumbing — every call goes to the V2 endpoint with
#               Sepolia's chain id and the key, under a 30 s
#               timeout; an HTTP error status, a transport
#               failure, a timeout and an answer that is no
#               JSON reach the caller as a RuntimeError saying
#               which — never with the request's URL, whose
#               query string carries the key, not even in the
#               traceback
#    chain    — the tip from the proxy's hex (a bare '0x' is
#               zero); the deployment block and time from the
#               creation lookup's DECIMAL strings, whichever
#               spelling of the time field comes back; every
#               log from a block to the tip, page after page —
#               the next page starting AT the last block
#               returned, not after it, with a politeness
#               pause between pages; an empty history is a
#               result, any other refusal an error naming
#               Etherscan's message
#    proxy    — eth_call's raw hex, and its two error shapes
#    wallet   — a wallet's full NFT transfer history, oldest
#               first; a fresh wallet is an empty list
############################################################


import traceback
import unittest
from unittest import mock

from tests import helpers

import requests

from app.marketplace.etherscan import EtherscanClient, hex_int


def log_at(block):
    return helpers.make_log('Listed', helpers.PUGS, 0, helpers.SELLER, block, price=1)


def told(error):
    # Everything a log line would show of the error
    return ''.join(traceback.format_exception(error))








############################################################
# ClientTestCase
############################################################
#
# A client whose requests.get answers from a script; the
# calls it made are in self.calls, its pauses in
# self.paused.
#
# Used by:
#   - every test class below
############################################################

class ClientTestCase(unittest.TestCase):

    def answer(self, *replies):
        self.calls = []
        get = mock.patch('app.marketplace.etherscan.requests.get', side_effect=helpers.scripted_get(replies, self.calls))
        get.start()
        self.addCleanup(get.stop)
        self.pause = helpers.sleeps()
        sleep = mock.patch('app.marketplace.etherscan.time.sleep', side_effect=self.pause)
        sleep.start()
        self.addCleanup(sleep.stop)
        return EtherscanClient()








############################################################
# PlumbingTests
############################################################

class PlumbingTests(ClientTestCase):

    def test_every_call_carries_the_endpoint_chain_key_and_timeout(self):
        client = self.answer({'jsonrpc': '2.0', 'id': 83, 'result': '0x9433d0'})
        client.block_number()
        call = self.calls[0]
        self.assertEqual(call['url'], 'https://api.etherscan.io/v2/api')
        self.assertEqual(call['params']['chainid'], 11155111)
        self.assertEqual(call['params']['apikey'], helpers.TEST_ETHERSCAN_KEY)
        self.assertEqual(call['timeout'], 30)

    def test_an_http_error_status_is_told_without_the_url(self):
        client = self.answer(helpers.etherscan_response({'message': 'Forbidden'}, status=403))
        with self.assertRaises(RuntimeError) as failed:
            client.block_number()
        self.assertEqual(str(failed.exception), 'Etherscan answered HTTP 403')
        self.assertNotIn(helpers.TEST_ETHERSCAN_KEY, told(failed.exception))

    def test_an_outage_is_told_without_the_url(self):
        # requests' own words for an unreachable host: the whole
        # address, query string and key included
        with helpers.no_dns(), self.assertRaises(RuntimeError) as failed:
            EtherscanClient().block_number()
        self.assertEqual(str(failed.exception), 'Etherscan could not be reached')
        self.assertNotIn(helpers.TEST_ETHERSCAN_KEY, told(failed.exception))

    def test_a_timeout_is_told_as_one(self):
        client = self.answer(requests.ConnectTimeout('connect timed out'))
        with self.assertRaises(RuntimeError) as failed:
            client.block_number()
        self.assertEqual(str(failed.exception), 'Etherscan did not answer in time')

    def test_an_answer_that_is_no_json_is_told_as_one(self):
        page = requests.Response()
        page.status_code = 200
        page._content = b'<html>Bad Gateway</html>'
        client = self.answer(page)
        with self.assertRaises(RuntimeError) as failed:
            client.block_number()
        self.assertEqual(str(failed.exception), 'Etherscan answered something that is not JSON')

    def test_hex_int_reads_etherscans_bare_zero(self):
        self.assertEqual(hex_int('0x'), 0)
        self.assertEqual(hex_int('0x0'), 0)
        self.assertEqual(hex_int('0x1f'), 31)








############################################################
# ChainTests
############################################################

class ChainTests(ClientTestCase):

    def test_the_tip_comes_from_the_proxys_hex(self):
        client = self.answer({'jsonrpc': '2.0', 'id': 83, 'result': hex(helpers.TIP_BLOCK)})
        self.assertEqual(client.block_number(), helpers.TIP_BLOCK)
        self.assertEqual((self.calls[0]['params']['module'], self.calls[0]['params']['action']), ('proxy', 'eth_blockNumber'))

    def test_the_deployment_comes_from_decimal_strings(self):
        client = self.answer({'status': '1', 'message': 'OK', 'result': [{
            'contractAddress': helpers.TEST_MARKETPLACE.lower(), 'contractCreator': helpers.SELLER,
            'txHash': '0x' + 'ab' * 32, 'blockNumber': str(helpers.DEPLOYMENT_BLOCK),
            'timestamp': str(helpers.block_time(helpers.DEPLOYMENT_BLOCK)),
        }]})
        self.assertEqual(client.contract_creation(helpers.TEST_MARKETPLACE), {
            'block': helpers.DEPLOYMENT_BLOCK,
            'timestamp': helpers.block_time(helpers.DEPLOYMENT_BLOCK),
        })
        params = self.calls[0]['params']
        self.assertEqual((params['module'], params['action'], params['contractaddresses']),
                         ('contract', 'getcontractcreation', helpers.TEST_MARKETPLACE))

    def test_the_deployment_time_under_its_other_spelling_or_none_at_all(self):
        client = self.answer(
            {'status': '1', 'message': 'OK', 'result': [{'blockNumber': '7', 'timeStamp': '1700000000'}]},
            {'status': '1', 'message': 'OK', 'result': [{'blockNumber': '7'}]},
        )
        self.assertEqual(client.contract_creation('0xc0'), {'block': 7, 'timestamp': 1700000000})
        self.assertEqual(client.contract_creation('0xc0'), {'block': 7, 'timestamp': 0})

    def test_a_refused_deployment_lookup_names_etherscans_words(self):
        client = self.answer(
            {'status': '0', 'message': 'NOTOK', 'result': 'Missing or invalid contractaddresses'},
            {'status': '1', 'message': 'OK', 'result': []},
        )
        with self.assertRaises(RuntimeError) as refused:
            client.contract_creation('0xc0')
        self.assertEqual(str(refused.exception), 'Etherscan getcontractcreation error: NOTOK Missing or invalid contractaddresses')
        with self.assertRaises(RuntimeError):
            client.contract_creation('0xc0')

    def test_the_logs_of_a_short_history_come_in_one_call(self):
        logs = [log_at(100), log_at(101)]
        client = self.answer({'status': '1', 'message': 'OK', 'result': logs})
        self.assertEqual(client.get_logs(helpers.TEST_MARKETPLACE, 90), logs)
        params = self.calls[0]['params']
        self.assertEqual({key: params[key] for key in ('module', 'action', 'address', 'fromBlock', 'toBlock', 'page', 'offset')}, {
            'module': 'logs', 'action': 'getLogs', 'address': helpers.TEST_MARKETPLACE,
            'fromBlock': 90, 'toBlock': 'latest', 'page': 1, 'offset': 1000,
        })
        self.assertEqual(self.pause.paused, [])

    def test_a_full_page_is_followed_from_its_last_block_not_after_it(self):
        # A block's logs can straddle the page break — the overlap
        # is the caller's to dedupe
        first_page = [log_at(100 + i // 10) for i in range(1000)]
        second_page = [log_at(199), log_at(250)]
        client = self.answer({'status': '1', 'message': 'OK', 'result': first_page},
                             {'status': '1', 'message': 'OK', 'result': second_page})
        logs = client.get_logs(helpers.TEST_MARKETPLACE, 100)
        self.assertEqual(len(logs), 1002)
        self.assertEqual([call['params']['fromBlock'] for call in self.calls], [100, 199])
        self.assertEqual(self.pause.paused, [0.25])

    def test_an_empty_history_is_a_result(self):
        client = self.answer({'status': '0', 'message': 'No records found', 'result': []})
        self.assertEqual(client.get_logs(helpers.TEST_MARKETPLACE, 100), [])

    def test_no_further_records_after_a_full_page_end_the_scan(self):
        first_page = [log_at(100) for _ in range(1000)]
        client = self.answer({'status': '1', 'message': 'OK', 'result': first_page},
                             {'status': '0', 'message': 'No records found', 'result': []})
        self.assertEqual(len(client.get_logs(helpers.TEST_MARKETPLACE, 100)), 1000)

    def test_a_refused_logs_call_names_etherscans_words(self):
        client = self.answer({'status': '0', 'message': 'NOTOK', 'result': 'Max rate limit reached'})
        with self.assertRaises(RuntimeError) as refused:
            client.get_logs(helpers.TEST_MARKETPLACE, 100)
        self.assertEqual(str(refused.exception), 'Etherscan getLogs error: NOTOK Max rate limit reached')








############################################################
# ProxyCallTests
############################################################

class ProxyCallTests(ClientTestCase):

    def test_eth_call_hands_back_the_raw_hex(self):
        result = helpers.abi_string('ipfs://bafy/0.json')
        client = self.answer({'jsonrpc': '2.0', 'id': 1, 'result': result})
        self.assertEqual(client.eth_call(helpers.PUGS, '0xc87b56dd' + '00' * 32), result)
        params = self.calls[0]['params']
        self.assertEqual({key: params[key] for key in ('module', 'action', 'to', 'data', 'tag')}, {
            'module': 'proxy', 'action': 'eth_call', 'to': helpers.PUGS, 'data': '0xc87b56dd' + '00' * 32, 'tag': 'latest',
        })

    def test_a_node_error_object_is_an_error(self):
        client = self.answer({'jsonrpc': '2.0', 'id': 1, 'error': {'code': 3, 'message': 'execution reverted'}})
        with self.assertRaises(RuntimeError) as refused:
            client.eth_call(helpers.ART, '0xc87b56dd' + '00' * 32)
        self.assertIn('execution reverted', str(refused.exception))

    def test_a_result_that_is_no_hex_is_an_error(self):
        client = self.answer({'status': '0', 'message': 'NOTOK', 'result': 'Max rate limit reached'})
        with self.assertRaises(RuntimeError) as refused:
            client.eth_call(helpers.ART, '0xc87b56dd' + '00' * 32)
        self.assertEqual(str(refused.exception), 'Etherscan eth_call error: NOTOK Max rate limit reached')








############################################################
# WalletTests
############################################################

class WalletTests(ClientTestCase):

    def test_a_wallets_whole_history_oldest_first(self):
        history = [helpers.nft_transfer(helpers.PUGS, 1, helpers.ZERO_ADDRESS, helpers.STUDENT, 100)]
        client = self.answer({'status': '1', 'message': 'OK', 'result': history})
        self.assertEqual(client.token_nft_transfers(helpers.STUDENT), history)
        params = self.calls[0]['params']
        self.assertEqual({key: params[key] for key in ('module', 'action', 'address', 'page', 'offset', 'startblock', 'endblock', 'sort')}, {
            'module': 'account', 'action': 'tokennfttx', 'address': helpers.STUDENT,
            'page': 1, 'offset': 10000, 'startblock': 0, 'endblock': 99999999, 'sort': 'asc',
        })

    def test_a_fresh_wallet_is_an_empty_list(self):
        client = self.answer({'status': '0', 'message': 'No transactions found', 'result': []})
        self.assertEqual(client.token_nft_transfers(helpers.OTHER_ACCOUNT), [])

    def test_a_refused_lookup_names_etherscans_words(self):
        client = self.answer({'status': '0', 'message': 'NOTOK', 'result': 'Error! Invalid address format'})
        with self.assertRaises(RuntimeError) as refused:
            client.token_nft_transfers('not-an-address')
        self.assertEqual(str(refused.exception), 'Etherscan tokennfttx error: Error! Invalid address format')


if __name__ == '__main__':
    unittest.main()
