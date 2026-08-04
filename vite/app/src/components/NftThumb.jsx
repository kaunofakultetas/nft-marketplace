// -----------------------------------------------------------
//  [*] NftThumb — a token's mini identity for table rows
//
//  Small thumbnail + name + token id, linking to the NFT's
//  detail page — the activity feed's answer to "WHICH NFT
//  was that?". Renders a pulse square while the metadata
//  resolves (cached per token by useNftMetadata, so repeated
//  rows are free).
// -----------------------------------------------------------

import { Link } from 'react-router-dom';
import { useNftMetadata } from '@/hooks/useNftMetadata';







// -----------------------------------------------------------
// NftThumb (default export)
// -----------------------------------------------------------
//
// Used by:
//   - pages/History — the Item column of the activity feed
// -----------------------------------------------------------

export default function NftThumb({ nftAddress, tokenId }) {

  const { metadata, problem, loading } = useNftMetadata(nftAddress, tokenId);


  return (
    <Link
      to={`/nft/${nftAddress}/${tokenId}`}
      className="flex items-center gap-3 group"
      title={problem ? problem.message : nftAddress}
    >
      {loading || !metadata?.image ? (
        <div className="w-10 h-10 rounded-lg bg-gray-200 animate-pulse shrink-0" />
      ) : problem ? (
        <div className="w-10 h-10 rounded-lg bg-amber-100 text-amber-700 flex items-center justify-center shrink-0">
          ⚠
        </div>
      ) : (
        <img
          src={metadata.image}
          alt=""
          className="w-10 h-10 rounded-lg object-cover shrink-0"
        />
      )}
      <span className="flex flex-col text-left">
        <span className="font-semibold text-gray-900 group-hover:text-[var(--color-primary)]">
          {metadata?.name || `NFT #${tokenId}`}
        </span>
        <span className="text-xs text-gray-500 font-mono">#{tokenId}</span>
      </span>
    </Link>
  );
}
