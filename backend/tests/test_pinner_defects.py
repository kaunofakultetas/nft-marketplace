############################################################
#  [*] Pinner defects — found by review, not yet fixed
#
#  Each test states the WANTED behaviour and fails today
#  (@unittest.expectedFailure); an "unexpected success" once
#  the fix lands fails the run — drop the decorator and move
#  the test into test_pinner.py.
#
#    - metadata that IS valid JSON but not an object (a list,
#      a string, a number, null), or whose "image" is not a
#      string, makes the image stage throw an AttributeError
#      the stage does not catch (only ValueError is): the
#      WHOLE sync cycle aborts there, every cycle. Tokens
#      sorted after it — every file still being retried with
#      more attempts than the bad token's — are never reached
#      again: one wrongly minted NFT starves the archive
#    - a metadata file that could not be pinned is recorded
#      with an EMPTY URI, unlike an image that could not be
#      pinned: the row of a lost file does not say which file
#      was lost
############################################################


import json
import unittest
from unittest import mock

from tests import helpers

from app.marketplace.pinner import Pinner


PUG_JSON_CID = 'bafybeig37ioir76s7mg5oobetncojcm3c3hxasyd4rvid4jqhy4gkaheg4'
PUG_IMAGE_CID = 'QmSsYRx3LpDAb1GZQm7zZ1AuHZjfbPkD6J7s9r41xu1mf8'
BAD_DIR = 'bafybeibadmetadataxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'
LOST_DIR = 'bafybeisnhq2afc2rkc62zzi44qrg73v4grjuexjo75cstwp6pobpk4lfyk'








############################################################
# PinnerDefects
############################################################
#
# Two tokens in the archive's way: ART #9, freshly listed,
# whose metadata is the bad file of each test, and PUG #0,
# whose metadata has been pending for three cycles and is
# finally served by the network — it sorts after the bad
# token from the second cycle on.
############################################################

class PinnerDefects(helpers.DbTestCase):

    DB_MODULES = ('app.marketplace.pinner',)

    def setUp(self):
        super().setUp()
        pause = mock.patch('app.marketplace.pinner.time.sleep', side_effect=helpers.sleeps())
        pause.start()
        self.addCleanup(pause.stop)

    def world(self, bad_metadata):
        etherscan = helpers.FakeEtherscan(token_uris={
            (helpers.ART, 9): f'ipfs://{BAD_DIR}/9.json',
            (helpers.PUGS, 0): f'ipfs://{PUG_JSON_CID}/?filename=0-PUG.json',
        })
        self.kubo = helpers.FakeKubo(network={BAD_DIR, PUG_JSON_CID, PUG_IMAGE_CID}, files={
            f'{BAD_DIR}/9.json': bad_metadata,
            PUG_JSON_CID: json.dumps({'name': 'PUG', 'image': f'ipfs://{PUG_IMAGE_CID}'}).encode(),
        })
        self.pinner = Pinner(etherscan)
        self.seed_event('Listed', helpers.ART, 9, 9712990, seller=helpers.SELLER, price=1)
        self.seed_event('Listed', helpers.PUGS, 0, 9712004, seller=helpers.SELLER, price=1)
        self.seed_pin(helpers.PUGS, 0, 'metadata', 'pending', attempts=3)

    def cycles(self, count):
        # What the daemon does: a cycle that throws is logged and
        # the next one starts afresh
        for _ in range(count):
            with self.kubo.patched(), helpers.quiet():
                try:
                    self.pinner._sync()
                except Exception:
                    pass

    def status(self, nft, token_id, kind):
        rows = self.query('SELECT Status FROM Pinned_Files WHERE NftAddress = ? AND TokenId = ? AND Kind = ?', (nft, str(token_id), kind))
        return rows[0]['Status'] if rows else None

    def assert_archive_goes_on(self):
        self.cycles(3)
        self.assertEqual(self.status(helpers.ART, 9, 'image'), 'invalid')
        self.assertEqual(self.status(helpers.PUGS, 0, 'metadata'), 'pinned')

    @unittest.expectedFailure
    def test_metadata_that_is_a_json_list_is_invalid_and_the_archive_goes_on(self):
        self.world(b'["PUG", "ipfs://somewhere/pug.png"]')
        self.assert_archive_goes_on()

    @unittest.expectedFailure
    def test_metadata_that_is_a_json_string_is_invalid_and_the_archive_goes_on(self):
        self.world(b'"ipfs://somewhere/pug.png"')
        self.assert_archive_goes_on()

    @unittest.expectedFailure
    def test_metadata_that_is_json_null_is_invalid_and_the_archive_goes_on(self):
        self.world(b'null')
        self.assert_archive_goes_on()

    @unittest.expectedFailure
    def test_an_image_field_that_is_no_string_is_invalid_and_the_archive_goes_on(self):
        self.world(json.dumps({'name': 'Numbered', 'image': 5}).encode())
        self.assert_archive_goes_on()

    @unittest.expectedFailure
    def test_a_metadata_file_that_could_not_be_pinned_is_named_in_its_row(self):
        token_uri = f'ipfs://{LOST_DIR}/5.json'
        self.pinner = Pinner(helpers.FakeEtherscan(token_uris={(helpers.ART, 5): token_uri}))
        self.kubo = helpers.FakeKubo()
        self.seed_event('Listed', helpers.ART, 5, 9712700, seller=helpers.SELLER, price=1)
        self.cycles(1)
        rows = self.query("SELECT Uri, Status FROM Pinned_Files WHERE TokenId = '5' AND Kind = 'metadata'")
        self.assertEqual(rows, [{'Uri': token_uri, 'Status': 'pending'}])


if __name__ == '__main__':
    unittest.main()
