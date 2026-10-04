############################################################
#  [*] Database helper and schema regression tests
#
#  What every SQL statement of the backend rides on: one
#  SQLite file whose path comes from DB_PATH, rows readable by
#  column name, and a schema built idempotently on every boot.
#  Pinned down here: the four tables with their columns; the
#  uniqueness that makes re-scanning a block range harmless
#  (an event is its transaction and log index), one listing
#  per token, one archive row per token and file kind; uint256
#  token ids and prices kept exactly, as TEXT; the indexes the
#  per-token reads use; and a second init that changes
#  nothing. Offline, on throwaway files built with the REAL
#  schema.
############################################################


import sqlite3
import unittest
from unittest import mock

from tests import helpers

from app.database import db as db_module
from app.database.db_init import init_db








############################################################
# ConnectionTests
############################################################

class ConnectionTests(helpers.DbTestCase):

    def test_the_default_path_comes_from_db_path_at_import(self):
        # The test package points it at a scratch file before
        # anything imports the module — in the running container
        # the default is the live database
        self.assertEqual(db_module.get_db_connection.__defaults__[0], helpers.TEST_ENV['DB_PATH'])

    def test_rows_are_read_by_column_name(self):
        self.seed_state('LastScannedBlock', 42)
        with self.connect() as conn:
            row = conn.execute("SELECT Key, Value FROM Indexer_State").fetchone()
        self.assertEqual((row['Key'], row['Value']), ('LastScannedBlock', '42'))








############################################################
# SchemaTests
############################################################

class SchemaTests(helpers.DbTestCase):

    def columns(self, table):
        return [row['name'] for row in self.query(f'PRAGMA table_info([{table}])')]

    def test_the_four_tables(self):
        tables = {row['name'] for row in self.query("SELECT name FROM sqlite_master WHERE type = 'table'")}
        self.assertEqual(tables, {'Marketplace_Events', 'Marketplace_ActiveListings', 'Pinned_Files', 'Indexer_State'})

    def test_their_columns(self):
        self.assertEqual(self.columns('Marketplace_Events'), [
            'Id', 'BlockNumber', 'Timestamp', 'TxHash', 'LogIndex', 'EventType',
            'NftAddress', 'TokenId', 'Seller', 'Buyer', 'Price',
        ])
        self.assertEqual(self.columns('Marketplace_ActiveListings'), ['NftAddress', 'TokenId', 'Seller', 'Price', 'ListedBlock'])
        self.assertEqual(self.columns('Pinned_Files'), ['Id', 'NftAddress', 'TokenId', 'Kind', 'Uri', 'Cid', 'Status', 'Attempts'])
        self.assertEqual(self.columns('Indexer_State'), ['Key', 'Value'])

    def test_init_is_idempotent_and_keeps_the_data(self):
        self.seed_event('Listed', helpers.PUGS, 0, 100, seller=helpers.SELLER, price=1)
        with mock.patch('app.database.db_init.get_db_connection', side_effect=self.connect):
            init_db()
        self.assertEqual(len(self.query('SELECT * FROM Marketplace_Events')), 1)

    def test_the_per_token_reads_use_the_index(self):
        # Addresses are stored lowercase so the lookup compares
        # the column as it is — no LOWER() bypassing the index
        plan = self.query('''
            EXPLAIN QUERY PLAN SELECT * FROM Marketplace_Events
            WHERE NftAddress = ? AND TokenId = ? ORDER BY Id DESC
        ''', (helpers.PUGS, '0'))
        self.assertIn('idx_events_nft', ' '.join(row['detail'] for row in plan))

    def test_the_type_index_exists(self):
        indexes = {row['name'] for row in self.query("SELECT name FROM sqlite_master WHERE type = 'index'")}
        self.assertIn('idx_events_type', indexes)








############################################################
# UniquenessTests
############################################################

class UniquenessTests(helpers.DbTestCase):

    def test_an_event_is_its_transaction_and_log_index(self):
        self.seed_event('Listed', helpers.PUGS, 0, 100, log_index=2, tx_hash='0xaa', seller=helpers.SELLER, price=1)
        with self.assertRaises(sqlite3.IntegrityError):
            self.seed_event('Listed', helpers.PUGS, 0, 100, log_index=2, tx_hash='0xaa', seller=helpers.SELLER, price=1)

    def test_a_rescan_inserting_or_ignoring_never_doubles_an_event(self):
        insert = '''
            INSERT OR IGNORE INTO Marketplace_Events
                (BlockNumber, Timestamp, TxHash, LogIndex, EventType, NftAddress, TokenId, Seller, Buyer, Price)
            VALUES (100, 1, '0xaa', 2, 'Listed', ?, '0', ?, NULL, '1')
        '''
        self.execute(insert, (helpers.PUGS, helpers.SELLER))
        self.execute(insert, (helpers.PUGS, helpers.SELLER))
        self.assertEqual(len(self.query('SELECT * FROM Marketplace_Events')), 1)

    def test_two_logs_of_one_transaction_are_two_events(self):
        self.seed_event('Bought', helpers.PUGS, 2, 100, log_index=3, tx_hash='0xbb', seller=helpers.STUDENT,
                        buyer=helpers.BUYER, price=1)
        self.seed_event('Listed', helpers.PUGS, 2, 100, log_index=4, tx_hash='0xbb', seller=helpers.BUYER, price=2)
        self.assertEqual(len(self.query('SELECT * FROM Marketplace_Events')), 2)

    def test_one_listing_per_token(self):
        self.seed_listing(helpers.PUGS, 0, helpers.SELLER, 1, 100)
        with self.assertRaises(sqlite3.IntegrityError):
            self.seed_listing(helpers.PUGS, 0, helpers.STUDENT, 2, 101)

    def test_one_archive_row_per_token_and_kind_with_attempts_starting_at_zero(self):
        self.execute("INSERT INTO Pinned_Files (NftAddress, TokenId, Kind, Uri, Status) VALUES (?, '0', 'metadata', '', 'pending')",
                     (helpers.PUGS,))
        self.assertEqual(self.query('SELECT Attempts FROM Pinned_Files')[0]['Attempts'], 0)
        with self.assertRaises(sqlite3.IntegrityError):
            self.seed_pin(helpers.PUGS, 0, 'metadata', 'pinned')
        self.seed_pin(helpers.PUGS, 0, 'image', 'pinned')

    def test_one_value_per_state_key(self):
        self.execute("INSERT INTO Indexer_State (Key, Value) VALUES ('LastScannedBlock', '1')")
        with self.assertRaises(sqlite3.IntegrityError):
            self.execute("INSERT INTO Indexer_State (Key, Value) VALUES ('LastScannedBlock', '2')")








############################################################
# Uint256Tests
############################################################

class Uint256Tests(helpers.DbTestCase):

    def test_token_ids_and_prices_beyond_64_bits_come_back_exactly(self):
        biggest = 2 ** 256 - 1
        self.seed_event('Listed', helpers.ART, biggest, 100, seller=helpers.SELLER, price=biggest)
        row = self.query('SELECT TokenId, Price FROM Marketplace_Events')[0]
        self.assertEqual((int(row['TokenId']), int(row['Price'])), (biggest, biggest))

    def test_required_fields_are_required(self):
        with self.assertRaises(sqlite3.IntegrityError):
            self.execute("INSERT INTO Marketplace_Events (BlockNumber, LogIndex, EventType, NftAddress, TokenId) VALUES (1, 0, 'Listed', '0xaa', '0')")


if __name__ == '__main__':
    unittest.main()
