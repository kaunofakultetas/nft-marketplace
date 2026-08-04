// -----------------------------------------------------------
//  [*] Home — "NFTs For Sale" storefront
//
//  The landing page, shaped like a real marketplace front:
//  the stats bar (floor price, listings, sales, volume from
//  GET /api/stats) with the TECHNICAL line under it — the
//  marketplace contract on Etherscan and the block the
//  indexer has scanned to — then the sortable grid of NFTBox
//  cards from GET /api/listings. Without a connected wallet
//  it only asks to connect — the cards need wallet context
//  to read tokenURIs. An empty marketplace nudges towards
//  /sell-nft.
//
//  Split into (root component last):
//
//    StatTile — one white stat card
//    StatsBar — the four tiles + contract/indexer line
//    HomePage — stats + sort + grid (default export)
// -----------------------------------------------------------

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAccount } from 'wagmi';
import { Link } from 'react-router-dom';
import { ethers } from 'ethers';
import { apiGet } from '@/utils/api';
import { etherscanAddressUrl, formatDateTime } from '@/utils/format';
import NFTBox from '@/components/NFTBox';
import ConnectPrompt from '@/components/ConnectPrompt';







// -----------------------------------------------------------
// StatTile
// -----------------------------------------------------------
//
// Used by:
//   - StatsBar (below)
// -----------------------------------------------------------

function StatTile({ label, value }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-sm px-6 py-4 flex-1 min-w-[150px]">
      <div className="text-xs text-gray-500 uppercase tracking-wider">{label}</div>
      <div className="text-2xl font-bold text-gray-900 tracking-tight mt-1">{value}</div>
    </div>
  );
}







// -----------------------------------------------------------
// StatsBar
// -----------------------------------------------------------
//
// Floor / listed / sales / volume, plus the technical line:
// the contract address linking to Etherscan and the last
// block the backend indexer scanned — deliberately visible,
// this is a teaching marketplace.
//
// Used by:
//   - HomePage (below)
// -----------------------------------------------------------

function StatsBar() {

  const { data: stats } = useQuery({
    queryKey: ['stats'],
    queryFn: () => apiGet('/api/stats'),
  });

  if (!stats) return null;


  return (
    <div className="mb-8">
      <div className="flex flex-wrap gap-4">
        <StatTile
          label="Floor Price"
          value={stats.floorPriceWei ? `${ethers.formatUnits(stats.floorPriceWei, 'ether')} ETH` : '—'}
        />
        <StatTile label="Listed" value={stats.activeListings} />
        <StatTile label="Sales" value={stats.totalSales} />
        <StatTile label="Volume" value={`${ethers.formatUnits(stats.totalVolumeWei, 'ether')} ETH`} />
      </div>

      <div className="mt-2 text-xs text-gray-500">
        Contract{' '}
        <a
          href={etherscanAddressUrl(stats.marketplaceAddress)}
          target="_blank"
          rel="noopener noreferrer"
          className="font-mono break-all text-[var(--color-primary)] hover:text-[var(--color-primary-hover)] underline"
        >
          {stats.marketplaceAddress} ↗
        </a>
        {' '}· indexed to block {stats.lastScannedBlock}
        {stats.lastScannedAt && (
          <span className="font-mono"> ({formatDateTime(stats.lastScannedAt)})</span>
        )}
      </div>
    </div>
  );
}


// Sort orders for the grid — 'newest' keeps the backend's
// ListedBlock DESC order; prices compare as BigInt, wei
// strings overflow Number
const SORTERS = {
  'newest': null,
  'price-low': (a, b) => (BigInt(a.price) < BigInt(b.price) ? -1 : 1),
  'price-high': (a, b) => (BigInt(a.price) > BigInt(b.price) ? -1 : 1),
};







// -----------------------------------------------------------
// HomePage (default export)
// -----------------------------------------------------------
//
// Used by:
//   - App.jsx — route "/"
// -----------------------------------------------------------

export default function HomePage() {

  const { isLoading, data } = useQuery({
    queryKey: ['listings'],
    queryFn: () => apiGet('/api/listings'),
  });
  const { isConnected } = useAccount();
  const [sortBy, setSortBy] = useState('newest');


  const listings = data?.listings && SORTERS[sortBy]
    ? [...data.listings].sort(SORTERS[sortBy])
    : data?.listings;


  if (!isConnected) {
    return <ConnectPrompt message="Please connect your wallet to browse the marketplace" />;
  }


  return (
    <div className="container mx-auto max-w-7xl px-4 py-8">

      <StatsBar />

      <div className="flex flex-wrap justify-between items-end gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">NFTs For Sale</h1>
          <p className="text-sm text-gray-500 mt-1">Live listings, indexed straight from the Sepolia chain</p>
        </div>
        <select
          value={sortBy}
          onChange={(event) => setSortBy(event.target.value)}
          className="bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-[var(--color-primary)]"
        >
          <option value="newest">Newest first</option>
          <option value="price-low">Price: low to high</option>
          <option value="price-high">Price: high to low</option>
        </select>
      </div>

      {isLoading || !listings ? (
        <div className="text-gray-500">Loading...</div>
      ) : listings.length <= 0 ? (
        <div className="bg-white border border-dashed border-gray-300 rounded-xl p-14 text-center">
          <p className="text-xl font-semibold text-gray-700 mb-1">No NFTs listed yet</p>
          <p className="text-sm text-gray-500 mb-6">Be the first to put a token on the marketplace</p>
          <Link to="/sell-nft">
            <button
              type="button"
              className="text-white bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] font-medium rounded-lg px-8 py-2.5 transition-colors"
            >
              Sell your NFT
            </button>
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-6">
          {listings.map((nft) => {
            const { price, nftAddress, tokenId, seller } = nft;

            return (
              <NFTBox
                key={`${nftAddress}-${tokenId}`}
                price={price}
                nftAddress={nftAddress}
                tokenId={tokenId}
                seller={seller}
              />
            );
          })}
        </div>
      )}

    </div>
  );
}
