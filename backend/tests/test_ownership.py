############################################################
#  [*] Wallet holdings regression tests
#
#  Which NFTs a wallet holds now, rebuilt from its transfer
#  history, oldest first, so a token's LAST movement decides:
#  received (minted included) means held, sent away or burned
#  means gone, received again means held again. A token is
#  its collection AND its id — the same id in two collections
#  is two tokens — and addresses compare whatever their case.
#  The answers are cached per wallet for a minute; a failed
#  refresh serves the stale answer, and only a wallet never
#  seen before lets the failure through. A wallet nobody asks
#  for in five minutes is forgotten — every ask restarts that
#  clock, so one still being looked at keeps its stale answer
#  through a long outage. Time is mocked — no sleeping in
#  tests.
############################################################


import threading
import unittest
from unittest import mock

from tests import helpers

from app.marketplace.ownership import WalletHoldings, REFRESH_SECONDS, FORGET_SECONDS


def transfer(token_id, sender, recipient, block, nft=helpers.PUGS):
    return helpers.nft_transfer(nft, token_id, sender, recipient, block)








############################################################
# HoldingsTestCase
############################################################
#
# Holdings over a fake Etherscan, the clock under the test's
# control.
#
# Used by:
#   - every test class below
############################################################

class HoldingsTestCase(unittest.TestCase):

    def setUp(self):
        self.now = 1790072487
        clock = mock.patch('app.marketplace.ownership.time.time', side_effect=lambda: self.now)
        clock.start()
        self.addCleanup(clock.stop)

    def holdings(self, transfers):
        self.etherscan = helpers.FakeEtherscan(transfers=transfers)
        return WalletHoldings(self.etherscan)








############################################################
# ReplayTests
############################################################

class ReplayTests(HoldingsTestCase):

    def test_a_minted_token_is_held(self):
        holdings = self.holdings({helpers.STUDENT: [transfer(1, helpers.ZERO_ADDRESS, helpers.STUDENT, 100)]})
        self.assertEqual(holdings.get_nfts(helpers.STUDENT), [{'nftAddress': helpers.PUGS, 'tokenId': '1'}])

    def test_the_last_movement_decides(self):
        holdings = self.holdings({helpers.STUDENT: [
            transfer(1, helpers.ZERO_ADDRESS, helpers.STUDENT, 100),   # minted
            transfer(2, helpers.SELLER, helpers.STUDENT, 101),         # bought
            transfer(2, helpers.STUDENT, helpers.BUYER, 102),          # sold
            transfer(3, helpers.ZERO_ADDRESS, helpers.STUDENT, 103),   # minted
            transfer(3, helpers.STUDENT, helpers.ZERO_ADDRESS, 104),   # burned
            transfer(4, helpers.ZERO_ADDRESS, helpers.STUDENT, 105),   # minted
            transfer(4, helpers.STUDENT, helpers.SELLER, 106),         # given away
            transfer(4, helpers.SELLER, helpers.STUDENT, 107),         # and back
        ]})
        self.assertEqual(holdings.get_nfts(helpers.STUDENT), [
            {'nftAddress': helpers.PUGS, 'tokenId': '1'},
            {'nftAddress': helpers.PUGS, 'tokenId': '4'},
        ])

    def test_the_same_id_in_two_collections_is_two_tokens(self):
        holdings = self.holdings({helpers.STUDENT: [
            transfer(1, helpers.ZERO_ADDRESS, helpers.STUDENT, 100, nft=helpers.PUGS),
            transfer(1, helpers.ZERO_ADDRESS, helpers.STUDENT, 101, nft=helpers.ART),
            transfer(1, helpers.STUDENT, helpers.BUYER, 102, nft=helpers.PUGS),
        ]})
        self.assertEqual(holdings.get_nfts(helpers.STUDENT), [{'nftAddress': helpers.ART, 'tokenId': '1'}])

    def test_addresses_compare_whatever_their_case(self):
        holdings = self.holdings({helpers.STUDENT: [
            transfer(1, helpers.ZERO_ADDRESS, helpers.STUDENT.upper().replace('0X', '0x'), 100, nft=helpers.PUGS.upper().replace('0X', '0x')),
        ]})
        self.assertEqual(holdings.get_nfts('0x519C864F4cb663758C864724dD7b178Cb88a00A5'),
                         [{'nftAddress': helpers.PUGS, 'tokenId': '1'}])

    def test_a_fresh_wallet_holds_nothing(self):
        holdings = self.holdings({})
        self.assertEqual(holdings.get_nfts(helpers.OTHER_ACCOUNT), [])

    def test_etherscan_is_asked_for_the_wallet_in_lowercase(self):
        holdings = self.holdings({})
        holdings.get_nfts('0x519C864F4cb663758C864724dD7b178Cb88a00A5')
        self.assertEqual(self.etherscan.called('token_nft_transfers'), [(helpers.STUDENT,)])








