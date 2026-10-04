// -----------------------------------------------------------
//  [*] SellNft — approve + list form and proceeds withdrawal
//
//  Listing is TWO wallet transactions in sequence: approve the
//  marketplace on the NFT contract, wait for that approval to
//  confirm on-chain (listItem reverts without it), then
//  listItem on the marketplace. Toasts narrate each step. The
//  price is checked before any wallet popup — above zero, and
//  no finer than ether's 18 decimals — and the approval's
//  receipt is read: a reverted approval stops the listing,
//  and a chain that cannot be read says so instead of leaving
//  the student waiting for ever.
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
//  contract until pulled) — read for whichever account is
//  connected, and read again once a withdrawal is mined.
//
//  Split into (root component last):
//
//    FormField      — one labelled input row
//    OwnedNftPicker — tap-to-fill chips of unlisted NFTs
//    SellNftPage    — form + proceeds cards (default export)
// -----------------------------------------------------------

import { useState, useId } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAccount, usePublicClient, useReadContract, useWriteContract } from 'wagmi';
import { useQuery } from '@tanstack/react-query';
import { ethers } from 'ethers';
import toast from 'react-hot-toast';
import { nftAbi, nftMarketplaceAbi } from '@/constants';
import { getConfig } from '@/config';
import { apiGet } from '@/utils/api';
import { waitForReceipt } from '@/utils/chain';
import { truncateAddress, formatEth, formatWalletError } from '@/utils/format';
import ConnectPrompt from '@/components/ConnectPrompt';


// An approval mined but reverted — most likely a token that
// is not the student's to approve
const APPROVAL_REVERTED = 'The approval reverted on-chain — check that this NFT is yours. Nothing was listed.';

// An approval sent that the relay cannot confirm — it may
// still be mined, so the student checks before trying again
const APPROVAL_UNCONFIRMED = 'Could not confirm the approval — the chain cannot be read right now. Check the transaction on Etherscan before listing again.';

// A withdrawal mined but reverted
const WITHDRAWAL_REVERTED = 'The withdrawal reverted on-chain — nothing was withdrawn.';

// A withdrawal sent that the relay cannot confirm
const WITHDRAWAL_UNCONFIRMED = 'The withdrawal was sent, but cannot be confirmed — the chain cannot be read right now.';







// -----------------------------------------------------------
// FormField
// -----------------------------------------------------------
//
// One input with its label tied to it, so the label names
// the field for assistive tech.
//
// Used by:
//   - SellNftPage (below) — the three form inputs
// -----------------------------------------------------------

function FormField({ label, type, value, onChange, placeholder }) {

  const id = useId();


  return (
    <div className="mb-4">
      <label htmlFor={id} className="block text-sm font-medium text-gray-700 mb-2">
        {label}
      </label>
      <input
        id={id}
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
// purpose. It offers nothing it cannot vouch for: nothing
// until both the holdings and the listings are in, both of
// them lists — a read that failed or an answer without its
// list leaves the picker away, and the fields still take any
// token by hand — and nothing while the wallet has no
// unlisted NFTs.
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


  const held = Array.isArray(myNftsData?.nfts) ? myNftsData.nfts : null;
  const listed = Array.isArray(listingsData?.listings) ? listingsData.listings : null;
  if (!held || !listed) return null;

  const listedKeys = new Set(listed.map((item) => `${item.nftAddress}-${item.tokenId}`));
  const available = held.filter((nft) => !listedKeys.has(`${nft.nftAddress}-${nft.tokenId}`));

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
// The page: the prefill notice, the listing form with its
// picker, then the proceeds card. Holds the approve-then-
// list flow and the withdrawal; without a wallet, the
// connect prompt alone.
//
// Used by:
//   - App.jsx — route "/sell-nft"
// -----------------------------------------------------------

export default function SellNftPage() {

  const { isConnected, address: userAddress } = useAccount();
  const publicClient = usePublicClient();
  const { nftMarketplaceAddress } = getConfig();
  const [searchParams] = useSearchParams();

  const [nftAddress, setNftAddress] = useState(searchParams.get('nftAddress') || '');
  const [tokenId, setTokenId] = useState(searchParams.get('tokenId') || '');
  const [priceInput, setPriceInput] = useState('');

  const { writeContractAsync: approveNft } = useWriteContract();
  const { writeContractAsync: listNft } = useWriteContract();
  const { writeContractAsync: withdrawProceedsFromContract } = useWriteContract();

  const prefilled = Boolean(searchParams.get('nftAddress') && searchParams.get('tokenId'));


  // The connected account's proceeds as the contract has them
  // — none (0) while they are still being read
  const { data: proceeds = 0n, refetch: refetchProceeds } = useReadContract({
    address: nftMarketplaceAddress,
    abi: nftMarketplaceAbi,
    functionName: 'getProceeds',
    args: [userAddress],
  });


  // Approve, wait for on-chain confirmation, then list —
  // listing before the approval confirms would revert
  const approveAndList = async (event) => {
    event.preventDefault();

    if (!(nftAddress && tokenId && priceInput)) {
      toast.error('Please fill in all fields: NFT Address, Token ID, and Price');
      return;
    }

    // Checked before the wallet is asked for anything: the
    // contract refuses a zero price only after the approval
    // was paid for, and ethers refuses more than 18 decimals
    let price;
    try {
      price = ethers.parseUnits(priceInput, 'ether');
    } catch (error) {
      toast.error(formatWalletError(error, 'Please enter a price in ETH.'));
      return;
    }
    if (price <= 0n) {
      toast.error('Please enter a price greater than 0!');
      return;
    }

    try {
      toast.loading('Please confirm the approval transaction in your wallet');

      const approvalTxHash = await approveNft({
        address: nftAddress,
        abi: nftAbi,
        functionName: 'approve',
        args: [nftMarketplaceAddress, tokenId],
      });

      toast.loading('Waiting for approval to be confirmed on blockchain...');

      let receipt;
      try {
        receipt = await waitForReceipt(publicClient, approvalTxHash);
      } catch (error) {
        console.log('Approval Receipt Error:', error);
        toast.error(APPROVAL_UNCONFIRMED);
        return;
      }
      if (receipt.status !== 'success') {
        toast.error(APPROVAL_REVERTED);
        return;
      }

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


  // Withdraw, then read the proceeds again once the
  // withdrawal is mined — the card must not keep offering
  // what is gone
  const withdrawProceeds = async () => {
    try {
      const withdrawalTxHash = await withdrawProceedsFromContract({
        address: nftMarketplaceAddress,
        abi: nftMarketplaceAbi,
        functionName: 'withdrawProceeds',
      });

      let receipt;
      try {
        receipt = await waitForReceipt(publicClient, withdrawalTxHash);
      } catch (error) {
        console.log('Withdrawal Receipt Error:', error);
        toast.error(WITHDRAWAL_UNCONFIRMED);
        return;
      }
      if (receipt.status !== 'success') {
        toast.error(WITHDRAWAL_REVERTED);
        return;
      }

      await refetchProceeds();
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
            Withdraw {formatEth(proceeds)} ETH proceeds
          </p>
          {proceeds > 0n ? (
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
