// -----------------------------------------------------------
//  [*] SellNft — approve + list form and proceeds withdrawal
//
//  Listing is TWO wallet transactions in sequence: approve the
//  marketplace on the NFT contract, wait for that approval to
//  confirm on-chain (listItem reverts without it), then
//  listItem on the marketplace. Toasts narrate each step.
//
//  The form fills THREE ways, like a real marketplace with
//  the machinery still visible: tap one of your unlisted
//  NFTs in the picker, arrive with ?nftAddress=...&tokenId=
//  prefilled (the NFT detail page links here), or type the
//  raw address + token id by hand — the technical fallback
//  stays on purpose.
//
//  Two white cards on the grey canvas: the listing form and,
//  below it, the wallet's accumulated sale proceeds with a
//  withdraw button (proceeds stay in the marketplace
//  contract until pulled).
//
//  Split into (root component last):
//
//    FormField      — one labelled input row
//    OwnedNftPicker — tap-to-fill chips of unlisted NFTs
//    SellNftPage    — form + proceeds cards (default export)
// -----------------------------------------------------------

import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAccount, useReadContract, useWriteContract } from 'wagmi';
import { useQuery } from '@tanstack/react-query';
import { ethers } from 'ethers';
import toast from 'react-hot-toast';
import { nftAbi, nftMarketplaceAbi } from '@/constants';
import { getConfig } from '@/config';
import { apiGet } from '@/utils/api';
import { truncateAddress, formatWalletError } from '@/utils/format';
import ConnectPrompt from '@/components/ConnectPrompt';







// -----------------------------------------------------------
// FormField
// -----------------------------------------------------------
//
// Used by:
//   - SellNftPage (below) — the three form inputs
// -----------------------------------------------------------

function FormField({ label, type, value, onChange, placeholder }) {
  return (
    <div className="mb-4">
      <label className="block text-sm font-medium text-gray-700 mb-2">
        {label}
      </label>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[var(--color-primary)] focus:border-transparent"
      />
    </div>
  );
}







// -----------------------------------------------------------
// OwnedNftPicker
// -----------------------------------------------------------
//
// The wallet's NFTs as tap-to-fill chips — already-listed
// tokens are filtered out (the contract reverts on a double
// listing). Chips show the raw address + token id on
// purpose; renders nothing while the wallet has no unlisted
// NFTs.
//
// Used by:
//   - SellNftPage (below) — above the manual fields
// -----------------------------------------------------------

function OwnedNftPicker({ selectedKey, onPick }) {

  const { address } = useAccount();

  const { data: myNftsData } = useQuery({
    queryKey: ['my-nfts', address],
    queryFn: () => apiGet(`/api/my-nfts/${address}`),
    enabled: Boolean(address),
  });

  const { data: listingsData } = useQuery({
    queryKey: ['listings'],
    queryFn: () => apiGet('/api/listings'),
  });


  const listedKeys = new Set(
    (listingsData?.listings || []).map((item) => `${item.nftAddress}-${item.tokenId}`)
  );
  const available = (myNftsData?.nfts || []).filter(
    (nft) => !listedKeys.has(`${nft.nftAddress}-${nft.tokenId}`)
  );

  if (!available.length) return null;


  return (
    <div className="mb-6">
      <div className="text-sm font-medium text-gray-700 mb-2">
        Your NFTs — tap to fill the form
      </div>
      <div className="flex flex-wrap gap-2">
        {available.map((nft) => {
          const key = `${nft.nftAddress}-${nft.tokenId}`;

          return (
            <button
              key={key}
              type="button"
              onClick={() => onPick(nft)}
              title={nft.nftAddress}
              className={
                'px-3 py-1.5 rounded-full text-xs font-mono border transition-colors ' +
                (key === selectedKey
                  ? 'bg-[var(--color-primary)] text-white border-transparent'
                  : 'bg-white text-gray-700 border-gray-300 hover:border-[var(--color-primary)]')
              }
            >
              {truncateAddress(nft.nftAddress)} #{nft.tokenId}
            </button>
          );
        })}
      </div>
    </div>
  );
}







// -----------------------------------------------------------
// SellNftPage (default export)
// -----------------------------------------------------------
//
// Used by:
//   - App.jsx — route "/sell-nft"
// -----------------------------------------------------------

