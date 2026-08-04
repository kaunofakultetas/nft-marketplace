// -----------------------------------------------------------
//  [*] NftDetail — one NFT: image, facts, actions, history
//
//  /nft/:nftAddress/:tokenId — reached by clicking any NFTBox
//  card. Owner and metadata are read straight from the chain
//  (ownerOf/tokenURI via the RPC), listing state and the event
//  history come from the backend (GET /api/nft/...). The
//  actions panel adapts:
//    - owner, listed      → Update Listing / Cancel (modal)
//    - owner, not listed  → List for Sale (→ /sell-nft
//                           prefilled)
//    - visitor, listed    → Buy Now (modal)
//    - visitor, unlisted  → "not for sale" note
//
//  Everything technical is one click deep on purpose:
//  contract and owner link to Etherscan, every history
//  stripe links its transaction, and the ArchivePanel shows
//  the pinner's per-file status — students see the course
//  IPFS node preserving their files.
//
//  The page loads PROGRESSIVELY — no page-wide gate. Three
//  independent sources (metadata via IPFS, owner via RPC,
//  listing/history/archive via the backend) each fill their
//  own panels; whatever is still resolving shows a skeleton,
//  so a dead IPFS file never blocks the instant backend data.
//
//  DIAGNOSE, DON'T REPAIR: a wrongly minted token gets the
//  amber ProblemPanel naming exactly what is wrong and how
//  to fix it (the diagnosis comes from useNftMetadata) — the
//  page never dresses a broken NFT up as fine.
//
//  Split into (root component last):
//
//    ImagePanel      — image or placeholder square
//    ProblemPanel    — the what-is-wrong + how-to-fix card
//    InfoPanel       — name, description, facts table
//    ActionsPanel    — the four owner/visitor variants
//    HistoryPanel    — sales / listings / cancellations
//    ArchivePanel    — the IPFS pin status of the files
//    AttributesPanel — metadata attributes grid
//    NftDetailPage   — data loading + layout (default export)
// -----------------------------------------------------------

import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useAccount, useBalance } from 'wagmi';
import { ethers } from 'ethers';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '@/utils/api';
import { getConfig } from '@/config';
import { useNftMetadata } from '@/hooks/useNftMetadata';
import { truncateAddress, etherscanAddressUrl, etherscanTxUrl, formatDateTime } from '@/utils/format';
import UpdateListingModal from '@/components/UpdateListingModal';
import BuyNftModal from '@/components/BuyNftModal';







// -----------------------------------------------------------
// ImagePanel
// -----------------------------------------------------------
//
// The card hugs the image's NATURAL height — full card
// width, no letterboxing squares. While metadata resolves it
// is a pulsing square; an image that fails to load (dead
// link inside otherwise-healthy metadata) swaps to the grey
// placeholder instead of vanishing.
//
// Used by:
//   - NftDetailPage (below) — left column
// -----------------------------------------------------------

function ImagePanel({ metadata, tokenId, loading }) {

  const [failed, setFailed] = useState(false);


  // A changed image URL gets a fresh chance
  useEffect(() => {
    setFailed(false);
  }, [metadata?.image]);


  if (loading) {
    return (
      <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-4 lg:sticky lg:top-20">
        <div className="w-full aspect-square bg-gray-200 rounded-lg animate-pulse" />
      </div>
    );
  }


  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-4 lg:sticky lg:top-20">
      {metadata?.image && !failed ? (
        <img
          src={metadata.image}
          alt={metadata.name || 'NFT'}
          className="w-full h-auto rounded-lg"
          onError={() => setFailed(true)}
        />
      ) : (
        <div className="w-full aspect-square bg-gray-100 rounded-lg flex items-center justify-center">
          <div className="text-center text-gray-500">
            <div className="text-6xl mb-2">🖼️</div>
            <div className="text-sm">NFT #{tokenId}</div>
            <div className="text-xs">Image could not be loaded</div>
          </div>
        </div>
      )}
    </div>
  );
}







// -----------------------------------------------------------
// ProblemPanel
// -----------------------------------------------------------
//
// The teaching moment: a wrongly minted (or lost-content)
// token gets its diagnosis and the concrete fix, in amber,
// above everything else. Renders nothing for healthy tokens.
//
// Used by:
//   - NftDetailPage (below) — right column, first card
// -----------------------------------------------------------

