############################################################
#  [*] Marketplace indexer regression tests
#
#  The chain → SQLite daemon, in four parts:
#
#    decoding — each of the four events into its row: the
#               actor as the seller (the buyer on a sale, the
#               seller then read from the data), prices and
#               token ids as decimal strings however wide,
#               addresses lowercased, Etherscan's bare '0x'
#               read as zero; a log of another shape — a topic
#               too many or too few, an unknown signature, a
#               data field too short — skipped, never a crash
#    replay   — the frontend fixtures' story stored and
#               replayed into exactly the listings the GUI
#               assumes; chain order whatever order the logs
#               arrive in; a re-scan of the overlap storing
#               nothing twice; a price update moving the
#               listing to its block; the scan position and
#               its time written with the batch, all or
#               nothing
#    reorgs   — a re-scanned window replacing what was stored
#               for it: an event the chain dropped gone, and
#               its token's listing re-derived from what is
#               left; a transaction mined again stored once,
#               at its new place; row ids following the chain
#    reset    — a database built for another contract wiped of
#               its derived state, scan time included, the
#               archive kept
#    the loop — the first run backfilling from the deployment
#               block, a restart resuming from the stored
#               block, a small overlap below it every time,
#               failures — a database busy at boot among them
#               — retried after a pause; the loop driven round
#               by round through a fake Etherscan
#
#  Offline, each test on its own throwaway database.
############################################################


import sqlite3
import unittest
from unittest import mock

from tests import helpers

from app.marketplace.indexer import MarketplaceIndexer, REORG_OVERLAP_BLOCKS, _decode_log, reset_if_contract_changed


# The story's listings once replayed — newest listing block
# first, as /api/listings orders them
STORY_LISTINGS = [
    {'NftAddress': helpers.ART, 'TokenId': '0', 'Seller': helpers.SELLER, 'Price': str(helpers.wei('1.25')), 'ListedBlock': 9712915},
    {'NftAddress': helpers.ART, 'TokenId': '1', 'Seller': helpers.SELLER, 'Price': str(helpers.wei('0.02')), 'ListedBlock': 9712633},
    {'NftAddress': helpers.PUGS, 'TokenId': '0', 'Seller': helpers.SELLER, 'Price': str(helpers.wei('0.05')), 'ListedBlock': 9712377},
    {'NftAddress': helpers.PUGS, 'TokenId': '1', 'Seller': helpers.STUDENT, 'Price': str(helpers.wei('0.1')), 'ListedBlock': 9712118},
]

SCANNED_AT = 1790072487








############################################################
# IndexerTestCase
############################################################
#
# A throwaway database the indexer module reads and writes,
# the clock fixed, and an indexer over a fake Etherscan
# holding the story. store() hands the indexer a batch as one
# scan window — from the batch's earliest block on, unless
# the test says where the window starts.
#
# Used by:
#   - every test class below but DecodeTests
############################################################

class IndexerTestCase(helpers.DbTestCase):

    DB_MODULES = ('app.marketplace.indexer',)

    def setUp(self):
        super().setUp()
        clock = mock.patch('app.marketplace.indexer.time.time', return_value=SCANNED_AT)
        clock.start()
        self.addCleanup(clock.stop)
        self.etherscan = helpers.FakeEtherscan(logs=helpers.STORY_LOGS)
        self.indexer = MarketplaceIndexer(self.etherscan)

    def store(self, logs, scanned_to=helpers.TIP_BLOCK, from_block=None):
        if from_block is None:
            from_block = min((int(log['blockNumber'], 16) for log in logs), default=scanned_to + 1)
        with helpers.quiet() as printed:
            stored = self.indexer._store_logs(logs, from_block, scanned_to)
        return stored, printed.getvalue()

    def listings(self):
        return self.query('SELECT * FROM Marketplace_ActiveListings ORDER BY ListedBlock DESC')

    def events(self):
        return self.query('SELECT * FROM Marketplace_Events ORDER BY Id')








############################################################
# DecodeTests
############################################################

