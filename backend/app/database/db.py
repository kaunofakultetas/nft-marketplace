############################################################
#  [*] Database connection
#
#  One SQLite file holds everything (DB_PATH env var — the
#  compose service mounts ./_DATA/backend and points it at
#  /data/database.db). Rows come back as sqlite3.Row so
#  callers read columns by name.
#
#  Used by:
#    - app/database/db_init.py — schema creation
#    - app/marketplace/indexer.py — event writes, scan state
#    - app/marketplace/pinner.py — the archive inventory
#    - app/marketplace/routes.py — every API read
############################################################


import sqlite3
import os








############################################################
# get_db_connection
############################################################
#
# One fresh connection per call, rows addressable by column
# name; used as a `with` block, it commits the unit of work
# or rolls it back. GOTCHA: the default filename is read
# ONCE, when this module is imported — changing DB_PATH
# needs a process restart, which is why the test suite sets
# it before anything imports this module.
#
# Used by:
#   - see the file header — every reader and writer of the
#     database
############################################################

def get_db_connection(filename=os.getenv('DB_PATH', '/data/database.db')):
    conn = sqlite3.connect(filename)
    conn.row_factory = sqlite3.Row
    return conn
