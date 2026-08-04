// -----------------------------------------------------------
//  [*] NFTBox — one NFT card in a grid
//
//  The marketplace card, fluid inside the pages' auto-fill
//  grid — IMAGE FIRST (square, zooming slightly on hover
//  while the card lifts), then name,
//  price (the visual anchor, brand burgundy), description
//  and the token/owner meta line. Metadata resolution lives
//  in useNftMetadata (shared with the activity feed's
//  thumbnails); while it loads the card is a grey pulse
//  skeleton of the same size, and fetch failures degrade to
//  placeholder values instead of a blank card. Clicking
//  anywhere navigates to /nft/:nftAddress/:tokenId — buying
//  and listing actions live THERE, not on the card.
// -----------------------------------------------------------

import { useNavigate } from 'react-router-dom';
import { useAccount } from 'wagmi';
import { ethers } from 'ethers';
import { useNftMetadata } from '@/hooks/useNftMetadata';
import { truncateAddress } from '@/utils/format';







// -----------------------------------------------------------
// NFTBox (default export)
// -----------------------------------------------------------
//
// Props: price (wei string, undefined when not listed),
//        nftAddress, tokenId, seller (undefined when the
//        wallet owns the NFT but hasn't listed it)
//
// Used by:
//   - pages/Home   — the "NFTs For Sale" grid
//   - pages/MyNfts — the wallet's NFT grid
// -----------------------------------------------------------

export default function NFTBox({ price, nftAddress, tokenId, seller }) {

  const { metadata, problem, loading } = useNftMetadata(nftAddress, tokenId);
  const { address: userAddress } = useAccount();
  const navigate = useNavigate();


  // No seller at all means "yours" — MyNfts renders unlisted
  // tokens without one
  const isOwnedByUser = seller === userAddress?.toLowerCase() || seller === undefined;
  const formattedSellerAddress = isOwnedByUser ? 'you' : truncateAddress(seller);


  const handleCardClick = () => {
    navigate(`/nft/${nftAddress}/${tokenId}`);
  };


  if (loading || !metadata) {
    return (
      <div
        className="w-full h-full bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm animate-pulse cursor-pointer"
        onClick={handleCardClick}
      >
        <div className="aspect-square bg-gray-200" />
        <div className="p-4 space-y-3">
          <div className="h-5 bg-gray-200 rounded w-3/4" />
          <div className="h-6 bg-gray-200 rounded w-1/2" />
          <div className="h-4 bg-gray-200 rounded w-full" />
        </div>
      </div>
    );
  }


  return (
    <div
      className="group w-full h-full bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200 cursor-pointer flex flex-col"
      onClick={handleCardClick}
    >

      {/* Image first — what a marketplace card is about */}
      <div className="aspect-square w-full bg-gray-100 overflow-hidden">
        <img
          src={metadata.image}
          alt={metadata.name || 'NFT'}
          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
        />
      </div>

      {/* Name, price (the anchor), description, meta */}
      <div className="p-4 flex-1 flex flex-col gap-1">
        <h3 className="font-bold truncate" title={metadata.name || 'No name'}>
          {metadata.name || <span className="text-gray-400 italic">No name</span>}
        </h3>

        {price ? (
          <div className="text-lg font-bold text-[var(--color-primary)]">
            {ethers.formatUnits(price, 'ether')} ETH
          </div>
        ) : (
          <div className="text-sm text-gray-400">Not for sale</div>
        )}

        {/* A wrongly minted NFT wears its diagnosis, never a
            pretend-fine description — the detail page explains
            the fix */}
        {problem ? (
          <p className="text-sm text-amber-700 bg-amber-50 rounded px-2 py-1 line-clamp-2" title={problem.hint}>
            ⚠ {problem.message}
          </p>
        ) : (
          <p className="text-sm text-gray-600 line-clamp-2" title={metadata.description || 'No description'}>
            {metadata.description || <span className="text-gray-400 italic">No description</span>}
          </p>
        )}

        <div className="mt-auto flex justify-between text-xs text-gray-500">
          <span>#{tokenId}</span>
          <span className="italic" title={seller || ''}>Owned by {formattedSellerAddress}</span>
        </div>
      </div>

    </div>
  );
}
