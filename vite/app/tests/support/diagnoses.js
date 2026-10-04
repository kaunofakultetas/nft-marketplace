// -----------------------------------------------------------
//  [*] Test support — what the GUI says about a wrongly minted NFT
//
//  The marketplace DIAGNOSES instead of repairing: a token
//  minted wrong (or whose files are gone) carries a problem —
//  a short message the cards and the feed show, a hint the
//  detail page adds with the fix. These are the suite's own
//  copy of those sentences, word for word as a student must
//  read them, and the token of the world (fixtures.js) that
//  carries each one. A test asserts the sentence, never the
//  hook's internal code for it.
//
//  Used by:
//    - hooks/use-nft-metadata.test.jsx
//    - components/nft-box.test.jsx, nft-thumb.test.jsx
//    - pages/nft-detail/*.test.jsx
// -----------------------------------------------------------

import * as f from './backend/fixtures';







// -----------------------------------------------------------
// DIAGNOSES
// -----------------------------------------------------------
//
// Every diagnosis with its message and hint: a tokenURI that
// reverts, an image where the metadata JSON should be, a file
// that is not JSON, JSON without "image", the non-standard
// "image_url", and metadata nobody hosts any more.
//
// Used by:
//   - the tests listed in the header
// -----------------------------------------------------------

export const DIAGNOSES = {
  revert: {
    message: 'tokenURI() reverts on-chain',
    hint: 'The contract reverts when asked for this token’s URI — the token is burned, the id does not exist, or the contract is not ERC-721.',
  },
  imageAsUri: {
    message: 'tokenURI points at an image, not metadata JSON',
    hint: 'The tokenURI must return a metadata JSON file like {"name": ..., "description": ..., "image": ...}. Yours returns the image file itself — re-mint with a metadata JSON and put the image link inside its "image" field.',
  },
  notJson: {
    message: 'tokenURI content is not valid JSON',
    hint: 'The tokenURI must return a metadata JSON file ({"name", "description", "image"}). What it returns cannot be parsed as JSON.',
  },
  noImage: {
    message: 'metadata JSON has no "image" field',
    hint: 'The metadata JSON was found but contains no "image" field — add one pointing at the image file and re-mint.',
  },
  imageUrlField: {
    message: 'metadata uses non-standard "image_url"',
    hint: 'The ERC-721 metadata standard field is "image" — this JSON uses "image_url", which most marketplaces (including this one) do not honor. Rename the field and re-mint.',
  },
  unreachable: {
    message: 'metadata file is not hosted anywhere',
    hint: 'The metadata cannot be fetched — nobody on the IPFS network hosts this file anymore (the original pin is gone). This is exactly why this marketplace pins files on its own node.',
  },
};







// -----------------------------------------------------------
// DIAGNOSED_TOKENS
// -----------------------------------------------------------
//
// The ART token of the world that carries each diagnosis, as
// its collection address and token id — and, for the tokens
// whose metadata could still be read, the name the GUI shows
// (the token's own "NFT #id" otherwise).
//
// Used by:
//   - the tests listed in the header
// -----------------------------------------------------------

export const DIAGNOSED_TOKENS = {
  imageAsUri: { nftAddress: f.ART, tokenId: '1', name: 'NFT #1' },
  notJson: { nftAddress: f.ART, tokenId: '2', name: 'NFT #2' },
  noImage: { nftAddress: f.ART, tokenId: '3', name: 'Curonian Spit' },
  imageUrlField: { nftAddress: f.ART, tokenId: '4', name: 'Kaunas Castle' },
  unreachable: { nftAddress: f.ART, tokenId: '5', name: 'NFT #5' },
  revert: { nftAddress: f.ART, tokenId: '6', name: 'NFT #6' },
};
