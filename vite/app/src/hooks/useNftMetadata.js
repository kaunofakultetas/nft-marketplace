// -----------------------------------------------------------
//  [*] useNftMetadata — one NFT's metadata, diagnosed
//
//  The one shared implementation of "resolve a token to what
//  it looks like": tokenURI read on-chain (through the
//  backend's RPC relay), metadata JSON fetched through the
//  local IPFS gateway, image URL rewritten onto the gateway.
//  TanStack Query caches by token, so a token shown in the
//  grid AND the activity feed resolves once per session.
//
//  DIAGNOSE, DON'T REPAIR: this is a teaching marketplace —
//  a wrongly minted NFT comes back with a `problem` naming
//  exactly what is wrong (and how to fix it), and the GUI
//  shows that error instead of quietly making the token look
//  fine. Nothing is silently accepted: an empty tokenURI, an
//  image where the JSON should be, JSON that is no object, a
//  missing or malformed 'image' field, the non-standard
//  'image_url' — all are surfaced, never papered over. And
//  nothing is blamed on the token that is not its fault: a
//  chain that cannot be read at all (the relay down) is said
//  as such.
// -----------------------------------------------------------

import { useReadContract } from 'wagmi';
import { useQuery } from '@tanstack/react-query';
import { nftAbi } from '@/constants';
import { contractRefused } from '@/utils/chain';
import { toGatewayURL, fetchWithTimeout } from '@/utils/ipfs';


// The grey placeholder shown while a token has no usable
// image, with the token id baked into the SVG
const placeholderImage = (tokenId) =>
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'%3E%3Crect fill='%23ddd' width='200' height='200'/%3E%3Ctext fill='%23999' font-family='sans-serif' font-size='14' dy='100' text-anchor='middle' x='100'%3ENFT %23" + tokenId + "%3C/tspan%3E%3C/text%3E%3C/svg%3E";


// Every way a student can mint a token wrong (or lose its
// files), each with the short label the cards show and the
// how-to-fix hint the detail page shows
const PROBLEMS = {
  'revert': {
    message: 'tokenURI() reverts on-chain',
    hint: 'The contract reverts when asked for this token’s URI — the token is burned, the id does not exist, or the contract is not ERC-721.',
  },
  'empty-uri': {
    message: 'tokenURI() returns an empty string',
    hint: 'The contract answers this token’s URI with nothing at all — OpenZeppelin’s ERC721 does that when no base URI is set and no URI was stored for the token. Mint it with a tokenURI pointing at its metadata JSON.',
  },
  'image-as-uri': {
    message: 'tokenURI points at an image, not metadata JSON',
    hint: 'The tokenURI must return a metadata JSON file like {"name": ..., "description": ..., "image": ...}. Yours returns the image file itself — re-mint with a metadata JSON and put the image link inside its "image" field.',
  },
  'not-json': {
    message: 'tokenURI content is not valid JSON',
    hint: 'The tokenURI must return a metadata JSON file ({"name", "description", "image"}). What it returns cannot be parsed as JSON.',
  },
  'not-object': {
    message: 'metadata JSON is not an object',
    hint: 'The tokenURI must return a metadata JSON object like {"name": ..., "description": ..., "image": ...}. This file holds valid JSON of another kind — a list, a text, a number or null.',
  },
  'no-image': {
    message: 'metadata JSON has no "image" field',
    hint: 'The metadata JSON was found but contains no "image" field — add one pointing at the image file and re-mint.',
  },
  'image-not-text': {
    message: 'metadata "image" field is not a link',
    hint: 'The "image" field must hold the image’s address as text — an ipfs:// or https:// link. This one holds something else (a number, a list or an object); fix the field and re-mint.',
  },
  'image-url-field': {
    message: 'metadata uses non-standard "image_url"',
    hint: 'The ERC-721 metadata standard field is "image" — this JSON uses "image_url", which most marketplaces (including this one) do not honor. Rename the field and re-mint.',
  },
  'unreachable': {
    message: 'metadata file is not hosted anywhere',
    hint: 'The metadata cannot be fetched — nobody on the IPFS network hosts this file anymore (the original pin is gone). This is exactly why this marketplace pins files on its own node.',
  },
};

// Not a diagnosis: the chain could not be read at all, so
// nothing is known about the token. Shown where a problem
// would be — with its own title on the detail page, which
// heads diagnoses "This NFT has a problem"
const UNREADABLE = {
  title: 'This NFT cannot be read right now',
  message: 'the chain cannot be read right now',
  hint: 'Reading this token from the blockchain failed — the backend’s RPC relay is not answering. This says nothing about the token itself; reload the page in a while.',
};