class DecodeTests(unittest.TestCase):

    def test_a_listing(self):
        log = helpers.make_log('Listed', helpers.PUGS, 0, helpers.SELLER, 9712004, price=helpers.wei('0.08'),
                               tx_hash=helpers.TX['pug0Listed'])
        self.assertEqual(_decode_log(log), {
            'BlockNumber': 9712004, 'Timestamp': helpers.block_time(9712004), 'TxHash': helpers.TX['pug0Listed'],
            'LogIndex': 0, 'EventType': 'Listed', 'NftAddress': helpers.PUGS, 'TokenId': '0',
            'Seller': helpers.SELLER, 'Buyer': None, 'Price': str(helpers.wei('0.08')),
        })

    def test_a_price_update(self):
        log = helpers.make_log('Updated', helpers.PUGS, 0, helpers.SELLER, 9712377, log_index=7, price=helpers.wei('0.05'))
        decoded = _decode_log(log)
        self.assertEqual((decoded['EventType'], decoded['Seller'], decoded['Price'], decoded['LogIndex']),
                         ('Updated', helpers.SELLER, str(helpers.wei('0.05')), 7))

    def test_a_sale_names_the_buyer_as_actor_and_the_seller_from_the_data(self):
        log = helpers.make_log('Bought', helpers.PUGS, 2, helpers.BUYER, 9712502, price=helpers.wei('0.03'), seller=helpers.STUDENT)
        decoded = _decode_log(log)
        self.assertEqual((decoded['EventType'], decoded['Buyer'], decoded['Seller'], decoded['Price']),
                         ('Bought', helpers.BUYER, helpers.STUDENT, str(helpers.wei('0.03'))))

    def test_a_cancellation_carries_no_price(self):
        decoded = _decode_log(helpers.make_log('Canceled', helpers.ART, 3, helpers.SELLER, 9712801))
        self.assertEqual((decoded['EventType'], decoded['Seller'], decoded['Buyer'], decoded['Price']),
                         ('Canceled', helpers.SELLER, None, None))

    def test_a_cancellation_ignores_data_it_does_not_need(self):
        log = helpers.make_log('Canceled', helpers.ART, 3, helpers.SELLER, 9712801)
        log['data'] = '0x' + 'ff' * 32
        self.assertEqual(_decode_log(log)['EventType'], 'Canceled')

    def test_addresses_are_lowercased(self):
        log = helpers.make_log('Listed', helpers.PUGS, 0, helpers.SELLER, 100, price=1)
        log['topics'] = [log['topics'][0]] + [topic.upper().replace('0X', '0x') for topic in log['topics'][1:]]
        decoded = _decode_log(log)
        self.assertEqual((decoded['Seller'], decoded['NftAddress']), (helpers.SELLER, helpers.PUGS))

    def test_token_ids_and_prices_of_any_width_become_decimal_strings(self):
        biggest = 2 ** 256 - 1
        decoded = _decode_log(helpers.make_log('Listed', helpers.ART, biggest, helpers.SELLER, 100, price=biggest))
        self.assertEqual((decoded['TokenId'], decoded['Price']), (str(biggest), str(biggest)))

    def test_etherscans_bare_zero_and_a_missing_time_read_as_zero(self):
        log = helpers.make_log('Listed', helpers.PUGS, 0, helpers.SELLER, 100, price=1)
        log['timeStamp'] = '0x'
        self.assertEqual((_decode_log(log)['LogIndex'], _decode_log(log)['Timestamp']), (0, 0))
        del log['timeStamp']
        self.assertEqual(_decode_log(log)['Timestamp'], 0)

    def test_logs_of_another_shape_are_skipped(self):
        listing = helpers.make_log('Listed', helpers.PUGS, 0, helpers.SELLER, 100, price=1)
        sale = helpers.make_log('Bought', helpers.PUGS, 0, helpers.BUYER, 100, price=1, seller=helpers.SELLER)
        cases = {
            'a topic too few': {**listing, 'topics': listing['topics'][:3]},
            'a topic too many': {**listing, 'topics': listing['topics'] + ['0x' + '00' * 32]},
            'no topics at all': {**listing, 'topics': []},
            'an unknown signature': {**listing, 'topics': ['0x' + helpers.keccak256(b'Transfer(address,address,uint256)').hex()] + listing['topics'][1:]},
            'a listing without its price': {**listing, 'data': '0x'},
            'a sale without its price': {**sale, 'data': sale['data'][:66]},
        }
        for case, log in cases.items():
            with self.subTest(case=case):
                self.assertIsNone(_decode_log(log))








