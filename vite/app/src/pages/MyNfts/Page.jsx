// -----------------------------------------------------------
//  [*] MyNfts — every NFT the connected wallet owns
//
//  Ownership comes from the BACKEND (GET /api/my-nfts/<address>
//  — it replays the wallet's ERC-721 transfer history via
//  Etherscan server-side; the browser never talks to
//  Etherscan and never sees the API key). Each owned token
//  is matched against GET /api/listings so its card shows
//  the current price when it is listed.
//
//  Used by:
//    - App.jsx — route "/my-nfts"
// -----------------------------------------------------------

import { useQuery } from '@tanstack/react-query';
import { useAccount } from 'wagmi';
import { Link } from 'react-router-dom';
import { apiGet } from '@/utils/api';
import NFTBox from '@/components/NFTBox';
import ConnectPrompt from '@/components/ConnectPrompt';







// -----------------------------------------------------------
// MyNftsPage (default export)
// -----------------------------------------------------------
//
// Used by:
//   - App.jsx — route "/my-nfts"
// -----------------------------------------------------------

export default function MyNftsPage() {

  const { isConnected, address } = useAccount();


  const { data: myNftsData, isLoading, error, refetch } = useQuery({
    queryKey: ['my-nfts', address],
    queryFn: () => apiGet(`/api/my-nfts/${address}`),
    enabled: Boolean(address),
  });

  const { data: listingsData } = useQuery({
    queryKey: ['listings'],
    queryFn: () => apiGet('/api/listings'),
  });

  const myNfts = myNftsData?.nfts || [];


  if (!isConnected) {
    return <ConnectPrompt message="Please connect your wallet to view your NFTs" />;
  }


  return (
    <div className="container mx-auto max-w-7xl px-4 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">My NFTs</h1>
        <p className="text-sm text-gray-500 mt-1">Every token your wallet holds, reconstructed from its transfer history</p>
      </div>

      {isLoading ? (
        <div className="flex flex-col justify-center items-center py-16">
          <div className="text-xl mb-4">Loading your NFTs...</div>
          <div className="text-sm text-gray-500">Checking Etherscan for ownership history</div>
        </div>
      ) : error ? (
        <div className="bg-red-50 border border-red-200 rounded-lg p-6">
          <p className="text-red-800 mb-4">Error: {error.message}</p>
          <button
            onClick={() => refetch()}
            className="bg-red-600 text-white px-4 py-2 rounded hover:bg-red-700"
          >
            Try Again
          </button>
        </div>
      ) : myNfts.length === 0 ? (
        <div className="bg-white border border-dashed border-gray-300 rounded-xl p-14 text-center">
          <p className="text-xl font-semibold text-gray-700 mb-1">You don't own any NFTs yet</p>
          <p className="text-sm text-gray-500 mb-6">
            Start by minting one, or buy from the marketplace
          </p>
          <Link to="/">
            <button className="bg-[var(--color-primary)] text-white px-8 py-2.5 rounded-lg hover:bg-[var(--color-primary-hover)] transition-colors font-medium">
              Browse Marketplace
            </button>
          </Link>
        </div>
      ) : (
        <>
          <div className="mb-6 flex justify-between items-center">
            <p className="text-gray-700">
              You own <strong>{myNfts.length}</strong> NFT{myNfts.length !== 1 ? 's' : ''}
            </p>
            <button
              onClick={() => refetch()}
              className="text-sm bg-gray-100 hover:bg-gray-200 px-4 py-2 rounded"
            >
              🔄 Refresh
            </button>
          </div>

          <div className="grid grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-6">
            {myNfts.map((nft) => {
              // A listed NFT sits in the marketplace escrow —
              // the listings match restores its price + seller
              const listing = listingsData?.listings?.find(
                (item) =>
                  item.nftAddress === nft.nftAddress &&
                  item.tokenId === nft.tokenId
              );

              return (
                <NFTBox
                  key={`${nft.nftAddress}-${nft.tokenId}`}
                  nftAddress={nft.nftAddress}
                  tokenId={nft.tokenId}
                  price={listing?.price}
                  seller={listing?.seller}
                />
              );
            })}
          </div>
        </>
      )}

      <div className="mt-8">
        <Link to="/" className="text-[var(--color-primary)] hover:text-[var(--color-primary-hover)] font-medium">
          ← Back to Marketplace
        </Link>
      </div>
    </div>
  );
}
