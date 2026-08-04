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
#  generation). Every
#  incremental scan re-fetches a small overlap BELOW the
#  resume point so a testnet reorg near the tip cannot leave
#  a stale event behind — re-storing is harmless because
#  events are UNIQUE(TxHash, LogIndex) and the listing
#  replay is ordered and idempotent.
#
#  Used by:
#    - main.py — one instance, started at startup (STEP 3)
############################################################


import time
import threading

from app.database.db import get_db_connection
from app.marketplace.etherscan import hex_int
from main import NFT_MARKETPLACE_ADDRESS, INDEXER_POLL_SECONDS


# keccak-256 topic hashes of the three contract events —
# verified against the DEPLOYED bytecode of
# NFT_MARKETPLACE_ADDRESS, not just the source:
#   ItemListed(address,address,uint256,uint256)  (also emitted by updateListing)
#   ItemBought(address,address,uint256,uint256)
#   ItemCanceled(address,address,uint256)
TOPIC_ITEM_LISTED = '0xd547e933094f12a9159076970143ebe73234e64480317844b0dcb36117116de4'
TOPIC_ITEM_BOUGHT = '0x263223b1dd81e51054a4e6f791d45a4a1ddb4aadcd93a2dfd892615c3fdac187'
TOPIC_ITEM_CANCELED = '0x9ba1a3cb55ce8d63d072a886f94d2a744f50cddf82128e897d0661f5ec623158'


# How many blocks an incremental scan re-fetches BELOW the
# stored resume point — a small overlap so a reorg near the
# tip can't leave a stale event behind (storage dedupes, the
# ordered replay converges either way)
REORG_OVERLAP_BLOCKS = 10









############################################################
# reset_if_contract_changed
############################################################
#
# Compares NFT_MARKETPLACE_ADDRESS against the address the
# database was built for (Indexer_State 'ContractAddress',
# lowercase). On a mismatch — including a database from
# before this key existed — the DERIVED marketplace state
# (events, active listings, scan position) is wiped in ONE
# transaction and the address recorded, so the daemons then
# backfill the new contract from its deployment block. A
# crash mid-reset simply re-triggers the reset on the next
# boot.
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
        conn.execute("DELETE FROM Indexer_State WHERE Key = 'LastScannedBlock'")
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
# that don't match the three known signatures — including
# logs with a different topic COUNT, which a modified
# contract with re-declared events would emit; skipping them
# beats crashing the scan loop on a malformed decode. All
# three events index the same three params (actor,
# nftAddress, tokenId → topics 1..3); price rides in the
# data word on Listed/Bought. Addresses are lowercased here
# once — everything downstream compares lowercase.
#
# Used by:
#   - MarketplaceIndexer._store_logs (below)
############################################################

def _decode_log(log):
    if len(log.get('topics') or []) != 4:
        return None

    topic0 = log['topics'][0]
    actor = '0x' + log['topics'][1][-40:]
    nft_address = '0x' + log['topics'][2][-40:]
    token_id = str(hex_int(log['topics'][3]))
    data = log.get('data', '0x')
    price = str(hex_int(data)) if len(data) > 2 else None

    base = {
        'BlockNumber': hex_int(log['blockNumber']),
        'Timestamp': hex_int(log.get('timeStamp') or '0x'),
        'TxHash': log['transactionHash'],
        'LogIndex': hex_int(log['logIndex']),
        'NftAddress': nft_address.lower(),
        'TokenId': token_id,
        'Seller': None,
        'Buyer': None,
        'Price': price,
    }

    if topic0 == TOPIC_ITEM_LISTED:
        return {**base, 'EventType': 'Listed', 'Seller': actor.lower()}
    if topic0 == TOPIC_ITEM_BOUGHT:
        return {**base, 'EventType': 'Bought', 'Buyer': actor.lower()}
    if topic0 == TOPIC_ITEM_CANCELED:
        return {**base, 'EventType': 'Canceled', 'Seller': actor.lower()}
    return None