############################################################
# ReplayTests
############################################################

class ReplayTests(IndexerTestCase):

    def test_the_story_replays_into_the_listings_the_gui_assumes(self):
        self.store(helpers.STORY_LOGS)
        self.assertEqual(self.listings(), STORY_LISTINGS)

    def test_every_event_of_the_story_is_stored(self):
        stored, _ = self.store(helpers.STORY_LOGS)
        self.assertEqual(stored, 9)
        self.assertEqual([event['EventType'] for event in self.events()],
                         ['Listed', 'Listed', 'Listed', 'Updated', 'Bought', 'Listed', 'Listed', 'Canceled', 'Listed'])

    def test_logs_arriving_out_of_order_are_stored_in_chain_order(self):
        self.store(list(reversed(helpers.STORY_LOGS)))
        blocks = [event['BlockNumber'] for event in self.events()]
        self.assertEqual(blocks, sorted(blocks))
        self.assertEqual(self.listings(), STORY_LISTINGS)

    def test_within_a_block_the_log_index_decides(self):
        # Listed then Canceled in one block: replayed the other
        # way round the token would stay on sale
        listed = helpers.make_log('Listed', helpers.ART, 4, helpers.SELLER, 500, log_index=2, price=1)
        canceled = helpers.make_log('Canceled', helpers.ART, 4, helpers.SELLER, 500, log_index=5)
        self.store([canceled, listed])
        self.assertEqual([event['EventType'] for event in self.events()], ['Listed', 'Canceled'])
        self.assertEqual(self.listings(), [])

    def test_a_rescan_of_the_overlap_stores_nothing_twice(self):
        self.store(helpers.STORY_LOGS)
        stored, _ = self.store(helpers.STORY_LOGS)
        self.assertEqual(stored, 9)                          # the count includes the re-read overlap
        self.assertEqual(len(self.events()), 9)
        self.assertEqual(self.listings(), STORY_LISTINGS)

    def test_a_price_update_keeps_the_seller_and_moves_the_listing_to_its_block(self):
        self.store(helpers.STORY_LOGS[:1])
        self.store(helpers.STORY_LOGS[3:4])
        self.assertEqual(self.listings(), [{'NftAddress': helpers.PUGS, 'TokenId': '0', 'Seller': helpers.SELLER,
                                            'Price': str(helpers.wei('0.05')), 'ListedBlock': 9712377}])

    def test_a_sale_and_a_cancellation_take_the_token_off_the_market(self):
        self.store(helpers.STORY_LOGS)
        listed = {(row['NftAddress'], row['TokenId']) for row in self.listings()}
        self.assertNotIn((helpers.PUGS, '2'), listed)
        self.assertNotIn((helpers.ART, '3'), listed)

    def test_a_token_sold_and_listed_again_is_on_sale_by_its_new_owner(self):
        relisted = helpers.make_log('Listed', helpers.PUGS, 2, helpers.BUYER, 9712600, price=helpers.wei('0.04'))
        self.store(helpers.STORY_LOGS + [relisted])
        row = next(row for row in self.listings() if (row['NftAddress'], row['TokenId']) == (helpers.PUGS, '2'))
        self.assertEqual((row['Seller'], row['Price']), (helpers.BUYER, str(helpers.wei('0.04'))))

    def test_the_scan_position_and_its_time_are_written_with_the_batch(self):
        self.store(helpers.STORY_LOGS, scanned_to=9713040)
        self.assertEqual((self.state('LastScannedBlock'), self.state('LastScannedAt')), ('9713040', str(SCANNED_AT)))

    def test_an_empty_batch_still_advances_the_scan_position(self):
        self.store([], scanned_to=9713100)
        self.assertEqual(self.state('LastScannedBlock'), '9713100')

    def test_undecodable_logs_are_skipped_with_a_warning(self):
        stranger = dict(helpers.STORY_LOGS[0], topics=['0x' + 'ee' * 32] + helpers.STORY_LOGS[0]['topics'][1:])
        stored, printed = self.store([stranger] + helpers.STORY_LOGS[1:2])
        self.assertEqual(stored, 1)
        self.assertIn('[indexer] warning: 1 logs skipped — event signatures do not match the known ABI', printed)

    def test_a_batch_is_stored_all_or_nothing(self):
        # The database fails half way through — every event written,
        # the first listing not: no event, no listing and no scan
        # position may survive, the next scan redoes the whole batch
        failing = failing_connection(self.db_path, fail_on='Marketplace_ActiveListings')
        with mock.patch('app.marketplace.indexer.get_db_connection', side_effect=lambda: failing):
            with self.assertRaises(sqlite3.OperationalError):
                self.store(helpers.STORY_LOGS)
        self.assertEqual((self.events(), self.listings(), self.state('LastScannedBlock')), ([], [], None))








