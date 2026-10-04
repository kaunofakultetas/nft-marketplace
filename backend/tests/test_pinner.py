############################################################
#  [*] NFT pinner regression tests
#
#  The permanent-archive daemon, against a fake Etherscan
#  (tokenURI answers) and a fake kubo node with its public
#  gateway caches — no network. Pinned down here:
#
#    shapes   — every IPFS URI shape in the wild reduced to
#               its path under /ipfs/ (the legacy ipfs://ipfs/
#               form included), everything else not IPFS; the
#               tokenURI read and its ABI string decoded
#    outcomes — a healthy token's metadata and image pinned by
#               their ROOT CIDs; a file not on IPFS 'skipped'
#               with its URI; metadata that is no JSON object,
#               or names no "image" text (the non-standard
#               "image_url" not honoured), 'invalid' for good;
#               a token whose tokenURI reverts, or whose file
#               nobody serves, 'pending' and retried every
#               cycle until the attempt cap makes it
#               'unreachable' — the row naming the file it
#               could not get, URI and root CID
#    rescue   — a CID the p2p network cannot deliver fetched
#               from the public gateway caches as a verified
#               CAR, imported, proven local, then pinned — the
#               caches tried in order, the first that has it
#               ending the search
#    work     — an archived token costs nothing, a token never
#               tried goes first, a previous contract's
#               unfinished pins are still retried, one token's
#               failure — wrongly minted metadata of any shape
#               included — never stops the others, and the
#               loop survives its own failures
############################################################


import json
import unittest
from unittest import mock

from tests import helpers

import main
from app.marketplace.pinner import Pinner, RESCUE_GATEWAYS, TOKENURI_SELECTOR, _decode_abi_string, _extract_ipfs_path


PUG_JSON_CID = 'bafybeig37ioir76s7mg5oobetncojcm3c3hxasyd4rvid4jqhy4gkaheg4'
PUG_IMAGE_CID = 'QmSsYRx3LpDAb1GZQm7zZ1AuHZjfbPkD6J7s9r41xu1mf8'
ART_DIR = 'bafybei2kpehdmoemeamafvd7sbjdz5ycbvj7kq4ogpjm7eyobzzjjliius'
ART_1_IMAGE_CID = 'bafkreiyho67dkx3htkufgo5el2fubvoju36abw2vywisxwxyln7veddtn5'
LOST_DIR = 'bafybeisnhq2afc2rkc62zzi44qrg73v4grjuexjo75cstwp6pobpk4lfyk'
BAD_DIR = 'bafybeibadmetadataxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'

PUG_TOKEN_URI = f'ipfs://{PUG_JSON_CID}/?filename=0-PUG.json'
PUG_IMAGE_URI = f'https://ipfs.io/ipfs/{PUG_IMAGE_CID}?filename=pug.png'

# The world of the frontend fixtures: tokenURIs on the chain
TOKEN_URIS = {
    (helpers.PUGS, 0): PUG_TOKEN_URI,
    (helpers.ART, 0): f'ipfs://{ART_DIR}/0.json',
    (helpers.ART, 1): f'ipfs://{ART_1_IMAGE_CID}',
    (helpers.ART, 2): f'ipfs://{ART_DIR}/2.json',
    (helpers.ART, 3): f'ipfs://{ART_DIR}/3.json',
    (helpers.ART, 4): f'ipfs://{ART_DIR}/4.json',
    (helpers.ART, 5): f'ipfs://{LOST_DIR}/5.json',
    (helpers.ART, 7): 'https://arweave.net/Kj8nSCYb3pQbhHqUzuULz4oWpCgYBqJ4hBpb8ypCHB4',
    (helpers.ART, 8): f'ipfs://{ART_DIR}/8.json',
}

