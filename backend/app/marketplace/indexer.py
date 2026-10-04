############################################################
#  [*] Marketplace indexer — the chain → SQLite daemon
#
#  A background thread that keeps SQLite in sync with the
#  NftMarketplace contract on Sepolia: contract logs come
#  from the EtherscanClient (no block-range caps — see
#  etherscan.py), get decoded by hand into
#  Marketplace_Events and replayed into
#  Marketplace_ActiveListings. Replaces the graph-node +
#  postgres + subgraph stack entirely.
#
#  The first run backfills from the contract's deployment
#  block — discovered live via Etherscan's contract-creation
#  lookup, never configured by hand; afterwards
#  LastScannedBlock in Indexer_State makes restarts
#  incremental. A CHANGED contract address resets the whole
#  derived marketplace state and backfills the new contract
#  from scratch (reset_if_contract_changed — the pinned-file
#  archive deliberately survives, spanning every contract
#  generation). Every incremental scan re-fetches a small
#  overlap BELOW the resume point, and what the chain holds
#  for that window now REPLACES what was stored for it: an
#  event a testnet reorg dropped near the tip is dropped
#  here too, a transaction mined again elsewhere is stored
#  once, at its new place, and every token the window
#  touched has its listing re-derived from its latest event.
#
#  Used by:
#    - main.py — one instance, started at startup (STEP 3)
############################################################


import time
import threading

from app.database.db import get_db_connection
from app.marketplace.etherscan import hex_int
from main import NFT_MARKETPLACE_ADDRESS, INDEXER_POLL_SECONDS, EVENT_TOPICS


# The topic hashes to match on — defined (hardcoded, on
# purpose) in main.py's EVENT_TOPICS, and pinned by the
# contract test suite (EventSignatures.t.sol) against what
# the contract really emits. The contract announces reprices
# as their own ItemUpdated event, so no replay guessing is
# ever needed.
TOPIC_ITEM_LISTED = EVENT_TOPICS['Listed']['topic0']
TOPIC_ITEM_UPDATED = EVENT_TOPICS['Updated']['topic0']
TOPIC_ITEM_BOUGHT = EVENT_TOPICS['Bought']['topic0']
TOPIC_ITEM_CANCELED = EVENT_TOPICS['Canceled']['topic0']


# How many blocks an incremental scan re-fetches BELOW the
# stored resume point — a small overlap so a reorg near the
# tip can't leave a stale event behind (the fetched window
# replaces what was stored for it)
REORG_OVERLAP_BLOCKS = 10









############################################################
# reset_if_contract_changed
############################################################
#
# Compares NFT_MARKETPLACE_ADDRESS against the address the
# database was built for (Indexer_State 'ContractAddress',
# lowercase). On a mismatch — including a database from
# before this key existed — the DERIVED marketplace state
# (events, active listings, the scan position and when it
# was reached) is wiped in ONE transaction and the address
# recorded, so the daemons then backfill the new contract
# from its deployment block. A crash mid-reset simply
# re-triggers the reset on the next boot.
#
# Pinned_Files and the kubo pins are deliberately NOT
# touched: the archive spans every contract generation —
# that is its whole point.
#
# Used by:
#   - main.py — startup STEP 3, before the daemons start
############################################################

def reset_if_contract_changed():
    current = NFT_MARKETPLACE_ADDRESS.lower()

    with get_db_connection() as conn:
        row = conn.execute(
            "SELECT Value FROM Indexer_State WHERE Key = 'ContractAddress'"
        ).fetchone()
        stored = row['Value'] if row else None

        if stored == current:
            return

        conn.execute('DELETE FROM Marketplace_Events')
        conn.execute('DELETE FROM Marketplace_ActiveListings')
        conn.execute("DELETE FROM Indexer_State WHERE Key IN ('LastScannedBlock', 'LastScannedAt')")
        conn.execute('''
            INSERT OR REPLACE INTO Indexer_State (Key, Value)
            VALUES ('ContractAddress', ?)
        ''', (current,))

    print(f'[indexer] marketplace contract is {current} (database was built for: {stored or "unset"}) '
          f'— marketplace state reset, backfilling from scratch', flush=True)









############################################################
# _decode_log
############################################################
#
# One raw log entry → a flat event dict, or None for logs
# that don't match the four known signatures — including
# logs with a different topic COUNT or a short data field,
# which a re-declared event would produce; skipping them
# beats crashing the scan loop on a malformed decode. All
# four events index the same three params (actor,
# nftAddress, tokenId → topics 1..3); the DATA field differs
# per event: price on Listed/Updated, (seller, price) on
# Bought, empty on Canceled. Addresses are lowercased here
# once — everything downstream compares lowercase.
#
# Used by:
#   - MarketplaceIndexer._store_logs (below)
############################################################

