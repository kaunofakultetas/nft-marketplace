############################################################
#  [*] Database initialization
#
#  The whole schema, idempotent (CREATE IF NOT EXISTS —
#  safe on every boot). Three tables:
#
#    Marketplace_Events         — every contract event, one
#                                 row per log, append-only
#    Marketplace_ActiveListings — the CURRENT state derived
#                                 from the event replay
#    Pinned_Files               — the pinner's archive
#                                 inventory (IPFS CIDs per
#                                 token)
#    Indexer_State              — key/value scratch (the
#                                 last scanned block)
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


def init_db():
    with get_db_connection() as conn:


        ######################## Marketplace event log ########################
        # EventType is 'Listed' / 'Updated' / 'Bought' / 'Canceled' —
        # 'Updated' is the REPLAY's classification of an ItemListed event
        # that hit an already-active listing (updateListing re-emits
        # ItemListed; on-chain the two are identical). Seller is NULL on
        # Bought rows, Buyer is NULL on Listed/Canceled rows, Price is NULL
        # on Canceled rows — mirroring what each contract event carries.
        # Timestamp is the block's unix time (Etherscan sends it with every
        # log). UNIQUE(TxHash, LogIndex) makes re-scanning a block range
        # idempotent: duplicates are ignored, never doubled.
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
        # Rewritten by the indexer as events replay: Listed upserts a row,
        # Bought/Canceled deletes it. What is in this table IS the
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
        # skipped (URI is not IPFS-addressed, nothing to pin) /
        # unreachable (content gone from the network before we could
        # replicate it — the loss is recorded, not silent). Uri is the raw
        # URI as found on-chain / in metadata; Cid the extracted IPFS root.
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
        # One row: Key='LastScannedBlock'. The indexer resumes from here
        # after a restart instead of re-scanning the whole chain.
        conn.execute('''
            CREATE TABLE IF NOT EXISTS [Indexer_State] (
                [Key] TEXT NOT NULL,
                [Value] TEXT NOT NULL,
                PRIMARY KEY ([Key])
            );
        ''')
        #######################################################################