############################################################
# ReorgTests
############################################################
#
# A reorg near the tip, seen the way the loop sees it: the
# overlap is fetched again — rescan() hands the indexer only
# what the chain now holds from the window's start on, the
# way Etherscan answers — and the chain holds something else
# for it than what was stored.
############################################################

class ReorgTests(IndexerTestCase):

    def rescan(self, chain, from_block):
        self.store([log for log in chain if int(log['blockNumber'], 16) >= from_block], from_block=from_block)

    def test_an_event_a_reorg_dropped_is_dropped_from_the_marketplace_too(self):
        dropped = helpers.make_log('Listed', helpers.ART, 9, helpers.SELLER, helpers.TIP_BLOCK - 3, price=1)
        self.store(helpers.STORY_LOGS + [dropped])
        self.rescan(helpers.STORY_LOGS, from_block=helpers.TIP_BLOCK - REORG_OVERLAP_BLOCKS)
        self.assertEqual(self.query('SELECT * FROM Marketplace_Events WHERE TxHash = ?', (dropped['transactionHash'],)), [])
        self.assertEqual(self.listings(), STORY_LISTINGS)

    def test_a_dropped_sale_puts_the_token_back_on_sale(self):
        # PUG #2's sale, the last word on it, is gone: its listing
        # below the window decides again
        self.store(helpers.STORY_LOGS)
        bought = helpers.STORY_LOGS[4]
        self.rescan([log for log in helpers.STORY_LOGS if log is not bought], from_block=9712400)
        row = next(row for row in self.listings() if (row['NftAddress'], row['TokenId']) == (helpers.PUGS, '2'))
        self.assertEqual(row, {'NftAddress': helpers.PUGS, 'TokenId': '2', 'Seller': helpers.STUDENT,
                               'Price': str(helpers.wei('0.03')), 'ListedBlock': 9712240})

    def test_a_dropped_price_update_brings_back_the_price_before_it(self):
        repriced = helpers.make_log('Updated', helpers.PUGS, 1, helpers.STUDENT, helpers.TIP_BLOCK - 2, price=helpers.wei('0.2'))
        self.store(helpers.STORY_LOGS + [repriced])
        self.rescan(helpers.STORY_LOGS, from_block=helpers.TIP_BLOCK - REORG_OVERLAP_BLOCKS)
        self.assertEqual(self.listings(), STORY_LISTINGS)

    def test_a_transaction_mined_again_after_a_reorg_is_one_event(self):
        # At another block and log index, its old block below the
        # window
        tx_hash = '0x' + 'cd' * 32
        self.store([helpers.make_log('Listed', helpers.ART, 9, helpers.SELLER, helpers.TIP_BLOCK - 3, log_index=2, price=1, tx_hash=tx_hash)])
        self.rescan([helpers.make_log('Listed', helpers.ART, 9, helpers.SELLER, helpers.TIP_BLOCK - 1, log_index=0, price=1, tx_hash=tx_hash)],
                    from_block=helpers.TIP_BLOCK - 1)
        self.assertEqual([(row['BlockNumber'], row['LogIndex']) for row in self.query('SELECT * FROM Marketplace_Events WHERE TxHash = ?', (tx_hash,))],
                         [(helpers.TIP_BLOCK - 1, 0)])

    def test_row_ids_follow_the_chain_after_a_reorg(self):
        # The feed lists events by row id: one the new chain mined
        # between two stored ones must come out between them
        self.store(helpers.STORY_LOGS)
        late = helpers.make_log('Listed', helpers.ART, 9, helpers.SELLER, 9712700, price=1)
        self.rescan(helpers.STORY_LOGS + [late], from_block=9712600)
        blocks = [event['BlockNumber'] for event in self.events()]
        self.assertEqual(blocks, sorted(blocks))
        self.assertIn(9712700, blocks)