def _decode_log(log):
    if len(log.get('topics') or []) != 4:
        return None

    topic0 = log['topics'][0]
    actor = ('0x' + log['topics'][1][-40:]).lower()
    nft_address = ('0x' + log['topics'][2][-40:]).lower()
    token_id = str(hex_int(log['topics'][3]))

    # The data field as 32-byte words
    data = (log.get('data') or '0x')[2:]
    words = [data[i:i + 64] for i in range(0, len(data), 64)]

    base = {
        'BlockNumber': hex_int(log['blockNumber']),
        'Timestamp': hex_int(log.get('timeStamp') or '0x'),
        'TxHash': log['transactionHash'],
        'LogIndex': hex_int(log['logIndex']),
        'NftAddress': nft_address,
        'TokenId': token_id,
        'Seller': None,
        'Buyer': None,
        'Price': None,
    }

    if topic0 == TOPIC_ITEM_LISTED and len(words) >= 1:
        return {**base, 'EventType': 'Listed', 'Seller': actor, 'Price': str(int(words[0], 16))}
    if topic0 == TOPIC_ITEM_UPDATED and len(words) >= 1:
        return {**base, 'EventType': 'Updated', 'Seller': actor, 'Price': str(int(words[0], 16))}
    if topic0 == TOPIC_ITEM_BOUGHT and len(words) >= 2:
        return {**base, 'EventType': 'Bought', 'Buyer': actor,
                'Seller': ('0x' + words[0][-40:]).lower(), 'Price': str(int(words[1], 16))}
    if topic0 == TOPIC_ITEM_CANCELED:
        return {**base, 'EventType': 'Canceled', 'Seller': actor}
    return None









############################################################
# MarketplaceIndexer
############################################################
#
# One instance owns the whole sync. Methods in groups:
#
#   setup — __init__, start
#   scan  — _loop, _resume_point
#   store — _store_logs, _relist
#
# Used by:
#   - main.py — MarketplaceIndexer(EtherscanClient()).start()
############################################################

