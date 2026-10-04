############################################################
#  [*] Database initialization
#
#  The whole schema, idempotent (CREATE IF NOT EXISTS —
#  safe on every boot). Four tables:
#
#    Marketplace_Events         — every contract event, one
#                                 row per log, kept in step
#                                 with the chain
#    Marketplace_ActiveListings — the CURRENT state derived
#                                 from the events
#    Pinned_Files               — the pinner's archive
#                                 inventory (IPFS CIDs per
#                                 token)
#    Indexer_State              — key/value scratch (the
#                                 scan position and time,
#                                 the contract it is for)
#
#  Addresses are stored LOWERCASE everywhere and queries
#  compare lowercase directly — no LOWER() on columns, which
#  would bypass the indexes. TokenId and Price are TEXT:
#  both are uint256 on-chain and can exceed SQLite's 64-bit
#  integers.
#
#  Used by:
#    - main.py — init_db() at startup (STEP 1)
############################################################


from .db import get_db_connection








############################################################
# init_db
############################################################
#
# Creates every table and index that does not exist yet —
# an existing database keeps its tables and its rows;
# nothing here migrates or drops.
#
# Used by:
#   - main.py — once at startup (STEP 1)
############################################################

def init_db():
    with get_db_connection() as conn:


        ######################## Marketplace event log ########################
        # EventType is 'Listed' / 'Updated' / 'Bought' / 'Canceled' — one
        # per contract event, a reprice being its own ItemUpdated event.
        # Buyer is NULL on everything but Bought rows, Price is NULL on
        # Canceled rows — mirroring what each contract event carries.
        # Timestamp is the block's unix time (Etherscan sends it with every
        # log). UNIQUE(TxHash, LogIndex) keeps one row per log whatever a
        # scan reads twice; the indexer rewrites its re-scanned window in
        # chain order, so the Ids follow the chain.
        conn.execute('''
            CREATE TABLE IF NOT EXISTS [Marketplace_Events] (
                [Id] INTEGER PRIMARY KEY,
                [BlockNumber] INTEGER NOT NULL,
                [Timestamp] INTEGER NULL,
                [TxHash] TEXT NOT NULL,
                [LogIndex] INTEGER NOT NULL,
                [EventType] TEXT NOT NULL,
                [NftAddress] TEXT NOT NULL,
                [TokenId] TEXT NOT NULL,
                [Seller] TEXT NULL,
                [Buyer] TEXT NULL,
                [Price] TEXT NULL,
                CONSTRAINT [sqlite_autoindex_Marketplace_Events_1] UNIQUE ([TxHash], [LogIndex])
            );
        ''')

        conn.execute('''
            CREATE INDEX IF NOT EXISTS idx_events_nft ON Marketplace_Events(NftAddress, TokenId)
        ''')
        conn.execute('''
            CREATE INDEX IF NOT EXISTS idx_events_type ON Marketplace_Events(EventType, Id)
        ''')
        #######################################################################



        ######################## Current listings state ########################
        # Re-derived by the indexer for every token a scan touches, from the
        # token's latest event: a listing or a reprice puts its row in, a
        # sale or a cancellation takes it out. What is in this table IS the
        # storefront.
        conn.execute('''
            CREATE TABLE IF NOT EXISTS [Marketplace_ActiveListings] (
                [NftAddress] TEXT NOT NULL,
                [TokenId] TEXT NOT NULL,
                [Seller] TEXT NOT NULL,
                [Price] TEXT NOT NULL,
                [ListedBlock] INTEGER NOT NULL,
                PRIMARY KEY ([NftAddress], [TokenId])
            );
        ''')
        ########################################################################



        ######################## Pinned NFT files #############################
        # The pinner's archive inventory: one row per (token, kind) where
        # Kind is 'metadata' or 'image'. Status walks pending → pinned /
        # skipped (URI is not IPFS-addressed, nothing to pin) / invalid
        # (wrongly minted metadata — no image to look for) / unreachable
        # (content gone from the network before we could replicate it —
        # the loss is recorded, not silent). Uri is the raw URI as found
        # on-chain / in metadata; Cid the extracted IPFS root — both as
        # far as known, a lost file's row included.
        conn.execute('''
            CREATE TABLE IF NOT EXISTS [Pinned_Files] (
                [Id] INTEGER PRIMARY KEY,
                [NftAddress] TEXT NOT NULL,
                [TokenId] TEXT NOT NULL,
                [Kind] TEXT NOT NULL,
                [Uri] TEXT NOT NULL,
                [Cid] TEXT NULL,
                [Status] TEXT NOT NULL,
                [Attempts] INTEGER NOT NULL DEFAULT 0,
                CONSTRAINT [sqlite_autoindex_Pinned_Files_1] UNIQUE ([NftAddress], [TokenId], [Kind])
            );
        ''')
        #######################################################################



        ######################## Indexer scratch state ########################
        # Key/value rows: LastScannedBlock — the indexer resumes from here
        # after a restart instead of re-scanning the whole chain;
        # LastScannedAt — when, for the GUI; ContractAddress — the contract
        # the derived tables were built for.
        conn.execute('''
            CREATE TABLE IF NOT EXISTS [Indexer_State] (
                [Key] TEXT NOT NULL,
                [Value] TEXT NOT NULL,
                PRIMARY KEY ([Key])
            );
        ''')
        #######################################################################