############################################################
# ResetTests
############################################################

class ResetTests(IndexerTestCase):

    def reset(self):
        with helpers.quiet() as printed:
            reset_if_contract_changed()
        return printed.getvalue()

    def test_a_fresh_database_is_marked_with_the_contract(self):
        printed = self.reset()
        self.assertEqual(self.state('ContractAddress'), helpers.TEST_MARKETPLACE.lower())
        self.assertIn(f'[indexer] marketplace contract is {helpers.TEST_MARKETPLACE.lower()} (database was built for: unset)', printed)

    def test_the_same_contract_changes_nothing(self):
        self.reset()
        self.store(helpers.STORY_LOGS)
        printed = self.reset()
        self.assertEqual(printed, '')
        self.assertEqual(len(self.events()), 9)
        self.assertEqual(self.state('LastScannedBlock'), str(helpers.TIP_BLOCK))

    def test_another_contract_wipes_the_derived_state_and_backfills_from_scratch(self):
        self.seed_state('ContractAddress', '0x' + '77' * 20)
        self.store(helpers.STORY_LOGS)
        printed = self.reset()
        self.assertEqual((self.events(), self.listings(), self.state('LastScannedBlock')), ([], [], None))
        self.assertEqual(self.state('ContractAddress'), helpers.TEST_MARKETPLACE.lower())
        self.assertIn(f'(database was built for: {"0x" + "77" * 20})', printed)

    def test_another_contract_also_forgets_when_the_old_one_was_scanned(self):
        # /api/stats would pair "no block scanned" with the old
        # contract's time
        self.seed_state('ContractAddress', '0x' + '77' * 20)
        self.store(helpers.STORY_LOGS)
        self.reset()
        self.assertIsNone(self.state('LastScannedAt'))

    def test_the_archive_survives_a_contract_change(self):
        # It spans every contract generation — that is its point
        self.seed_state('ContractAddress', '0x' + '77' * 20)
        self.seed_pin(helpers.PUGS, 0, 'metadata', 'pinned', cid='bafy-meta')
        self.reset()
        self.assertEqual(len(self.query('SELECT * FROM Pinned_Files')), 1)

    def test_the_configured_address_is_compared_whatever_its_case(self):
        self.seed_state('ContractAddress', helpers.TEST_MARKETPLACE.lower())
        self.store(helpers.STORY_LOGS)
        self.assertEqual(self.reset(), '')
        self.assertEqual(len(self.events()), 9)








############################################################
# LoopTests
############################################################
#
# One or two rounds of the daemon body: the poll pause (or
# the retry pause) at the round's end raises StopLoop.
############################################################