# ...and the files the IPFS network holds
FILES = {
    PUG_JSON_CID: json.dumps({'name': 'PUG', 'description': 'An adorable PUG pup!', 'image': PUG_IMAGE_URI}).encode(),
    f'{ART_DIR}/0.json': json.dumps({'name': 'Vilnius at Dusk', 'image': f'ipfs://{ART_DIR}/0.png'}).encode(),
    ART_1_IMAGE_CID: b'\x89PNG\r\n\x1a\n not json at all',
    f'{ART_DIR}/2.json': b'name: Trakai Island Castle\nimage: ipfs://somewhere/2.png\n',
    f'{ART_DIR}/3.json': json.dumps({'name': 'Curonian Spit', 'description': 'The dunes of Nida at noon.'}).encode(),
    f'{ART_DIR}/4.json': json.dumps({'name': 'Kaunas Castle', 'image_url': f'ipfs://{ART_DIR}/4.png'}).encode(),
    f'{ART_DIR}/8.json': json.dumps({'name': 'Hosted image', 'image': 'https://nft.example.org/img/8.png'}).encode(),
}

NETWORK = {PUG_JSON_CID, PUG_IMAGE_CID, ART_DIR, ART_1_IMAGE_CID}








############################################################
# PinnerTestCase
############################################################
#
# A throwaway database the pinner reads and writes, the
# politeness pauses skipped, a pinner over a fake Etherscan
# that knows the world's tokenURIs, and a fake kubo node
# (overridable per test) holding the world's files.
#
# Used by:
#   - every test class below but the pure ones
############################################################

class PinnerTestCase(helpers.DbTestCase):

    DB_MODULES = ('app.marketplace.pinner',)

    def setUp(self):
        super().setUp()
        pause = mock.patch('app.marketplace.pinner.time.sleep', side_effect=helpers.sleeps())
        pause.start()
        self.addCleanup(pause.stop)
        self.etherscan = helpers.FakeEtherscan(token_uris=TOKEN_URIS)
        self.pinner = Pinner(self.etherscan)
        self.use_kubo()

    def use_kubo(self, **world):
        self.kubo = helpers.FakeKubo(**{'network': NETWORK, 'files': FILES, **world})

    def trade(self, nft, token_id):
        # A marketplace event is what puts a token on the
        # pinner's list
        self.seed_event('Listed', nft, token_id, 9712000 + token_id, seller=helpers.SELLER, price=1)

    def sync(self):
        with self.kubo.patched(), helpers.quiet() as printed:
            self.pinner._sync()
        return printed.getvalue()

    def rows(self, nft, token_id):
        return {row['Kind']: {k: row[k] for k in ('Uri', 'Cid', 'Status', 'Attempts')}
                for row in self.query('SELECT * FROM Pinned_Files WHERE NftAddress = ? AND TokenId = ?', (nft, str(token_id)))}








############################################################
# ShapeTests
############################################################
#
# The pure parts: every IPFS URI shape reduced to its path,
# everything else not IPFS, and the ABI string decoded.
############################################################

class ShapeTests(unittest.TestCase):

    def test_every_ipfs_shape_reduces_to_its_path(self):
        cases = {
            f'ipfs://{ART_1_IMAGE_CID}': ART_1_IMAGE_CID,
            f'ipfs://{ART_DIR}/0.json': f'{ART_DIR}/0.json',
            PUG_TOKEN_URI: PUG_JSON_CID,
            f'ipfs://ipfs/{ART_DIR}/0.json': f'{ART_DIR}/0.json',
            PUG_IMAGE_URI: PUG_IMAGE_CID,
            f'https://gateway.pinata.cloud/ipfs/{ART_DIR}/0.png': f'{ART_DIR}/0.png',
            f'https://{ART_DIR}.ipfs.dweb.link/0.json': f'{ART_DIR}/0.json',
            f'https://{ART_DIR}.ipfs.nftstorage.link': ART_DIR,
            f'https://{ART_DIR}.ipfs.w3s.link/0.json?filename=0.json': f'{ART_DIR}/0.json',
        }
        for uri, path in cases.items():
            with self.subTest(uri=uri):
                self.assertEqual(_extract_ipfs_path(uri), path)

    def test_everything_else_is_not_ipfs(self):
        for uri in ('https://arweave.net/Kj8nSCYb3pQbhHqUzuULz4oWpCgYBqJ4hBpb8ypCHB4', 'https://nft.example.org/meta/1.json',
                    'data:application/json;base64,eyJuYW1lIjoiT25lIn0=', 'ipfs://', '', None):
            with self.subTest(uri=uri):
                self.assertIsNone(_extract_ipfs_path(uri))

    def test_an_abi_string_is_decoded(self):
        for text in ('ipfs://short', PUG_TOKEN_URI, 'Ąžuolas — ąčęėįšųūž 💾'):
            with self.subTest(text=text):
                self.assertEqual(_decode_abi_string(helpers.abi_string(text)), text)

    def test_a_result_too_short_for_a_string_is_empty(self):
        self.assertEqual(_decode_abi_string('0x'), '')
        self.assertEqual(_decode_abi_string('0x' + '00' * 32), '')








