// -----------------------------------------------------------
//  [*] About — this marketplace instance, technically
//
//  The teaching page about the system itself: which contract
//  on which network, live instance stats, how the pipeline
//  works (wallet → contract, indexer → SQLite, RPC relay,
//  IPFS archive) and the contract's full interface with the
//  real event topic hashes. Everything live comes from
//  GET /api/stats; the interface table is the deployed
//  contract's ABI, spelled out.
//
//  Split into (root component last):
//
//    Section   — one titled white card
//    FactRow   — one label/value line
//    AboutPage — the four sections (default export)
// -----------------------------------------------------------

import { useQuery } from '@tanstack/react-query';
import { ethers } from 'ethers';
import { apiGet } from '@/utils/api';
import { etherscanAddressUrl, formatDateTime } from '@/utils/format';


// The deployed contract's interface — functions as students
// call them from Remix, events as the indexer decodes them
// (the topic hashes are the REAL keccak-256 values verified
// against the deployed bytecode; see backend indexer.py)
const CONTRACT_FUNCTIONS = [
  ['listItem(address, uint256, uint256)', 'approve first, then list for a price'],
  ['buyListing(address, uint256)', 'payable — send EXACTLY the listing price'],
  ['updateListing(address, uint256, uint256)', 'change the price (re-emits ItemListed)'],
  ['cancelListing(address, uint256)', 'take the token off the market'],
  ['withdrawProceeds()', 'pull your accumulated sale earnings'],
  ['getListing(address, uint256)', 'view — price and seller'],
  ['getProceeds(address)', 'view — withdrawable balance'],
];

// What each contract event MEANS — the signatures and topic
// hashes come LIVE from the backend (/api/stats), which
// derives them at boot from its configured signatures, so an
// edited contract never leaves stale hashes here
const EVENT_MEANINGS = {
  Listed: 'a token was put up for sale',
  Updated: 'a listing’s asking price changed',
  Bought: 'someone bought a listed token (carries buyer, seller and price)',
  Canceled: 'a listing was taken off the market',
};

// Chip palette (same as the detail page's ArchivePanel) plus
// what each archive status actually MEANS — one file of one
// NFT is one counted entry
const ARCHIVE_STATUSES = {
  pinned: {
    chip: 'bg-green-100 text-green-800',
    meaning: 'copied to the course IPFS node and kept forever',
  },
  pending: {
    chip: 'bg-yellow-100 text-yellow-800',
    meaning: 'still searching the IPFS network for the file — retried every minute',
  },
  skipped: {
    chip: 'bg-gray-100 text-gray-600',
    meaning: 'not stored on IPFS at all (Arweave or a plain web server) — nothing we can pin',
  },
  invalid: {
    chip: 'bg-orange-100 text-orange-800',
    meaning: 'the token was minted with broken metadata, so its files cannot be identified',
  },
  unreachable: {
    chip: 'bg-red-100 text-red-800',
    meaning: 'nobody on the IPFS network still hosts the file — it was lost before this archive existed',
  },
};







// -----------------------------------------------------------
// Section
// -----------------------------------------------------------
//
// Used by:
//   - AboutPage (below) — every card
// -----------------------------------------------------------

function Section({ title, subtitle, children }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-6">
      <h2 className="text-xl font-bold tracking-tight mb-1">{title}</h2>
      {subtitle && <p className="text-sm text-gray-500 mb-4">{subtitle}</p>}
      {children}
    </div>
  );
}







// -----------------------------------------------------------
// FactRow
// -----------------------------------------------------------
//
// Used by:
//   - AboutPage (below) — the instance facts
// -----------------------------------------------------------

function FactRow({ label, children }) {
  return (
    <div className="flex justify-between items-center py-2 border-b border-gray-100 last:border-0 text-sm">
      <span className="text-gray-600">{label}</span>
      <span className="font-medium text-gray-900">{children}</span>
    </div>
  );
}







// -----------------------------------------------------------
// AboutPage (default export)
// -----------------------------------------------------------
//
// Used by:
//   - App.jsx — route "/about"
// -----------------------------------------------------------