class LoopTests(IndexerTestCase):

    def run_rounds(self, rounds=1):
        pause = helpers.sleeps(stop_at=rounds)
        with mock.patch('app.marketplace.indexer.time.sleep', side_effect=pause), helpers.quiet() as printed:
            with self.assertRaises(helpers.StopLoop):
                self.indexer._loop()
        return pause.paused, printed.getvalue()

    def test_the_first_run_backfills_from_the_deployment_block(self):
        paused, printed = self.run_rounds()
        self.assertEqual(self.etherscan.called('contract_creation'), [(helpers.TEST_MARKETPLACE,)])
        self.assertEqual(self.etherscan.called('get_logs'), [(helpers.TEST_MARKETPLACE, helpers.DEPLOYMENT_BLOCK - REORG_OVERLAP_BLOCKS)])
        self.assertEqual(self.listings(), STORY_LISTINGS)
        self.assertEqual(self.state('LastScannedBlock'), str(helpers.TIP_BLOCK))
        self.assertEqual(paused, [30])
        self.assertIn(f'[indexer] contract deployed at block {helpers.DEPLOYMENT_BLOCK} — backfilling from there', printed)
        self.assertIn(f'[indexer] stored 9 events, scanned to block {helpers.TIP_BLOCK}', printed)

    def test_a_restart_resumes_from_the_stored_block_minus_the_overlap(self):
        self.seed_state('LastScannedBlock', 9712900)
        self.run_rounds()
        self.assertEqual(self.etherscan.called('contract_creation'), [])
        self.assertEqual(self.etherscan.called('get_logs'), [(helpers.TEST_MARKETPLACE, 9712900 + 1 - REORG_OVERLAP_BLOCKS)])
        self.assertEqual(self.state('LastScannedBlock'), str(helpers.TIP_BLOCK))

    def test_nothing_is_fetched_while_the_tip_has_not_moved(self):
        self.seed_state('LastScannedBlock', helpers.TIP_BLOCK)
        paused, _ = self.run_rounds()
        self.assertEqual(self.etherscan.called('block_number'), [()])
        self.assertEqual(self.etherscan.called('get_logs'), [])
        self.assertEqual(paused, [30])

    def test_the_overlap_never_reaches_below_block_zero(self):
        self.seed_state('LastScannedBlock', 3)
        self.etherscan.tip = 20
        self.run_rounds()
        self.assertEqual(self.etherscan.called('get_logs'), [(helpers.TEST_MARKETPLACE, 0)])

    def test_every_round_reads_the_tip_and_scans_on_from_the_last_one(self):
        self.seed_state('LastScannedBlock', 9712000)
        moving_tip = iter([9712500, helpers.TIP_BLOCK])
        self.etherscan.block_number = lambda: next(moving_tip)
        self.run_rounds(rounds=2)
        self.assertEqual([call[1] for call in self.etherscan.called('get_logs')],
                         [9712000 + 1 - REORG_OVERLAP_BLOCKS, 9712500 + 1 - REORG_OVERLAP_BLOCKS])
        self.assertEqual(self.state('LastScannedBlock'), str(helpers.TIP_BLOCK))

    def test_a_failed_scan_is_retried_after_ten_seconds(self):
        self.etherscan.fail('get_logs', RuntimeError('Etherscan getLogs error: NOTOK Max rate limit reached'), once=True)
        paused, printed = self.run_rounds(rounds=2)
        self.assertEqual(paused, [10, 30])
        self.assertIn('[indexer] error: Etherscan getLogs error: NOTOK Max rate limit reached — retrying in 10s', printed)
        self.assertEqual(self.listings(), STORY_LISTINGS)

    def test_a_database_busy_at_boot_is_retried(self):
        # dbgate holding a write as the backend starts
        connections = [helpers.sqlite_error(), self.connect(), self.connect()]
        with mock.patch('app.marketplace.indexer.get_db_connection', side_effect=connections):
            paused, printed = self.run_rounds(rounds=2)
        self.assertEqual(paused, [10, 30])
        self.assertIn('[indexer] error: database is locked — retrying in 10s', printed)
        self.assertEqual(self.listings(), STORY_LISTINGS)

    def test_an_unknown_deployment_is_looked_up_again_before_any_scan(self):
        self.etherscan.fail('contract_creation', RuntimeError('Etherscan getcontractcreation error: NOTOK'), once=True)
        paused, _ = self.run_rounds(rounds=2)
        self.assertEqual(len(self.etherscan.called('contract_creation')), 2)
        self.assertEqual(len(self.etherscan.called('get_logs')), 1)
        self.assertEqual(paused, [10, 30])

    def test_start_runs_the_loop_in_a_daemon_thread(self):
        with mock.patch('app.marketplace.indexer.threading.Thread') as thread:
            self.indexer.start()
        thread.assert_called_once_with(target=self.indexer._loop, daemon=True)
        thread.return_value.start.assert_called_once_with()








############################################################
# failing_connection
############################################################
#
# A connection to the test file whose execute raises a disk
# error at the first statement naming the given table — a
# write that fails half way through a batch.
#
# Used by:
#   - ReplayTests.test_a_batch_is_stored_all_or_nothing
############################################################

def failing_connection(path, fail_on):

    class FailingConnection(sqlite3.Connection):

        def execute(self, sql, *args, **kwargs):
            if fail_on in sql:
                raise sqlite3.OperationalError('disk I/O error')
            return super().execute(sql, *args, **kwargs)

    connection = sqlite3.connect(path, factory=FailingConnection)
    connection.row_factory = sqlite3.Row
    return connection


if __name__ == '__main__':
    unittest.main()