############################################################
# TokenUriTests
############################################################
#
# The tokenURI read: the id encoded in full as one word, an
# empty answer an error.
############################################################

class TokenUriTests(PinnerTestCase):

    def test_tokenuri_is_called_with_the_id_as_one_word(self):
        self.assertEqual(self.pinner._resolve_token_uri(helpers.PUGS, '0'), PUG_TOKEN_URI)
        self.assertEqual(self.etherscan.called('eth_call'), [(helpers.PUGS, TOKENURI_SELECTOR + '00' * 32)])

    def test_a_token_id_of_any_width_is_encoded_in_full(self):
        biggest = 2 ** 256 - 1
        self.etherscan.token_uris[(helpers.ART, str(biggest))] = 'ipfs://wide'
        self.pinner._resolve_token_uri(helpers.ART, str(biggest))
        self.assertEqual(self.etherscan.called('eth_call')[-1], (helpers.ART, TOKENURI_SELECTOR + 'ff' * 32))

    def test_an_empty_tokenuri_is_an_error(self):
        self.etherscan.token_uris[(helpers.ART, '9')] = ''
        with self.assertRaises(RuntimeError) as empty:
            self.pinner._resolve_token_uri(helpers.ART, '9')
        self.assertEqual(str(empty.exception), 'empty tokenURI')








############################################################
# OutcomeTests
############################################################
#
# What becomes of each file: pinned by its root CID,
# skipped when not on IPFS, invalid when wrongly minted,
# pending while nobody serves it, unreachable at the
# attempt cap — a failed row naming the file it could not
# get.
############################################################