function ProblemPanel({ problem }) {

  if (!problem) return null;


  return (
    <div className="bg-amber-50 border border-amber-300 rounded-xl p-6">
      <h3 className="text-xl font-bold text-amber-800 mb-1">⚠ This NFT has a problem</h3>
      <p className="font-semibold text-amber-800 mb-2">{problem.message}</p>
      <p className="text-sm text-amber-700">{problem.hint}</p>
    </div>
  );
}







// -----------------------------------------------------------
// InfoPanel
// -----------------------------------------------------------
//
// Name, description and the facts rows; the metadata link
// opens the raw JSON students can inspect.
//
// Used by:
//   - NftDetailPage (below) — right column, second card
// -----------------------------------------------------------

function InfoPanel({ metadata, metadataURL, nftAddress, tokenId, currentOwner, isOwner, isListed, currentPrice, metaLoading, ownerLoading }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-6">
      {metaLoading ? (
        <div className="animate-pulse space-y-3 mb-4">
          <div className="h-8 bg-gray-200 rounded w-2/3" />
          <div className="h-4 bg-gray-200 rounded w-full" />
        </div>
      ) : (
        <>
          <h1 className="text-3xl font-bold mb-2">
            {metadata?.name || `NFT #${tokenId}`}
          </h1>
          <p className="text-gray-600 mb-4">
            {metadata?.description || 'No description'}
          </p>
        </>
      )}

      <div className="space-y-2 text-sm">
        <div className="flex justify-between">
          <span className="text-gray-600">NFT Contract Address:</span>
          <a
            href={etherscanAddressUrl(nftAddress)}
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono text-[var(--color-primary)] hover:text-[var(--color-primary-hover)] underline"
            title={nftAddress}
          >
            {truncateAddress(nftAddress)} ↗
          </a>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-600">Token ID:</span>
          <span className="font-mono">#{tokenId}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-600">Current Owner:</span>
          {ownerLoading ? (
            <span className="inline-block h-4 w-32 bg-gray-200 rounded animate-pulse" />
          ) : isOwner ? (
            <span className="font-mono">You</span>
          ) : currentOwner ? (
            <a
              href={etherscanAddressUrl(currentOwner)}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono text-[var(--color-primary)] hover:text-[var(--color-primary-hover)] underline"
              title={currentOwner}
            >
              {truncateAddress(currentOwner)} ↗
            </a>
          ) : (
            <span className="font-mono text-gray-400">unknown (ownerOf reverted)</span>
          )}
        </div>
        {metadataURL && (
          <div className="flex justify-between">
            <span className="text-gray-600">Metadata:</span>
            <a
              href={metadataURL}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[var(--color-primary)] hover:text-[var(--color-primary-hover)] underline font-mono text-sm break-all"
            >
              View JSON →
            </a>
          </div>
        )}
        {isListed && currentPrice && (
          <div className="flex justify-between text-lg font-bold pt-2 border-t">
            <span>Current Price:</span>
            <span className="text-[var(--color-primary)]">
              {ethers.formatUnits(currentPrice, 'ether')} ETH
            </span>
          </div>
        )}
      </div>
    </div>
  );
}







// -----------------------------------------------------------
// ActionsPanel
// -----------------------------------------------------------
//
// The owner sees listing management, everyone else sees Buy
// Now (when listed) — DISABLED with the reason shown when
// the wallet cannot cover the price (gas comes on top, the
// wallet itself warns about that part). Only rendered with
// a connected wallet.
//
// Used by:
//   - NftDetailPage (below) — right column, second card
// -----------------------------------------------------------