############################################################
# CacheTests
############################################################

class CacheTests(HoldingsTestCase):

    def test_a_wallet_is_asked_once_a_minute(self):
        holdings = self.holdings({helpers.STUDENT: [transfer(1, helpers.ZERO_ADDRESS, helpers.STUDENT, 100)]})
        holdings.get_nfts(helpers.STUDENT)
        self.now += REFRESH_SECONDS - 1
        holdings.get_nfts(helpers.STUDENT)
        self.assertEqual(len(self.etherscan.called('token_nft_transfers')), 1)

    def test_after_the_minute_the_wallet_is_asked_again(self):
        holdings = self.holdings({helpers.STUDENT: []})
        holdings.get_nfts(helpers.STUDENT)
        self.now += REFRESH_SECONDS
        holdings.get_nfts(helpers.STUDENT)
        self.assertEqual(len(self.etherscan.called('token_nft_transfers')), 2)

    def test_one_cache_entry_per_wallet_whatever_the_case(self):
        holdings = self.holdings({})
        holdings.get_nfts(helpers.STUDENT)
        holdings.get_nfts(helpers.STUDENT.upper().replace('0X', '0x'))
        holdings.get_nfts(helpers.OTHER_ACCOUNT)
        self.assertEqual(len(self.etherscan.called('token_nft_transfers')), 2)

    def test_a_failed_refresh_serves_the_last_known_holdings(self):
        holdings = self.holdings({helpers.STUDENT: [transfer(1, helpers.ZERO_ADDRESS, helpers.STUDENT, 100)]})
        known = holdings.get_nfts(helpers.STUDENT)
        self.now += REFRESH_SECONDS
        self.etherscan.fail('token_nft_transfers', RuntimeError('Etherscan tokennfttx error: Max rate limit reached'))
        self.assertEqual(holdings.get_nfts(helpers.STUDENT), known)

    def test_a_failure_for_a_wallet_never_seen_reaches_the_caller(self):
        holdings = self.holdings({})
        self.etherscan.fail('token_nft_transfers', RuntimeError('Etherscan tokennfttx error: Max rate limit reached'))
        with self.assertRaises(RuntimeError):
            holdings.get_nfts(helpers.STUDENT)

    def test_the_cache_lock_is_never_held_during_a_lookup(self):
        # A slow Etherscan answer for one wallet must not stall
        # every other wallet's lookup
        holdings = self.holdings({})
        held = []
        original = self.etherscan.token_nft_transfers

        def lookup(wallet):
            held.append(holdings._lock.locked())
            return original(wallet)

        self.etherscan.token_nft_transfers = lookup
        holdings.get_nfts(helpers.STUDENT)
        self.assertEqual(held, [False])

    def test_parallel_first_requests_both_get_the_right_answer(self):
        holdings = self.holdings({helpers.STUDENT: [transfer(1, helpers.ZERO_ADDRESS, helpers.STUDENT, 100)]})
        answers = []
        threads = [threading.Thread(target=lambda: answers.append(holdings.get_nfts(helpers.STUDENT))) for _ in range(2)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
        self.assertEqual(answers, [[{'nftAddress': helpers.PUGS, 'tokenId': '1'}]] * 2)

    def test_wallets_not_asked_for_in_a_while_are_forgotten(self):
        # Any string in the path is a wallet to the cache
        holdings = self.holdings({})
        for i in range(1000):
            holdings.get_nfts(f'0x{i:040x}')
        self.now += 10 * REFRESH_SECONDS
        holdings.get_nfts(helpers.STUDENT)
        self.assertEqual(list(holdings._cache), [helpers.STUDENT])

    def test_a_wallet_still_asked_for_keeps_its_holdings_through_a_long_outage(self):
        holdings = self.holdings({helpers.STUDENT: [transfer(1, helpers.ZERO_ADDRESS, helpers.STUDENT, 100)]})
        known = holdings.get_nfts(helpers.STUDENT)
        self.etherscan.fail('token_nft_transfers', RuntimeError('Etherscan tokennfttx error: Max rate limit reached'))
        for _ in range(3 * FORGET_SECONDS // REFRESH_SECONDS):
            self.now += REFRESH_SECONDS
            self.assertEqual(holdings.get_nfts(helpers.STUDENT), known)

    def test_a_forgotten_wallet_lets_the_failure_through(self):
        holdings = self.holdings({helpers.STUDENT: [transfer(1, helpers.ZERO_ADDRESS, helpers.STUDENT, 100)]})
        holdings.get_nfts(helpers.STUDENT)
        self.now += FORGET_SECONDS
        self.etherscan.fail('token_nft_transfers', RuntimeError('Etherscan tokennfttx error: Max rate limit reached'))
        with self.assertRaises(RuntimeError):
            holdings.get_nfts(helpers.STUDENT)


if __name__ == '__main__':
    unittest.main()
