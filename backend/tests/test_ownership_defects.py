############################################################
#  [*] Wallet holdings defects — found by review, not yet fixed
#
#  The test states the WANTED behaviour and fails today
#  (@unittest.expectedFailure); an "unexpected success" once
#  the fix lands fails the run — drop the decorator and move
#  the test into test_ownership.py.
#
#    - the holdings cache never forgets a wallet: every
#      address ever asked for — any string a visitor puts in
#      /api/my-nfts/<wallet> — keeps its entry, holdings and
#      all, for the life of the process, long after its
#      minute is over
############################################################


import unittest
from unittest import mock

from tests import helpers

from app.marketplace.ownership import WalletHoldings, REFRESH_SECONDS








############################################################
# HoldingsDefects
############################################################

class HoldingsDefects(unittest.TestCase):

    @unittest.expectedFailure
    def test_wallets_not_asked_for_in_a_while_are_forgotten(self):
        holdings = WalletHoldings(helpers.FakeEtherscan())
        with mock.patch('app.marketplace.ownership.time.time', return_value=1_000_000):
            for i in range(1000):
                holdings.get_nfts(f'0x{i:040x}')
        with mock.patch('app.marketplace.ownership.time.time', return_value=1_000_000 + 10 * REFRESH_SECONDS):
            holdings.get_nfts(helpers.STUDENT)
        self.assertLessEqual(len(holdings._cache), 1)


if __name__ == '__main__':
    unittest.main()