class OutcomeTests(PinnerTestCase):

    def test_a_healthy_token_has_its_metadata_and_image_pinned_by_root_cid(self):
        self.trade(helpers.PUGS, 0)
        printed = self.sync()
        self.assertEqual(self.rows(helpers.PUGS, 0), {
            'metadata': {'Uri': PUG_TOKEN_URI, 'Cid': PUG_JSON_CID, 'Status': 'pinned', 'Attempts': 1},
            'image': {'Uri': PUG_IMAGE_URI, 'Cid': PUG_IMAGE_CID, 'Status': 'pinned', 'Attempts': 1},
        })
        self.assertEqual(self.kubo.pinned, [PUG_JSON_CID, PUG_IMAGE_CID])
        self.assertIn(f'[pinner] pinned metadata of {helpers.PUGS}#0: {PUG_JSON_CID}', printed)
        self.assertIn(f'[pinner] pinned image of {helpers.PUGS}#0: {PUG_IMAGE_CID}', printed)

    def test_kubo_is_asked_to_pin_with_its_own_45_second_timeout(self):
        self.trade(helpers.PUGS, 0)
        self.sync()
        pin = self.kubo.post_mock.call_args_list[0]
        self.assertEqual(pin.args, (f'{main.IPFS_API_URL}/pin/add',))
        self.assertEqual(pin.kwargs, {'params': {'arg': PUG_JSON_CID, 'timeout': '45s'}, 'timeout': 60})

    def test_the_image_is_found_by_reading_the_metadata_from_the_local_node(self):
        self.trade(helpers.ART, 0)
        self.sync()
        cat = self.kubo.post_mock.call_args_list[1]
        self.assertEqual(cat.args, (f'{main.IPFS_API_URL}/cat',))
        self.assertEqual(cat.kwargs, {'params': {'arg': f'/ipfs/{ART_DIR}/0.json', 'timeout': '30s'}, 'timeout': 45})

    def test_metadata_and_image_in_one_directory_share_their_root(self):
        self.trade(helpers.ART, 0)
        self.sync()
        rows = self.rows(helpers.ART, 0)
        self.assertEqual((rows['metadata']['Cid'], rows['image']['Cid']), (ART_DIR, ART_DIR))
        self.assertEqual(rows['image']['Uri'], f'ipfs://{ART_DIR}/0.png')

    def test_metadata_not_on_ipfs_is_skipped_and_its_image_never_looked_at(self):
        self.trade(helpers.ART, 7)
        printed = self.sync()
        self.assertEqual(self.rows(helpers.ART, 7), {
            'metadata': {'Uri': TOKEN_URIS[(helpers.ART, 7)], 'Cid': None, 'Status': 'skipped', 'Attempts': 1},
        })
        self.assertEqual(self.kubo.calls, [])
        self.assertIn(f'[pinner] skipped metadata of {helpers.ART}#7: not IPFS', printed)

    def test_an_image_not_on_ipfs_is_skipped_with_its_uri(self):
        self.trade(helpers.ART, 8)
        self.sync()
        self.assertEqual(self.rows(helpers.ART, 8)['image'],
                         {'Uri': 'https://nft.example.org/img/8.png', 'Cid': None, 'Status': 'skipped', 'Attempts': 1})

    def test_wrongly_minted_metadata_is_invalid_for_good(self):
        # Not JSON, no "image", the non-standard "image_url", and
        # a tokenURI that IS the image (its bytes are no JSON)
        for token_id in (2, 3, 4, 1):
            with self.subTest(token_id=token_id):
                self.trade(helpers.ART, token_id)
                printed = self.sync()
                self.assertEqual(self.rows(helpers.ART, token_id)['image'],
                                 {'Uri': '', 'Cid': None, 'Status': 'invalid', 'Attempts': 1})
                self.assertIn(f'[pinner] invalid metadata of {helpers.ART}#{token_id}: no JSON object with an "image" text', printed)

    def test_a_tokenuri_that_is_an_image_still_has_that_image_archived_as_its_metadata(self):
        self.trade(helpers.ART, 1)
        self.sync()
        self.assertEqual(self.rows(helpers.ART, 1)['metadata']['Cid'], ART_1_IMAGE_CID)

    def test_a_reverting_tokenuri_is_pending(self):
        self.trade(helpers.ART, 6)
        self.sync()
        self.assertEqual(self.rows(helpers.ART, 6), {'metadata': {'Uri': '', 'Cid': None, 'Status': 'pending', 'Attempts': 1}})

    def test_a_file_nobody_serves_is_pending_and_retried_every_cycle(self):
        self.trade(helpers.ART, 5)
        self.sync()
        self.sync()
        self.assertEqual(self.rows(helpers.ART, 5)['metadata'],
                         {'Uri': TOKEN_URIS[(helpers.ART, 5)], 'Cid': LOST_DIR, 'Status': 'pending', 'Attempts': 2})

    def test_the_attempt_cap_makes_a_lost_file_unreachable(self):
        self.trade(helpers.ART, 5)
        self.seed_pin(helpers.ART, 5, 'metadata', 'pending', attempts=main.PIN_MAX_ATTEMPTS - 1)
        printed = self.sync()
        self.assertEqual(self.rows(helpers.ART, 5)['metadata'],
                         {'Uri': TOKEN_URIS[(helpers.ART, 5)], 'Cid': LOST_DIR, 'Status': 'unreachable', 'Attempts': main.PIN_MAX_ATTEMPTS})
        self.assertIn(f'[pinner] gave up on metadata of {helpers.ART}#5', printed)

    def test_an_unreadable_metadata_file_leaves_the_image_pending_until_the_cap(self):
        self.trade(helpers.PUGS, 0)
        self.use_kubo(files={})
        self.sync()
        self.assertEqual(self.rows(helpers.PUGS, 0)['image'], {'Uri': '', 'Cid': None, 'Status': 'pending', 'Attempts': 1})
        self.seed_pin(helpers.PUGS, 1, 'metadata', 'pinned', cid=PUG_JSON_CID, uri=PUG_TOKEN_URI)
        self.seed_pin(helpers.PUGS, 1, 'image', 'pending', attempts=main.PIN_MAX_ATTEMPTS - 1)
        self.trade(helpers.PUGS, 1)
        self.sync()
        self.assertEqual(self.rows(helpers.PUGS, 1)['image']['Status'], 'unreachable')

    def test_an_image_nobody_serves_is_pending_and_named_in_its_row(self):
        self.trade(helpers.PUGS, 0)
        self.use_kubo(network={PUG_JSON_CID})
        self.sync()
        self.assertEqual(self.rows(helpers.PUGS, 0)['image'],
                         {'Uri': PUG_IMAGE_URI, 'Cid': PUG_IMAGE_CID, 'Status': 'pending', 'Attempts': 1})








