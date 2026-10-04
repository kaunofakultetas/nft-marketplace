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
//  /sell-nft; a failed listings read says what went wrong
//  where the grid would be.
//
//  Split into (root component last):
//
//    SORTERS  — the grid's sort orders
//    inEth    — an amount the way a stat tile shows it
//    byPrice  — the price comparator of the two price orders
//    StatTile — one white stat card
//    StatsBar — the four tiles + contract/indexer line
//    HomePage — stats + sort + grid (default export)
// -----------------------------------------------------------

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAccount } from 'wagmi';
import { Link } from 'react-router-dom';
import { apiGet } from '@/utils/api';
import { etherscanAddressUrl, formatDateTime, formatEth, parseWei } from '@/utils/format';
import NFTBox from '@/components/NFTBox';
import ConnectPrompt from '@/components/ConnectPrompt';


// Sort orders for the grid — 'newest' keeps the backend's
// ListedBlock DESC order
const SORTERS = {
  'newest': null,
  'price-low': byPrice(1),
  'price-high': byPrice(-1),
};







// -----------------------------------------------------------
// inEth
// -----------------------------------------------------------
//
// An amount as a stat tile shows it, in ether — a dash when
// the answer carries none, or one that cannot be read.
//
// Used by:
//   - StatsBar (below) — floor price and volume
// -----------------------------------------------------------

function inEth(wei) {
  const ether = formatEth(wei);
  return ether ? `${ether} ETH` : '—';
}







// -----------------------------------------------------------
// byPrice
// -----------------------------------------------------------
//
// A comparator of two listings by price, low to high for a
// direction of 1 and high to low for -1. Prices compare as
// big integers — wei amounts overflow a JavaScript number —
// and a price that cannot be read sorts last either way.
//
// Used by:
//   - SORTERS (above)
// -----------------------------------------------------------

function byPrice(direction) {
  return (a, b) => {
    const [left, right] = [parseWei(a.price), parseWei(b.price)];
    if (left === null || right === null) return (left === null) - (right === null);
    return left === right ? 0 : (left < right ? -direction : direction);
  };
}







// -----------------------------------------------------------
// StatTile
// -----------------------------------------------------------
//
// One figure of the bar: its label over its value, on a
// white card that shares the row's width.
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
// this is a teaching marketplace. An amount the answer does
// not carry, or carries malformed, is a dash.
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
        <StatTile label="Floor Price" value={inEth(stats.floorPriceWei)} />
        <StatTile label="Listed" value={stats.activeListings} />
        <StatTile label="Sales" value={stats.totalSales} />
        <StatTile label="Volume" value={inEth(stats.totalVolumeWei)} />
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







// -----------------------------------------------------------
// HomePage (default export)
// -----------------------------------------------------------
//
// The page: the stats bar, the heading with the sort
// control, then the grid — or, in its place, the loading
// line, the failed read or the empty marketplace's nudge.
// Without a wallet, the connect prompt alone.
//
// Used by:
//   - App.jsx — route "/"
// -----------------------------------------------------------

export default function HomePage() {

  const { isLoading, data, error } = useQuery({
    queryKey: ['listings'],
    queryFn: () => apiGet('/api/listings'),
  });
  const { isConnected } = useAccount();
  const [sortBy, setSortBy] = useState('newest');


  // An answer without a list of listings reads as an empty
  // marketplace, never as one to map over
  const all = Array.isArray(data?.listings) ? data.listings : [];
  const listings = SORTERS[sortBy] ? [...all].sort(SORTERS[sortBy]) : all;


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
          aria-label="Sort the listings"
          value={sortBy}
          onChange={(event) => setSortBy(event.target.value)}
          className="bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-[var(--color-primary)]"
        >
          <option value="newest">Newest first</option>
          <option value="price-low">Price: low to high</option>
          <option value="price-high">Price: high to low</option>
        </select>
      </div>

      {error ? (
        <div className="bg-red-50 border border-red-200 rounded-lg p-6">
          <p className="text-red-800">Error: {error.message}</p>
        </div>
      ) : isLoading ? (
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
