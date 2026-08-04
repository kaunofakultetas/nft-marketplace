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
#    - app/marketplace/indexer.py — event writes
#    - app/marketplace/routes.py — every API read
############################################################


import sqlite3
import os


def get_db_connection(filename=os.getenv('DB_PATH', '/data/database.db')):
    conn = sqlite3.connect(filename)
    conn.row_factory = sqlite3.Row
    return conn