function ActionsPanel({ isOwner, isListed, currentPrice, nftAddress, tokenId, onUpdateClick, onBuyClick, loading }) {

  const { address } = useAccount();
  const { data: balance } = useBalance({ address });

  // Gate only on a DEFINITIVE "can't afford" — while the
  // balance is still loading the button stays usable
  const insufficient = Boolean(
    balance && currentPrice && balance.value < BigInt(currentPrice)
  );


  // Owner unknown = can't tell buyer from seller yet
  if (loading) {
    return (
      <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-6 animate-pulse">
        <div className="h-6 bg-gray-200 rounded w-24 mb-4" />
        <div className="h-12 bg-gray-200 rounded" />
      </div>
    );
  }


  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-6">
      <h3 className="text-xl font-bold mb-4">Actions</h3>

      {isOwner ? (
        <div className="space-y-3">
          {isListed ? (
            <>
              <p className="text-sm text-gray-600 mb-4">
                Your NFT is currently listed for sale
              </p>
              <button
                onClick={onUpdateClick}
                className="w-full bg-[var(--color-primary)] text-white py-3 px-6 rounded-lg hover:bg-[var(--color-primary-hover)] font-semibold transition-colors"
              >
                Update Listing / Cancel
              </button>
            </>
          ) : (
            <>
              <p className="text-sm text-gray-600 mb-4">
                You own this NFT
              </p>
              <Link to={`/sell-nft?nftAddress=${nftAddress}&tokenId=${tokenId}`}>
                <button className="w-full bg-[var(--color-primary)] text-white py-3 px-6 rounded-lg hover:bg-[var(--color-primary-hover)] font-semibold transition-colors">
                  List for Sale
                </button>
              </Link>
            </>
          )}
        </div>
      ) : isListed && currentPrice ? (
        insufficient ? (
          <div>
            <button
              disabled
              className="w-full bg-gray-300 text-gray-500 py-3 px-6 rounded-lg font-semibold cursor-not-allowed"
            >
              Buy Now for {ethers.formatUnits(currentPrice, 'ether')} ETH
            </button>
            <p className="text-sm text-red-600 mt-2">
              Insufficient balance — your wallet holds{' '}
              {Number(ethers.formatUnits(balance.value, 'ether')).toFixed(4)} ETH
            </p>
          </div>
        ) : (
          <button
            onClick={onBuyClick}
            className="w-full bg-[var(--color-primary)] text-white py-3 px-6 rounded-lg hover:bg-[var(--color-primary-hover)] font-semibold transition-colors"
          >
            Buy Now for {ethers.formatUnits(currentPrice, 'ether')} ETH
          </button>
        )
      ) : (
        <p className="text-gray-600">This NFT is not currently for sale</p>
      )}
    </div>
  );
}







// -----------------------------------------------------------
// HistoryPanel
// -----------------------------------------------------------
//
// The token's whole event history as a vertical TIMELINE,
// newest at the top: a colour node per event on the rail
// (green sale, blue listing, violet price update, grey
// cancellation), the type chip, the actor's FULL address
// (linking to Etherscan) + the transaction link, the exact
// block datetime (YYYY-MM-DD HH:MM:SS) and the price
// right-aligned.
//
// Used by:
//   - NftDetailPage (below) — right column, third card
// -----------------------------------------------------------

// Every stripe ends with its on-chain receipt
const stripeTx = (txHash) => (
  <a
    href={etherscanTxUrl(txHash)}
    target="_blank"
    rel="noopener noreferrer"
    className="text-xs font-mono text-[var(--color-primary)] hover:text-[var(--color-primary-hover)] underline"
    title={txHash}
  >
    tx ↗
  </a>
);

// Timeline look per event type: the node colour on the rail,
// the chip (same palette as the activity feed) and the verb.
// The actor is the seller on everything except a sale, where
// it is the buyer.
const STRIPE = {
  Listed: { dot: 'bg-blue-500', chip: 'bg-blue-100 text-blue-800', label: 'Listed', joiner: 'by' },
  Updated: { dot: 'bg-violet-500', chip: 'bg-violet-100 text-violet-800', label: 'Price updated', joiner: 'by' },
  Bought: { dot: 'bg-green-500', chip: 'bg-green-100 text-green-800', label: 'Sold', joiner: 'to' },
  Canceled: { dot: 'bg-gray-400', chip: 'bg-gray-200 text-gray-600', label: 'Cancelled', joiner: 'by' },
};