############################################################
# MalformedMetadataTests
############################################################
#
# Metadata that IS valid JSON, but no object with an "image"
# text — and a token waiting behind it: ART #9, freshly
# listed, holds the bad file of each test; PUG #0's metadata
# has been pending for three cycles and is finally served,
# sorting after the bad token from the second cycle on. The
# cycles run the way the daemon runs them: one that throws
# is logged and the next starts afresh.
############################################################

class MalformedMetadataTests(PinnerTestCase):

    def world(self, bad_metadata):
        self.etherscan = helpers.FakeEtherscan(token_uris={
            (helpers.ART, 9): f'ipfs://{BAD_DIR}/9.json',
            (helpers.PUGS, 0): PUG_TOKEN_URI,
        })
        self.pinner = Pinner(self.etherscan)
        self.use_kubo(network={BAD_DIR, PUG_JSON_CID, PUG_IMAGE_CID},
                      files={f'{BAD_DIR}/9.json': bad_metadata, PUG_JSON_CID: FILES[PUG_JSON_CID]})
        self.trade(helpers.ART, 9)
        self.trade(helpers.PUGS, 0)
        self.seed_pin(helpers.PUGS, 0, 'metadata', 'pending', attempts=3)

    def assert_invalid_and_the_archive_goes_on(self):
        for _ in range(3):
            with self.kubo.patched(), helpers.quiet():
                try:
                    self.pinner._sync()
                except Exception:
                    pass
        self.assertEqual(self.rows(helpers.ART, 9)['image'], {'Uri': '', 'Cid': None, 'Status': 'invalid', 'Attempts': 1})
        self.assertEqual(self.rows(helpers.PUGS, 0)['metadata']['Status'], 'pinned')

    def test_metadata_that_is_a_json_list(self):
        self.world(b'["PUG", "ipfs://somewhere/pug.png"]')
        self.assert_invalid_and_the_archive_goes_on()

    def test_metadata_that_is_a_json_string(self):
        self.world(b'"ipfs://somewhere/pug.png"')
        self.assert_invalid_and_the_archive_goes_on()

    def test_metadata_that_is_json_null(self):
        self.world(b'null')
        self.assert_invalid_and_the_archive_goes_on()

    def test_an_image_field_that_is_no_text(self):
        self.world(json.dumps({'name': 'Numbered', 'image': 5}).encode())
        self.assert_invalid_and_the_archive_goes_on()








############################################################
# RescueTests
############################################################
#
# The second rung: a CID the network lacks fetched from the
# gateway caches as a verified CAR, in order — the first
# that has it ending the search, junk passed over.
############################################################

