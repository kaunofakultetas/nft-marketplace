// -----------------------------------------------------------
//  [*] History — the marketplace activity feed
//
//  One unified stream (GET /api/activity) instead of three
//  disconnected tables: every event as a row with its type
//  chip (Listed blue / Sold green / Canceled grey), the NFT
//  itself (thumbnail + name, linking to the detail page),
//  price, actor, block time and — technical on purpose —
//  the block number and the transaction on Etherscan.
//  Filter chips narrow the feed client-side.
//
//  Split into (root component last):
//
//    FilterChips — All / Listed / Sold / Canceled
//    ActivityRow — one event row
//    HistoryPage — filters + the feed table (default export)
// -----------------------------------------------------------

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAccount } from 'wagmi';
import { ethers } from 'ethers';
import { Link } from 'react-router-dom';
import { apiGet } from '@/utils/api';
import { truncateAddress, etherscanTxUrl, formatDateTime } from '@/utils/format';
import NftThumb from '@/components/NftThumb';
import ConnectPrompt from '@/components/ConnectPrompt';


// One colour per event type — same palette as the detail
// page's history stripes. 'Updated' is the indexer's replay
// classification of updateListing's re-emitted ItemListed.
const EVENT_STYLES = {
  Listed: 'bg-blue-100 text-blue-800',
  Updated: 'bg-violet-100 text-violet-800',
  Bought: 'bg-green-100 text-green-800',
  Canceled: 'bg-gray-200 text-gray-600',
};

// 'Bought' reads as "Sold" in a marketplace feed
const EVENT_LABELS = {
  All: 'All',
  Listed: 'Listed',
  Updated: 'Price update',
  Bought: 'Sold',
  Canceled: 'Canceled',
};

const FILTERS = ['All', 'Listed', 'Updated', 'Bought', 'Canceled'];







// -----------------------------------------------------------
// FilterChips
// -----------------------------------------------------------
//
// Used by:
//   - HistoryPage (below)
// -----------------------------------------------------------

function FilterChips({ active, onPick }) {
  return (
    <div className="flex gap-2">
      {FILTERS.map((filter) => (
        <button
          key={filter}
          type="button"
          onClick={() => onPick(filter)}
          className={
            'px-4 py-1.5 rounded-full text-sm font-semibold transition-colors ' +
            (filter === active
              ? 'bg-[var(--color-primary)] text-white'
              : 'bg-white text-gray-700 border border-gray-300 hover:border-[var(--color-primary)]')
          }
        >
          {EVENT_LABELS[filter]}
        </button>
      ))}
    </div>
  );
}







// -----------------------------------------------------------
// ActivityRow
// -----------------------------------------------------------
//
// One event: chip, the NFT itself, price, actor (seller on
// Listed/Canceled, buyer on Sold), the exact block datetime
// (YYYY-MM-DD HH:MM:SS), block and tx link.
//
// Used by:
//   - HistoryPage (below)
// -----------------------------------------------------------

function ActivityRow({ event }) {

  const actor = event.seller || event.buyer;


  return (
    <tr className="hover:bg-gray-50">
      <td className="px-4 py-3">
        <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${EVENT_STYLES[event.type]}`}>
          {EVENT_LABELS[event.type]}
        </span>
      </td>
      <td className="px-4 py-3">
        <NftThumb nftAddress={event.nftAddress} tokenId={event.tokenId} />
      </td>
      <td className="px-4 py-3 whitespace-nowrap text-sm font-semibold text-gray-900">
        {event.price ? `${ethers.formatUnits(event.price, 'ether')} ETH` : '—'}
      </td>
      <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
        <span className="font-mono" title={actor}>{truncateAddress(actor)}</span>
      </td>
      <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500 font-mono">
        {formatDateTime(event.timestamp)}
      </td>
      <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
        {event.blockNumber}
      </td>
      <td className="px-4 py-3 whitespace-nowrap text-sm">
        <a
          href={etherscanTxUrl(event.txHash)}
          target="_blank"
          rel="noopener noreferrer"
          className="font-mono text-[var(--color-primary)] hover:text-[var(--color-primary-hover)] underline"
          title={event.txHash}
        >
          {event.txHash.slice(0, 10)}... ↗
        </a>
      </td>
    </tr>
  );
}







// -----------------------------------------------------------
// HistoryPage (default export)
// -----------------------------------------------------------
//
// Used by:
//   - App.jsx — route "/history"
// -----------------------------------------------------------

export default function HistoryPage() {

  const { isConnected } = useAccount();
  const [filter, setFilter] = useState('All');

  const { isLoading, data } = useQuery({
    queryKey: ['activity'],
    queryFn: () => apiGet('/api/activity?limit=100'),
  });


  const events = (data?.activity || []).filter(
    (event) => filter === 'All' || event.type === filter
  );


  if (!isConnected) {
    return <ConnectPrompt message="Please connect your wallet to view marketplace activity" />;
  }


  return (
    <div className="container mx-auto max-w-7xl px-4 py-8">

      <div className="flex flex-wrap justify-between items-end gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Marketplace Activity</h1>
          <p className="text-sm text-gray-500 mt-1">Every contract event, newest first — each with its transaction on-chain</p>
        </div>
        <FilterChips active={filter} onPick={setFilter} />
      </div>

      {isLoading ? (
        <div className="text-gray-500">Loading...</div>
      ) : events.length === 0 ? (
        <div className="bg-white border border-dashed border-gray-300 rounded-xl p-14 text-center text-gray-500">
          No activity yet
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                {['Event', 'Item', 'Price', 'By', 'Time', 'Block', 'Tx'].map((header) => (
                  <th
                    key={header}
                    className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                  >
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {events.map((event) => (
                <ActivityRow
                  key={`${event.txHash}-${event.type}-${event.nftAddress}-${event.tokenId}`}
                  event={event}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-8">
        <Link to="/" className="text-[var(--color-primary)] hover:text-[var(--color-primary-hover)] font-medium">
          ← Back to Marketplace
        </Link>
      </div>

    </div>
  );
}