class MarketplaceIndexer:






    ############################################################
    # __init__
    ############################################################
    #
    # etherscan is an EtherscanClient — the indexer's only way
    # to the chain.
    #
    # Used by:
    #   - main.py — startup STEP 3
    ############################################################

    def __init__(self, etherscan):
        self.etherscan = etherscan






    ############################################################
    # start
    ############################################################
    #
    # Fires the daemon thread. daemon=True — the thread dies
    # with Flask, nothing to join on shutdown.
    #
    # Used by:
    #   - main.py — startup STEP 3
    ############################################################

    def start(self):
        threading.Thread(target=self._loop, daemon=True).start()






    ############################################################
    # _loop
    ############################################################
    #
    # The daemon body: resume, then poll. Whatever the gap
    # (first backfill or a 30-second poll window), it is one
    # logs fetch to the tip — 2 Etherscan calls per iteration,
    # none of the project's RPC credits.
    #
    # Used by:
    #   - start (above) — thread target
    ############################################################

    def _loop(self):
        # STEP 1: no resume point yet — the first round reads it, INSIDE
        # the retry loop: a database busy at boot (dbgate holding a
        # write) or an Etherscan hiccup must retry, never kill the
        # thread.
        # ==============================================================
        last_scanned = None


        # STEP 2: the scan loop — each fetch starts a small overlap
        # below the resume point (reorg safety, see the file header).
        # Any failure (rate limits included) just waits and retries.
        # ============================================================
        while True:
            try:
                if last_scanned is None:
                    last_scanned = self._resume_point()

                latest_block = self.etherscan.block_number()

                if last_scanned < latest_block:
                    from_block = max(0, last_scanned + 1 - REORG_OVERLAP_BLOCKS)
                    raw_logs = self.etherscan.get_logs(NFT_MARKETPLACE_ADDRESS, from_block)
                    stored = self._store_logs(raw_logs, from_block, latest_block)
                    if stored > 0:
                        print(f'[indexer] stored {stored} events, scanned to block {latest_block}', flush=True)
                    last_scanned = latest_block

                time.sleep(INDEXER_POLL_SECONDS)

            except Exception as error:
                print(f'[indexer] error: {error} — retrying in 10s', flush=True)
                time.sleep(10)






    ############################################################
    # _resume_point
    ############################################################
    #
    # The last block already scanned: LastScannedBlock when the
    # database has one, otherwise the block before the
    # contract's deployment, looked up live — the first scan
    # then starts at the deployment block itself.
    #
    # Used by:
    #   - _loop (above) — until it has a resume point
    ############################################################

    def _resume_point(self):
        with get_db_connection() as conn:
            row = conn.execute(
                "SELECT Value FROM Indexer_State WHERE Key = 'LastScannedBlock'"
            ).fetchone()
        if row:
            return int(row['Value'])

        deployed_in = self.etherscan.contract_creation(NFT_MARKETPLACE_ADDRESS)['block']
        print(f'[indexer] contract deployed at block {deployed_in} — backfilling from there', flush=True)
        return deployed_in - 1






    ############################################################
    # _store_logs
    ############################################################
    #
    # Stores one scan window — every log of the contract from
    # from_block to the tip, as the chain holds them NOW — and
    # brings Marketplace_ActiveListings in line with it, all in
    # ONE transaction together with the new LastScannedBlock:
    # a crash never leaves a half-applied window marked as
    # done. Returns how many events the window held (the
    # re-read overlap included).
    #
    # The window replaces what was stored for it, re-inserted
    # in chain order — the feed lists events by row id, so the
    # ids must keep following the chain. A transaction that
    # turns up in another block than the one stored was mined
    # again after a reorg: its old rows go, however far below
    # the window they sit. Etherscan's pages overlap by a block
    # (see etherscan.py) — the UNIQUE(TxHash, LogIndex)
    # constraint ignores the repeat.
    #
    # Used by:
    #   - _loop (above)
    ############################################################

    def _store_logs(self, raw_logs, from_block, scanned_to_block):
        events = [event for event in (_decode_log(log) for log in raw_logs) if event]
        events.sort(key=lambda event: (event['BlockNumber'], event['LogIndex']))

        # A modified/incompatible contract emits logs we can't
        # decode — an empty marketplace with THIS warning in the
        # logs says "wrong ABI", not "no activity"
        unknown = len(raw_logs) - len(events)
        if unknown > 0:
            print(f'[indexer] warning: {unknown} logs skipped — event signatures do not match the known ABI', flush=True)

        with get_db_connection() as conn:
            # STEP 1: the window as stored goes — its tokens noted, a
            # dropped event may have been the one that listed them
            # =======================================================
            touched = {(row['NftAddress'], row['TokenId']) for row in conn.execute(
                'SELECT NftAddress, TokenId FROM Marketplace_Events WHERE BlockNumber >= ?', (from_block,)
            )}
            conn.execute('DELETE FROM Marketplace_Events WHERE BlockNumber >= ?', (from_block,))


            # STEP 2: the window as the chain holds it now, in chain
            # order — each transaction's rows from another block first
            # removed, it was mined again
            # ========================================================
            for event in events:
                touched.update((row['NftAddress'], row['TokenId']) for row in conn.execute(
                    'SELECT NftAddress, TokenId FROM Marketplace_Events WHERE TxHash = ? AND BlockNumber != ?',
                    (event['TxHash'], event['BlockNumber'])
                ))
                conn.execute('DELETE FROM Marketplace_Events WHERE TxHash = ? AND BlockNumber != ?',
                             (event['TxHash'], event['BlockNumber']))
                conn.execute('''
                    INSERT OR IGNORE INTO Marketplace_Events
                        (BlockNumber, Timestamp, TxHash, LogIndex, EventType, NftAddress, TokenId, Seller, Buyer, Price)
                    VALUES
                        (:BlockNumber, :Timestamp, :TxHash, :LogIndex, :EventType, :NftAddress, :TokenId, :Seller, :Buyer, :Price)
                ''', event)
                touched.add((event['NftAddress'], event['TokenId']))


            # STEP 3: every touched token's listing re-derived, then the
            # scan position and its time
            # ==========================================================
            for nft_address, token_id in sorted(touched):
                self._relist(conn, nft_address, token_id)

            conn.execute('''
                INSERT OR REPLACE INTO Indexer_State (Key, Value)
                VALUES ('LastScannedBlock', ?)
            ''', (str(scanned_to_block),))

            # When the scan happened — the GUI shows data freshness
            conn.execute('''
                INSERT OR REPLACE INTO Indexer_State (Key, Value)
                VALUES ('LastScannedAt', ?)
            ''', (str(int(time.time())),))

        return len(events)






    ############################################################
    # _relist
    ############################################################
    #
    # One token's row in Marketplace_ActiveListings, re-derived
    # from its LATEST stored event: a listing or a price update
    # puts it on sale by that event's seller, at that price and
    # block — updateListing re-announces the whole listing, so
    # no earlier event is needed — while a sale, a cancellation
    # or no event at all takes it off the market. The same end
    # state a replay of the token's whole history reaches.
    #
    # Used by:
    #   - _store_logs (above) — inside its transaction
    ############################################################

    def _relist(self, conn, nft_address, token_id):
        latest = conn.execute('''
            SELECT EventType, Seller, Price, BlockNumber FROM Marketplace_Events
            WHERE NftAddress = ? AND TokenId = ?
            ORDER BY BlockNumber DESC, LogIndex DESC LIMIT 1
        ''', (nft_address, token_id)).fetchone()

        if latest and latest['EventType'] in ('Listed', 'Updated'):
            conn.execute('''
                INSERT OR REPLACE INTO Marketplace_ActiveListings
                    (NftAddress, TokenId, Seller, Price, ListedBlock)
                VALUES
                    (?, ?, ?, ?, ?)
            ''', (nft_address, token_id, latest['Seller'], latest['Price'], latest['BlockNumber']))
        else:
            conn.execute('''
                DELETE FROM Marketplace_ActiveListings
                WHERE NftAddress = ? AND TokenId = ?
            ''', (nft_address, token_id))
