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
//  fine. Nothing is silently accepted: an image where the
//  JSON should be, a missing 'image' field, the non-standard
//  'image_url' — all are surfaced, never papered over.
// -----------------------------------------------------------

import { useReadContract } from 'wagmi';
import { useQuery } from '@tanstack/react-query';
import { nftAbi } from '@/constants';
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
  'image-as-uri': {
    message: 'tokenURI points at an image, not metadata JSON',
    hint: 'The tokenURI must return a metadata JSON file like {"name": ..., "description": ..., "image": ...}. Yours returns the image file itself — re-mint with a metadata JSON and put the image link inside its "image" field.',
  },
  'not-json': {
    message: 'tokenURI content is not valid JSON',
    hint: 'The tokenURI must return a metadata JSON file ({"name", "description", "image"}). What it returns cannot be parsed as JSON.',
  },
  'no-image': {
    message: 'metadata JSON has no "image" field',
    hint: 'The metadata JSON was found but contains no "image" field — add one pointing at the image file and re-mint.',
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







// -----------------------------------------------------------
// useNftMetadata (named export)
// -----------------------------------------------------------
//
//   const { metadata, problem, metadataURL, loading } =
//       useNftMetadata(addr, id)
//     metadata    — { name, description, image } — image is a
//                   grey placeholder whenever problem is set
//     problem     — null, or { code, message, hint } naming
//                   what the student minted wrong
//     metadataURL — the gateway URL of the tokenURI (for the
//                   "View JSON" link), null until resolved
//     loading     — true until tokenURI + metadata resolve
//
// Used by:
//   - components/NFTBox — the grid cards
//   - components/NftThumb — the activity feed rows
//   - pages/NftDetail — metadata, problem panel, JSON link
// -----------------------------------------------------------

export function useNftMetadata(nftAddress, tokenId) {

  const { data: tokenURI, isError: readFailed } = useReadContract({
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
      const fallback = { name: `NFT #${tokenId}`, description: '', image: placeholderImage(tokenId) };


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


      // The JSON's shape — name/description are shown even
      // when the image field is wrong or missing
      const named = { ...fallback, name: raw.name || fallback.name, description: raw.description || '' };

      if (raw.image) {
        return { metadata: { ...named, image: toGatewayURL(raw.image) }, problem: null };
      }
      if (raw.image_url) {
        return { metadata: named, problem: PROBLEMS['image-url-field'] };
      }
      return { metadata: named, problem: PROBLEMS['no-image'] };
    },
  });


  // A reverting tokenURI (burned token, non-ERC721 contract)
  // is diagnosed without any fetch
  if (readFailed) {
    return {
      metadata: { name: `NFT #${tokenId}`, description: '', image: placeholderImage(tokenId) },
      problem: PROBLEMS['revert'],
      metadataURL: null,
      loading: false,
    };
  }

  return {
    metadata: data?.metadata,
    problem: data?.problem || null,
    metadataURL: tokenURI ? toGatewayURL(tokenURI) : null,
    loading: isLoading || !tokenURI,
  };
}