export default function SellNftPage() {

  const { isConnected, address: userAddress } = useAccount();
  const { nftMarketplaceAddress, rpcUrl } = getConfig();
  const [searchParams] = useSearchParams();

  const [nftAddress, setNftAddress] = useState(searchParams.get('nftAddress') || '');
  const [tokenId, setTokenId] = useState(searchParams.get('tokenId') || '');
  const [priceInput, setPriceInput] = useState('');
  const [proceeds, setProceeds] = useState('0');

  const { writeContractAsync: approveNft } = useWriteContract();
  const { writeContractAsync: listNft } = useWriteContract();
  const { writeContractAsync: withdrawProceedsFromContract } = useWriteContract();

  const prefilled = Boolean(searchParams.get('nftAddress') && searchParams.get('tokenId'));


  const { data: returnedProceeds } = useReadContract({
    address: nftMarketplaceAddress,
    abi: nftMarketplaceAbi,
    functionName: 'getProceeds',
    args: [userAddress],
  });


  useEffect(() => {
    if (returnedProceeds) {
      setProceeds(returnedProceeds.toString());
    }
  }, [returnedProceeds]);


  // Approve, wait for on-chain confirmation, then list —
  // listing before the approval confirms would revert
  const approveAndList = async (event) => {
    event.preventDefault();

    if (!(nftAddress && tokenId && priceInput)) {
      toast.error('Please fill in all fields: NFT Address, Token ID, and Price');
      return;
    }
    const price = ethers.parseUnits(priceInput, 'ether').toString();

    try {
      toast.loading('Please confirm the approval transaction in your wallet');

      const approvalTxHash = await approveNft({
        address: nftAddress,
        abi: nftAbi,
        functionName: 'approve',
        args: [nftMarketplaceAddress, tokenId],
      });

      toast.loading('Waiting for approval to be confirmed on blockchain...');

      const provider = new ethers.JsonRpcProvider(rpcUrl);
      await provider.waitForTransaction(approvalTxHash);

      toast.success('Approval confirmed! Now listing your NFT...');

      await listItem(price);
    } catch (error) {
      console.log('Approve Error:', error);
      toast.error(formatWalletError(error, 'Failed to approve NFT. Please try again.'));
    }
  };


  const listItem = async (price) => {
    try {
      toast.loading('Please confirm the listing transaction in your wallet');

      await listNft({
        address: nftMarketplaceAddress,
        abi: nftMarketplaceAbi,
        functionName: 'listItem',
        args: [nftAddress, tokenId, price],
      });

      toast.success('Your NFT has been listed! It appears once the indexer scans the block (~30 s).');
    } catch (error) {
      console.log('List Error: ', error);
      toast.error(formatWalletError(error, 'Failed to list NFT. Please try again.'));
    }
  };


  const withdrawProceeds = async () => {
    try {
      await withdrawProceedsFromContract({
        address: nftMarketplaceAddress,
        abi: nftMarketplaceAbi,
        functionName: 'withdrawProceeds',
      });

      toast.success('Proceeds withdrawn successfully!');
    } catch (error) {
      console.log('Withdraw Error:', error);
      toast.error(formatWalletError(error, 'Failed to withdraw proceeds. Please try again.'));
    }
  };


  if (!isConnected) {
    return <ConnectPrompt message="Please connect your wallet to sell an NFT" />;
  }


  return (
    <div className="container mx-auto max-w-7xl px-4 py-8">
      <div className="max-w-xl mx-auto space-y-6">

        {/* Prefill notice — arriving from an NFT detail page */}
        {prefilled && (
          <div className="bg-green-50 border border-green-200 rounded-lg p-4">
            <p className="text-green-800">
              ✅ NFT details have been prefilled! Just enter the price.
            </p>
          </div>
        )}

        {/* The listing form */}
        <form onSubmit={approveAndList} className="bg-white border border-gray-200 rounded-xl shadow-sm p-6">
          <h1 className="text-3xl font-bold tracking-tight mb-1">Sell your NFT</h1>
          <p className="text-sm text-gray-500 mb-6">Two wallet transactions: approve the marketplace, then list</p>

          <OwnedNftPicker
            selectedKey={`${nftAddress}-${tokenId}`}
            onPick={(nft) => {
              setNftAddress(nft.nftAddress);
              setTokenId(nft.tokenId);
            }}
          />

          <FormField
            label="NFT Address"
            type="text"
            value={nftAddress}
            onChange={setNftAddress}
            placeholder="0x..."
          />
          <FormField
            label="Token ID"
            type="number"
            value={tokenId}
            onChange={setTokenId}
            placeholder="0"
          />
          <FormField
            label="Price (in ETH)"
            type="number"
            value={priceInput}
            onChange={setPriceInput}
            placeholder="0.1"
          />

          <button
            type="submit"
            className="w-full text-white text-lg font-semibold py-3 mt-4 rounded-lg bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] transition-colors"
          >
            List NFT for Sale
          </button>
        </form>

        {/* Sale proceeds — accumulated in the marketplace
            contract until withdrawn */}
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-6">
          <h3 className="text-xl font-bold mb-3">Proceeds</h3>
          <p className="text-gray-700 mb-4">
            Withdraw {ethers.formatUnits(proceeds, 'ether')} ETH proceeds
          </p>
          {proceeds != '0' ? (
            <button
              type="button"
              onClick={withdrawProceeds}
              className="w-full text-white text-lg font-semibold py-3 rounded-lg bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] transition-colors"
            >
              Withdraw Now
            </button>
          ) : (
            <p className="text-gray-500 text-sm">No proceeds to withdraw yet</p>
          )}
        </div>

      </div>
    </div>
  );
}