############################################################
# MarketplaceIndexer
############################################################
#
# One instance owns the whole sync. Methods in groups:
#
#   setup — __init__, start
#   scan  — _loop
#   store — _store_logs
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

        # STEP 1: the stored resume point — None on a fresh database,
        # resolved from the chain in the loop below (an Etherscan
        # hiccup at boot must retry, never kill the thread).
        # =============================================================
        with get_db_connection() as conn:
            row = conn.execute(
                "SELECT Value FROM Indexer_State WHERE Key = 'LastScannedBlock'"
            ).fetchone()
        last_scanned = int(row['Value']) if row else None


        # STEP 2: the scan loop — each fetch starts a small overlap
        # below the resume point (reorg safety, see the file header).
        # Any failure (rate limits included) just waits and retries.
        # ============================================================
        while True:
            try:
                # First run: the deployment block IS the start block
                if last_scanned is None:
                    last_scanned = self.etherscan.contract_creation(NFT_MARKETPLACE_ADDRESS)['block'] - 1
                    print(f'[indexer] contract deployed at block {last_scanned + 1} — backfilling from there', flush=True)

                latest_block = self.etherscan.block_number()

                if last_scanned < latest_block:
                    from_block = max(0, last_scanned + 1 - REORG_OVERLAP_BLOCKS)
                    raw_logs = self.etherscan.get_logs(NFT_MARKETPLACE_ADDRESS, from_block)
                    stored = self._store_logs(raw_logs, latest_block)
                    if stored > 0:
                        print(f'[indexer] stored {stored} events, scanned to block {latest_block}', flush=True)
                    last_scanned = latest_block

                time.sleep(INDEXER_POLL_SECONDS)

            except Exception as error:
                print(f'[indexer] error: {error} — retrying in 10s', flush=True)
                time.sleep(10)






    ############################################################
    # _store_logs
    ############################################################
    #
    # Decodes and stores a batch of raw logs, replaying them
    # into Marketplace_ActiveListings in (block, logIndex)
    # order — Listed upserts (updateListing re-emits
    # ItemListed, so REPLACE also covers price changes),
    # Bought/Canceled deletes. LastScannedBlock advances in
    # the same transaction: a crash never leaves a
    # half-applied batch marked as done. Returns how many
    # events the batch held (dupes from the reorg overlap
    # included — they are ignored by the UNIQUE constraint).
    #
    # Used by:
    #   - _loop (above)
    ############################################################

    def _store_logs(self, raw_logs, scanned_to_block):
        events = [event for event in (_decode_log(log) for log in raw_logs) if event]
        events.sort(key=lambda event: (event['BlockNumber'], event['LogIndex']))

        # A modified/incompatible contract emits logs we can't
        # decode — an empty marketplace with THIS warning in the
        # logs says "wrong ABI", not "no activity"
        unknown = len(raw_logs) - len(events)
        if unknown > 0:
            print(f'[indexer] warning: {unknown} logs skipped — event signatures do not match the known ABI', flush=True)

        with get_db_connection() as conn:
            for event in events:

                # updateListing re-emits ItemListed — on-chain the
                # two are indistinguishable, but the REPLAY knows:
                # a Listed event for a token that already has an
                # active listing is a PRICE UPDATE, stored as its
                # own event type so the GUI can tell them apart
                if event['EventType'] == 'Listed':
                    existing = conn.execute('''
                        SELECT 1 FROM Marketplace_ActiveListings
                        WHERE NftAddress = :NftAddress AND TokenId = :TokenId
                    ''', event).fetchone()
                    if existing:
                        event['EventType'] = 'Updated'

                conn.execute('''
                    INSERT OR IGNORE INTO Marketplace_Events
                        (BlockNumber, Timestamp, TxHash, LogIndex, EventType, NftAddress, TokenId, Seller, Buyer, Price)
                    VALUES
                        (:BlockNumber, :Timestamp, :TxHash, :LogIndex, :EventType, :NftAddress, :TokenId, :Seller, :Buyer, :Price)
                ''', event)

                if event['EventType'] in ('Listed', 'Updated'):
                    conn.execute('''
                        INSERT OR REPLACE INTO Marketplace_ActiveListings
                            (NftAddress, TokenId, Seller, Price, ListedBlock)
                        VALUES
                            (:NftAddress, :TokenId, :Seller, :Price, :BlockNumber)
                    ''', event)
                else:
                    conn.execute('''
                        DELETE FROM Marketplace_ActiveListings
                        WHERE NftAddress = :NftAddress AND TokenId = :TokenId
                    ''', event)

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
