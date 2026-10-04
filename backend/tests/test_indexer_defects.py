############################################################
#  [*] Indexer defects — found by review, not yet fixed
#
#  Each test states the WANTED behaviour and fails today
#  (@unittest.expectedFailure); an "unexpected success" once
#  the fix lands fails the run — drop the decorator and move
#  the test into test_indexer.py.
#
#    - the reorg overlap only ever ADDS: an event whose block
#      a reorg dropped stays stored — and so does the listing
#      it made — although the indexer's header promises the
#      overlap "cannot leave a stale event behind"
#    - a transaction mined again after a reorg, at another
#      log index, is stored a SECOND time (an event is unique
#      by transaction AND log index): the feed shows it twice
#    - a contract change forgets the old contract's scan
#      position but not WHEN it was scanned, so /api/stats
#      pairs "no block scanned" with the old contract's time
#    - the resume point is read OUTSIDE the retry loop: a
#      database busy at boot (dbgate holding a write) kills
#      the indexer thread for good, silently
############################################################


import sqlite3
import unittest
from unittest import mock

from tests import helpers

from app.marketplace.indexer import MarketplaceIndexer, reset_if_contract_changed








############################################################
# IndexerDefects
############################################################

class IndexerDefects(helpers.DbTestCase):

    DB_MODULES = ('app.marketplace.indexer',)

    def setUp(self):
        super().setUp()
        self.indexer = MarketplaceIndexer(helpers.FakeEtherscan(logs=helpers.STORY_LOGS))

    def store(self, logs):
        with helpers.quiet():
            self.indexer._store_logs(logs, helpers.TIP_BLOCK)

    @unittest.expectedFailure
    def test_an_event_a_reorg_dropped_is_dropped_from_the_marketplace_too(self):
        dropped = helpers.make_log('Listed', helpers.ART, 9, helpers.SELLER, helpers.TIP_BLOCK - 3, price=1)
        self.store(helpers.STORY_LOGS + [dropped])

        # The overlap re-scan after the reorg: the same range, as
        # the canonical chain now holds it — without that listing
        self.store(helpers.STORY_LOGS)
        self.assertEqual(self.query('SELECT * FROM Marketplace_Events WHERE TxHash = ?', (dropped['transactionHash'],)), [])
        self.assertEqual(self.query("SELECT * FROM Marketplace_ActiveListings WHERE NftAddress = ? AND TokenId = '9'", (helpers.ART,)), [])

    @unittest.expectedFailure
    def test_a_transaction_mined_again_after_a_reorg_is_one_event(self):
        tx_hash = '0x' + 'cd' * 32
        self.store([helpers.make_log('Listed', helpers.ART, 9, helpers.SELLER, helpers.TIP_BLOCK - 3, log_index=2, price=1, tx_hash=tx_hash)])
        self.store([helpers.make_log('Listed', helpers.ART, 9, helpers.SELLER, helpers.TIP_BLOCK - 1, log_index=0, price=1, tx_hash=tx_hash)])
        self.assertEqual(len(self.query('SELECT * FROM Marketplace_Events WHERE TxHash = ?', (tx_hash,))), 1)

    @unittest.expectedFailure
    def test_a_contract_change_also_forgets_when_the_old_contract_was_scanned(self):
        self.seed_state('ContractAddress', '0x' + '77' * 20)
        self.store(helpers.STORY_LOGS)
        with helpers.quiet():
            reset_if_contract_changed()
        self.assertIsNone(self.state('LastScannedBlock'))
        self.assertIsNone(self.state('LastScannedAt'))

    @unittest.expectedFailure
    def test_a_database_busy_at_boot_is_retried_not_fatal(self):
        connections = [helpers.sqlite_error(), self.connect(), self.connect()]
        pause = helpers.sleeps(stop_at=1)
        with mock.patch('app.marketplace.indexer.get_db_connection', side_effect=connections), \
                mock.patch('app.marketplace.indexer.time.sleep', side_effect=pause), helpers.quiet():
            try:
                self.indexer._loop()
                survived = False
            except helpers.StopLoop:
                survived = True
            except sqlite3.OperationalError:
                survived = False
        self.assertTrue(survived, 'the indexer thread died on a busy database at boot')


if __name__ == '__main__':
    unittest.main()