export default function AboutPage() {

  const { data: stats } = useQuery({
    queryKey: ['stats'],
    queryFn: () => apiGet('/api/stats'),
  });


  return (
    <div className="container mx-auto max-w-4xl px-4 py-8">

      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">About this marketplace</h1>
        <p className="text-sm text-gray-500 mt-1">
          A teaching NFT marketplace of VU Kaunas Faculty — real contract, real chain, machinery on display
        </p>
      </div>

      <div className="space-y-6">

        {/* The instance */}
        <Section title="The instance" subtitle="Everything below is live — refresh and watch the indexer advance">
          <FactRow label="Network">{stats ? `${stats.network} testnet (chain id ${stats.chainId})` : '…'}</FactRow>
          <FactRow label="Marketplace contract">
            {stats ? (
              <a
                href={etherscanAddressUrl(stats.marketplaceAddress)}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono break-all text-[var(--color-primary)] hover:text-[var(--color-primary-hover)] underline"
              >
                {stats.marketplaceAddress} ↗
              </a>
            ) : '…'}
          </FactRow>
          <FactRow label="Deployed">
            {stats?.deploymentBlock
              ? <span className="font-mono">block {stats.deploymentBlock} · {formatDateTime(stats.deployedAt)}</span>
              : '…'}
          </FactRow>
          <FactRow label="Indexed to block">{stats?.lastScannedBlock ?? '…'}</FactRow>
          <FactRow label="Events indexed">{stats?.totalEvents ?? '…'}</FactRow>
          <FactRow label="Active listings">{stats?.activeListings ?? '…'}</FactRow>
          <FactRow label="Lifetime sales">
            {stats ? `${stats.totalSales} (${ethers.formatUnits(stats.totalVolumeWei, 'ether')} ETH volume)` : '…'}
          </FactRow>
        </Section>

        {/* The pipeline */}
        <Section title="How it works" subtitle="Four moving parts, all of them visible in this GUI">
          <ol className="list-decimal list-inside space-y-2 text-sm text-gray-700">
            <li>
              <span className="font-semibold">Your wallet talks to the contract directly.</span>{' '}
              Listing, buying, cancelling and withdrawing are MetaMask transactions to the marketplace
              contract — this site never touches your keys.
            </li>
            <li>
              <span className="font-semibold">A backend indexer mirrors the chain.</span>{' '}
              Every ~30 seconds it scans the contract's event log (via the Etherscan API) into a local
              SQLite database — that is where every list, price and activity row on this site comes from,
              and why your transaction appears with a short delay.
            </li>
            <li>
              <span className="font-semibold">Chain reads go through a relay.</span>{' '}
              The browser's on-chain reads (tokenURI, ownerOf) are proxied by the backend at{' '}
              <span className="font-mono">/api/rpc</span>, so no RPC provider keys ever reach your browser.
            </li>
            <li>
              <span className="font-semibold">An IPFS node archives every NFT.</span>{' '}
              The course runs its own IPFS node: every marketplace token's metadata and image are pinned
              there permanently — surviving even after the original host (a free pinning account, usually)
              disappears. Wrongly minted tokens are diagnosed, not repaired.
            </li>
          </ol>
        </Section>

        {/* The archive */}
        <Section
          title="The IPFS archive"
          subtitle="Every NFT here has two files — metadata and image. Each file's fate on the course IPFS node:"
        >
          <div className="space-y-3">
            {stats?.archive && Object.entries(stats.archive).map(([status, count]) => {
              const info = ARCHIVE_STATUSES[status] || ARCHIVE_STATUSES.skipped;

              return (
                <div key={status} className="flex items-start gap-3 text-sm">
                  <span className={`px-3 py-1 rounded-full font-semibold whitespace-nowrap ${info.chip}`}>
                    {count} {status}
                  </span>
                  <span className="text-gray-600 pt-1">{info.meaning}</span>
                </div>
              );
            })}
          </div>
        </Section>

        {/* The contract interface */}
        <Section title="NFT Marketplace contract interface" subtitle="The functions students call from Remix or through this GUI">
          <div className="space-y-1.5 text-sm mb-6">
            {CONTRACT_FUNCTIONS.map(([signature, note]) => (
              <div key={signature} className="flex flex-wrap justify-between gap-x-4">
                <span className="font-mono text-gray-900">{signature}</span>
                <span className="text-gray-500">{note}</span>
              </div>
            ))}
          </div>

          <div className="border-t border-gray-100 pt-4">
            <p className="text-sm text-gray-500 mb-3">
              Each function fires an <span className="font-semibold">event</span> — a permanent log entry on the
              blockchain. The backend indexer rebuilds this whole marketplace just by reading these three
              (the hex value is the event's keccak-256 signature, as it appears in raw transaction logs):
            </p>
            <div className="space-y-2 text-sm">
              {stats?.eventTopics && Object.entries(EVENT_MEANINGS).map(([key, meaning]) => {
                const event = stats.eventTopics[key];
                if (!event) return null;

                return (
                  <div key={key}>
                    <span className="font-mono font-semibold text-gray-900">{event.signature}</span>
                    <span className="text-gray-600"> — {meaning}</span>
                    <div className="font-mono text-xs text-gray-400 break-all">{event.topic0}</div>
                  </div>
                );
              })}
            </div>
          </div>
        </Section>

      </div>

    </div>
  );
}