class RescueTests(PinnerTestCase):

    def test_a_cid_the_network_lacks_is_rescued_from_a_gateway_cache(self):
        self.trade(helpers.PUGS, 0)
        self.use_kubo(network={PUG_IMAGE_CID}, gateways={'dweb.link': {PUG_JSON_CID}})
        printed = self.sync()
        self.assertEqual(self.rows(helpers.PUGS, 0)['metadata']['Status'], 'pinned')
        self.assertIn(f'[pinner] rescued {PUG_JSON_CID} from a gateway cache (dweb.link)', printed)

    def test_the_caches_are_tried_in_order_and_a_verified_car_is_asked_for(self):
        self.trade(helpers.PUGS, 0)
        self.use_kubo(network={PUG_IMAGE_CID}, gateways={'dweb.link': {PUG_JSON_CID}})
        self.sync()
        fetched = [call for call in self.kubo.calls if call[0] == 'gateway']
        self.assertEqual(fetched, [('gateway', gateway.split('/')[2], PUG_JSON_CID, 'application/vnd.ipld.car', 25)
                                   for gateway in RESCUE_GATEWAYS])

    def test_the_rescue_is_imported_then_proven_local_then_pinned(self):
        self.trade(helpers.PUGS, 0)
        self.use_kubo(network={PUG_IMAGE_CID}, gateways={'ipfs.io': {PUG_JSON_CID}})
        self.sync()
        kubo_calls = [call[:2] for call in self.kubo.calls if call[0] != 'gateway'][:4]
        self.assertEqual(kubo_calls, [('pin/add', PUG_JSON_CID), ('dag/import', None), ('block/stat', PUG_JSON_CID), ('pin/add', PUG_JSON_CID)])
        stat = next(call for call in self.kubo.post_mock.call_args_list if call.args[0].endswith('/block/stat'))
        self.assertEqual(stat.kwargs['params'], {'arg': PUG_JSON_CID, 'offline': 'true'})

    def test_the_first_cache_that_has_it_ends_the_search(self):
        self.trade(helpers.PUGS, 0)
        self.use_kubo(network={PUG_IMAGE_CID}, gateways={'ipfs.io': {PUG_JSON_CID}, 'dweb.link': {PUG_JSON_CID}})
        self.sync()
        self.assertEqual([call[1] for call in self.kubo.calls if call[0] == 'gateway'], ['ipfs.io'])

    def test_a_cache_answering_junk_is_passed_over(self):
        # It answers, but its CAR does not import: block/stat
        # finds nothing, and the next cache is asked
        self.trade(helpers.PUGS, 0)
        self.use_kubo(network={PUG_IMAGE_CID}, gateways={'ipfs.io': {'someothercid'}, 'dweb.link': {PUG_JSON_CID}})
        original = self.kubo.get

        def junk_from_ipfs_io(url, headers=None, timeout=None, **kwargs):
            if 'ipfs.io' in url:
                self.kubo.calls.append(('gateway', 'ipfs.io', url.rsplit('/', 1)[-1], headers.get('Accept'), timeout))
                return self.kubo._answer(200, b'CAR:someothercid')
            return original(url, headers=headers, timeout=timeout, **kwargs)

        self.kubo.get = junk_from_ipfs_io
        printed = self.sync()
        self.assertIn(f'[pinner] rescued {PUG_JSON_CID} from a gateway cache (dweb.link)', printed)

    def test_no_cache_having_it_leaves_the_file_pending(self):
        self.trade(helpers.PUGS, 0)
        self.use_kubo(network=set(), gateways={})
        self.sync()
        self.assertEqual(self.rows(helpers.PUGS, 0)['metadata']['Status'], 'pending')
        self.assertFalse(any(call[0] == 'dag/import' for call in self.kubo.calls))








############################################################
# WorkTests
############################################################
#
# What a cycle costs and in which order: an archived token
# nothing, a token never tried first, one token's failure
# never the others' — and the loop around it all.
############################################################