function HistoryPanel({ events, loading }) {

  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-6">
      <h3 className="text-xl font-bold mb-5">Transaction History</h3>

      {loading ? (
        <div className="space-y-5 animate-pulse">
          {[0, 1, 2].map((i) => (
            <div key={i} className="relative pl-8">
              <span className="absolute left-0 top-1 w-3 h-3 rounded-full bg-gray-200" />
              <div className="h-4 bg-gray-200 rounded w-3/4 mb-2" />
              <div className="h-3 bg-gray-200 rounded w-1/2" />
            </div>
          ))}
        </div>
      ) : events?.length > 0 ? (
        <div className="relative">

          {/* The rail the event nodes sit on */}
          <div className="absolute left-[5px] top-2 bottom-2 w-0.5 bg-gray-200 rounded" />

          <div className="space-y-6">
            {events.map((event, index) => {
              const stripe = STRIPE[event.type] || STRIPE.Canceled;
              const actor = event.type === 'Bought' ? event.buyer : event.seller;

              return (
                <div key={index} className="relative pl-8">

                  {/* Node — ringed white so it reads as ON the rail */}
                  <span className={`absolute left-0 top-1 w-3 h-3 rounded-full ring-4 ring-white ${stripe.dot}`} />

                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold ${stripe.chip}`}>
                        {stripe.label}
                      </span>
                      <div className="text-sm text-gray-700 mt-1.5">
                        {stripe.joiner}{' '}
                        <a
                          href={etherscanAddressUrl(actor)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-mono break-all text-[var(--color-primary)] hover:text-[var(--color-primary-hover)] underline"
                        >
                          {actor}
                        </a>
                        {' '}· {stripeTx(event.txHash)}
                      </div>
                      <div className="text-xs text-gray-400 font-mono mt-1">
                        {formatDateTime(event.timestamp)} · block {event.blockNumber}
                      </div>
                    </div>

                    {event.price && (
                      <div className="text-sm font-bold text-gray-900 whitespace-nowrap">
                        {ethers.formatUnits(event.price, 'ether')} ETH
                      </div>
                    )}
                  </div>

                </div>
              );
            })}
          </div>

        </div>
      ) : (
        <p className="text-gray-500 text-sm">No transaction history yet</p>
      )}
    </div>
  );
}







// -----------------------------------------------------------
// ArchivePanel
// -----------------------------------------------------------
//
// The pinner's per-file verdict for this token — pinned on
// the course IPFS node (permanent), pending (still trying),
// skipped (not IPFS-addressed) or unreachable (gone from
// the network before we could replicate it). Honest teaching
// data: this is what "decentralized storage" actually does.
//
// Used by:
//   - NftDetailPage (below) — right column, fourth card
// -----------------------------------------------------------

// One chip per status — colour says it all at a glance
// ('invalid' = the metadata itself is wrongly minted)
const PIN_STATUS_STYLES = {
  pinned: 'bg-green-100 text-green-800',
  pending: 'bg-yellow-100 text-yellow-800',
  skipped: 'bg-gray-100 text-gray-600',
  invalid: 'bg-orange-100 text-orange-800',
  unreachable: 'bg-red-100 text-red-800',
};

function ArchivePanel({ archive }) {

  if (!archive?.length) return null;


  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-6">
      <h3 className="text-xl font-bold mb-1">IPFS Archive</h3>
      <p className="text-sm text-gray-500 mb-4">
        The course IPFS node pins every marketplace NFT's files so they outlive their original host.
      </p>
      <div className="space-y-2 text-sm">
        {archive.map((entry) => (
          <div key={entry.kind} className="flex justify-between items-center">
            <span className="capitalize text-gray-600">{entry.kind}</span>
            <span className="flex items-center gap-2">
              {entry.cid && (
                <span className="font-mono text-xs text-gray-500" title={entry.cid}>
                  {entry.cid.slice(0, 12)}...
                </span>
              )}
              <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${PIN_STATUS_STYLES[entry.status] || PIN_STATUS_STYLES.skipped}`}>
                {entry.status}
              </span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}







// -----------------------------------------------------------
// AttributesPanel
// -----------------------------------------------------------
//
// Only rendered when the metadata carries attributes.
//
// Used by:
//   - NftDetailPage (below) — right column, last card
// -----------------------------------------------------------

function AttributesPanel({ attributes }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-6">
      <h3 className="text-xl font-bold mb-4">Attributes</h3>
      <div className="grid grid-cols-2 gap-3">
        {attributes.map((attr, index) => (
          <div key={index} className="bg-gray-50 rounded p-3">
            <div className="text-xs text-gray-600 uppercase">{attr.trait_type}</div>
            <div className="font-semibold">{attr.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}







// -----------------------------------------------------------
// NftDetailPage (default export)
// -----------------------------------------------------------
//
// Loads owner + metadata from the chain, listing/history from
// the backend, and owns the two modals' visibility.
//
// Used by:
//   - App.jsx — route "/nft/:nftAddress/:tokenId"
// -----------------------------------------------------------

export default function NftDetailPage() {

  const { nftAddress, tokenId } = useParams();
  const { address: userAddress, isConnected } = useAccount();
  const { metadata, problem, metadataURL, loading: metaLoading } = useNftMetadata(nftAddress, tokenId);

  const [currentOwner, setCurrentOwner] = useState(null);
  const [ownerLoading, setOwnerLoading] = useState(true);
  const [showUpdateModal, setShowUpdateModal] = useState(false);
  const [showBuyModal, setShowBuyModal] = useState(false);


  // The backend stores addresses lowercase and lowercases the
  // path param itself — the URL may carry the checksummed form
  const { data: historyData, isLoading: historyLoading } = useQuery({
    queryKey: ['nft', nftAddress, tokenId],
    queryFn: () => apiGet(`/api/nft/${nftAddress}/${tokenId}`),
  });


  // Only the owner still comes from a direct chain read —
  // metadata (and its diagnosis) lives in useNftMetadata
  const fetchOwner = async () => {
    setOwnerLoading(true);
    try {
      const provider = new ethers.JsonRpcProvider(getConfig().rpcUrl);
      const nftContract = new ethers.Contract(
        nftAddress,
        ['function ownerOf(uint256 tokenId) view returns (address)'],
        provider
      );
      setCurrentOwner(await nftContract.ownerOf(tokenId));
    } catch (error) {
      console.error('ownerOf failed:', error);
      setCurrentOwner(null);
    } finally {
      setOwnerLoading(false);
    }
  };


  useEffect(() => {
    if (nftAddress && tokenId) {
      fetchOwner();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nftAddress, tokenId]);


  const isOwner = currentOwner?.toLowerCase() === userAddress?.toLowerCase();
  const isListed = Boolean(historyData?.activeListing);
  const currentPrice = historyData?.activeListing?.price || null;


  return (
    <div className="container mx-auto max-w-7xl px-4 py-8">

      <Link to="/" className="text-[var(--color-primary)] hover:text-[var(--color-primary-hover)] font-medium mb-6 inline-block">
        ← Back to Marketplace
      </Link>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mt-6 items-start">

        <ImagePanel metadata={metadata} tokenId={tokenId} loading={metaLoading} />

        <div className="space-y-6">
          <ProblemPanel problem={problem} />

          <InfoPanel
            metadata={metadata}
            metadataURL={metadataURL}
            nftAddress={nftAddress}
            tokenId={tokenId}
            currentOwner={currentOwner}
            isOwner={isOwner}
            isListed={isListed}
            currentPrice={currentPrice}
            metaLoading={metaLoading}
            ownerLoading={ownerLoading}
          />

          {isConnected && (
            <ActionsPanel
              isOwner={isOwner}
              isListed={isListed}
              currentPrice={currentPrice}
              nftAddress={nftAddress}
              tokenId={tokenId}
              onUpdateClick={() => setShowUpdateModal(true)}
              onBuyClick={() => setShowBuyModal(true)}
              loading={ownerLoading || historyLoading}
            />
          )}

          <HistoryPanel events={historyData?.events} loading={historyLoading} />

          <ArchivePanel archive={historyData?.archive} />

          {metadata?.attributes && metadata.attributes.length > 0 && (
            <AttributesPanel attributes={metadata.attributes} />
          )}
        </div>

      </div>

      {/* Modals — mounted only while the token is listed */}
      {isListed && (
        <>
          <UpdateListingModal
            isVisible={showUpdateModal}
            tokenId={tokenId}
            marketplaceAddress={getConfig().nftMarketplaceAddress}
            nftAddress={nftAddress}
            onClose={() => setShowUpdateModal(false)}
          />
          <BuyNftModal
            isVisible={showBuyModal}
            tokenId={tokenId}
            marketplaceAddress={getConfig().nftMarketplaceAddress}
            nftAddress={nftAddress}
            onClose={() => setShowBuyModal(false)}
            price={currentPrice}
          />
        </>
      )}

    </div>
  );
}