// -----------------------------------------------------------
// fallbackMetadata
// -----------------------------------------------------------
//
// What a token shows while nothing better is known: its id
// for a name, no description, the grey placeholder image.
//
// Used by:
//   - useNftMetadata (below) — every diagnosis
// -----------------------------------------------------------

function fallbackMetadata(tokenId) {
  return { name: `NFT #${tokenId}`, description: '', image: placeholderImage(tokenId) };
}







// -----------------------------------------------------------
// textOf
// -----------------------------------------------------------
//
// A metadata field as text: a number reads as one, anything
// else that is no text — an object, a list, null — reads as
// empty, so a malformed name or description can never reach
// the page as something React cannot render.
//
// Used by:
//   - useNftMetadata (below) — name and description
// -----------------------------------------------------------

function textOf(value) {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}







// -----------------------------------------------------------
// useNftMetadata (named export)
// -----------------------------------------------------------
//
// Hands back four things. metadata holds the name,
// description and image — the image a grey placeholder
// whenever there is a problem — and the JSON's attributes
// list when it carries one. problem is null for a healthy
// token, otherwise the message and hint naming what the
// student minted wrong; when the chain cannot be read at all
// it is the UNREADABLE notice instead, with its own title.
// metadataURL is the gateway URL of the tokenURI for the
// "View JSON" link, null until it is known. loading stays
// true until the tokenURI and the metadata are resolved.
//
// Used by:
//   - components/NFTBox — the grid cards
//   - components/NftThumb — the activity feed rows
//   - pages/NftDetail — metadata, problem panel, JSON link
// -----------------------------------------------------------

export function useNftMetadata(nftAddress, tokenId) {

  const { data: tokenURI, error: readError } = useReadContract({
    address: nftAddress,
    abi: nftAbi,
    functionName: 'tokenURI',
    args: [tokenId],
  });


  const { data, isLoading } = useQuery({
    queryKey: ['nft-metadata', nftAddress, tokenId, tokenURI],
    enabled: Boolean(tokenURI),
    staleTime: Infinity,
    queryFn: async () => {
      const fallback = fallbackMetadata(tokenId);


      // The metadata fetch — an unreachable file and an
      // unparseable file are DIFFERENT student-facing errors
      let response;
      try {
        response = await fetchWithTimeout(toGatewayURL(tokenURI));
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
      } catch {
        return { metadata: fallback, problem: PROBLEMS['unreachable'] };
      }

      if ((response.headers.get('content-type') || '').startsWith('image/')) {
        // At least show the student their image while telling
        // them the minting is wrong
        return {
          metadata: { ...fallback, image: toGatewayURL(tokenURI) },
          problem: PROBLEMS['image-as-uri'],
        };
      }

      let raw;
      try {
        raw = await response.json();
      } catch {
        return { metadata: fallback, problem: PROBLEMS['not-json'] };
      }


      // Valid JSON of another kind — a list, a text, a number,
      // null — carries no fields at all
      if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
        return { metadata: fallback, problem: PROBLEMS['not-object'] };
      }


      // The JSON's shape — name, description and attributes are
      // shown even when the image field is wrong or missing
      const named = {
        ...fallback,
        name: textOf(raw.name) || fallback.name,
        description: textOf(raw.description),
        ...(Array.isArray(raw.attributes) && { attributes: raw.attributes }),
      };

      if (typeof raw.image === 'string' && raw.image) {
        return { metadata: { ...named, image: toGatewayURL(raw.image) }, problem: null };
      }
      if (raw.image) {
        return { metadata: named, problem: PROBLEMS['image-not-text'] };
      }
      if (raw.image_url) {
        return { metadata: named, problem: PROBLEMS['image-url-field'] };
      }
      return { metadata: named, problem: PROBLEMS['no-image'] };
    },
  });


  // A reverting tokenURI (burned token, non-ERC721 contract)
  // is diagnosed without any fetch — a read that never reached
  // the contract is not the token's fault. A failed refetch
  // keeps the tokenURI already read, and the token with it
  if (readError && tokenURI === undefined) {
    return {
      metadata: fallbackMetadata(tokenId),
      problem: contractRefused(readError) ? PROBLEMS['revert'] : UNREADABLE,
      metadataURL: null,
      loading: false,
    };
  }

  // An empty tokenURI leaves nothing to fetch
  if (tokenURI === '') {
    return { metadata: fallbackMetadata(tokenId), problem: PROBLEMS['empty-uri'], metadataURL: null, loading: false };
  }

  return {
    metadata: data?.metadata,
    problem: data?.problem || null,
    metadataURL: tokenURI ? toGatewayURL(tokenURI) : null,
    loading: isLoading || !tokenURI,
  };
}