class WorkTests(PinnerTestCase):

    def test_an_archived_token_costs_nothing(self):
        self.trade(helpers.PUGS, 0)
        self.sync()
        self.etherscan.calls.clear()
        self.kubo.calls.clear()
        self.sync()
        self.assertEqual((self.etherscan.calls, self.kubo.calls), ([], []))

    def test_skipped_invalid_and_unreachable_files_are_never_retried(self):
        for token_id, status in ((7, 'skipped'), (3, 'invalid'), (5, 'unreachable')):
            self.trade(helpers.ART, token_id)
        self.seed_pin(helpers.ART, 7, 'metadata', 'skipped')
        self.seed_pin(helpers.ART, 3, 'metadata', 'pinned', cid=ART_DIR, uri=f'ipfs://{ART_DIR}/3.json')
        self.seed_pin(helpers.ART, 3, 'image', 'invalid')
        self.seed_pin(helpers.ART, 5, 'metadata', 'unreachable', attempts=main.PIN_MAX_ATTEMPTS)
        self.sync()
        self.assertEqual((self.etherscan.calls, self.kubo.calls), ([], []))

    def test_a_pinned_metadata_without_its_image_row_goes_straight_to_the_image(self):
        self.trade(helpers.PUGS, 0)
        self.seed_pin(helpers.PUGS, 0, 'metadata', 'pinned', cid=PUG_JSON_CID, uri=PUG_TOKEN_URI)
        self.use_kubo(network=NETWORK)
        self.kubo.local.add(PUG_JSON_CID)
        self.sync()
        self.assertEqual(self.etherscan.calls, [])
        self.assertEqual(self.rows(helpers.PUGS, 0)['image']['Status'], 'pinned')

    def test_a_token_traded_many_times_is_synced_once(self):
        self.trade(helpers.PUGS, 0)
        self.seed_event('Updated', helpers.PUGS, 0, 9712377, seller=helpers.SELLER, price=2)
        self.seed_event('Bought', helpers.PUGS, 0, 9712500, buyer=helpers.BUYER, seller=helpers.SELLER, price=2)
        self.sync()
        self.assertEqual(len(self.etherscan.called('eth_call')), 1)

    def test_a_token_never_tried_goes_before_the_ones_failing_for_long(self):
        self.trade(helpers.ART, 5)
        self.seed_pin(helpers.ART, 5, 'metadata', 'pending', attempts=7)
        self.trade(helpers.ART, 6)
        self.seed_pin(helpers.ART, 6, 'metadata', 'pending', attempts=2)
        self.trade(helpers.PUGS, 0)
        self.sync()
        self.assertEqual([call[0] for call in self.etherscan.called('eth_call')], [helpers.PUGS, helpers.ART, helpers.ART])
        self.assertEqual([int(call[1][10:], 16) for call in self.etherscan.called('eth_call')], [0, 6, 5])

    def test_one_tokens_failure_never_stops_the_others(self):
        # The database refusing ART #7's row, the first in line:
        # the cycle says so and moves on to PUG #0
        self.trade(helpers.ART, 7)
        self.trade(helpers.PUGS, 0)
        self.seed_pin(helpers.PUGS, 0, 'metadata', 'pending', attempts=3)
        record = self.pinner._record

        def refusing(nft_address, *args):
            if nft_address == helpers.ART:
                raise helpers.sqlite_error()
            return record(nft_address, *args)

        self.pinner._record = refusing
        printed = self.sync()
        self.assertEqual(self.rows(helpers.PUGS, 0)['metadata']['Status'], 'pinned')
        self.assertIn(f'[pinner] error on {helpers.ART}#7: database is locked — retrying next cycle', printed)

    def test_a_previous_contracts_unfinished_pins_are_still_retried(self):
        # The contract switch wiped the events; the pending row is
        # all that is left of the token
        self.seed_pin(helpers.PUGS, 0, 'metadata', 'pending', attempts=3)
        self.sync()
        self.assertEqual(self.rows(helpers.PUGS, 0)['metadata']['Status'], 'pinned')

    def test_the_loop_polls_once_a_minute(self):
        pause = helpers.sleeps(stop_at=1)
        with mock.patch('app.marketplace.pinner.time.sleep', side_effect=pause), self.kubo.patched(), helpers.quiet() as printed:
            with self.assertRaises(helpers.StopLoop):
                self.pinner._loop()
        self.assertEqual(pause.paused, [main.PINNER_POLL_SECONDS])
        self.assertIn('[pinner] starting', printed.getvalue())

    def test_the_loop_survives_its_own_failure_and_retries_in_30_seconds(self):
        pause = helpers.sleeps(stop_at=2)
        broken = mock.patch('app.marketplace.pinner.get_db_connection', side_effect=[helpers.sqlite_error(), self.connect(), self.connect()])
        with broken, mock.patch('app.marketplace.pinner.time.sleep', side_effect=pause), self.kubo.patched(), helpers.quiet() as printed:
            with self.assertRaises(helpers.StopLoop):
                self.pinner._loop()
        self.assertEqual(pause.paused, [30, main.PINNER_POLL_SECONDS])
        self.assertIn('[pinner] error: database is locked — retrying in 30s', printed.getvalue())

    def test_start_runs_the_loop_in_a_daemon_thread(self):
        with mock.patch('app.marketplace.pinner.threading.Thread') as thread:
            self.pinner.start()
        thread.assert_called_once_with(target=self.pinner._loop, daemon=True)
        thread.return_value.start.assert_called_once_with()


if __name__ == '__main__':
    unittest.main()
