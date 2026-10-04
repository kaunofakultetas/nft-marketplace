// -----------------------------------------------------------
//  [*] BuyNftModal — "are you sure" purchase confirmation
//
//  Confirming calls buyListing on the marketplace with the
//  listing price as msg.value. The wallet popup does the real
//  waiting — the modal only fires the transaction, toasts the
//  submission result and closes once the purchase is on its
//  way. OK is disabled while the wallet's confirmation is
//  open: a second click would queue a second purchase.
//
//  Used by:
//    - pages/NftDetail — the "Buy Now" button
// -----------------------------------------------------------

import { useState } from 'react';
import { useWriteContract } from 'wagmi';
import toast from 'react-hot-toast';
import { nftMarketplaceAbi } from '@/constants';
import { formatEth, formatWalletError } from '@/utils/format';







// -----------------------------------------------------------
// BuyNftModal (default export)
// -----------------------------------------------------------
//
// The question with the price in ether, Cancel, and OK —
// which sends the purchase; nothing at all while hidden.
//
// Used by:
//   - pages/NftDetail — the "Buy Now" button
// -----------------------------------------------------------

export default function BuyNftModal({ nftAddress, tokenId, isVisible, marketplaceAddress, onClose, price }) {

  const { writeContractAsync: buyNftFunc } = useWriteContract();
  const [buying, setBuying] = useState(false);


  const buyListingFunction = async () => {
    setBuying(true);
    try {
      await buyNftFunc({
        address: marketplaceAddress,
        abi: nftMarketplaceAbi,
        functionName: 'buyListing',
        args: [nftAddress, tokenId],
        value: price,
      });

      toast.success('Successfully bought the NFT! The marketplace updates once the indexer scans the block (~30 s).');
      onClose();
    } catch (error) {
      console.log('Buy Item Error:', error);
      toast.error(formatWalletError(error, 'Failed to buy NFT. Please try again.'));
    } finally {
      setBuying(false);
    }
  };


  if (!isVisible) return null;


  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-xl shadow-xl p-6 max-w-md w-full mx-4">

        <p className="text-xl text-gray-950 font-semibold">
          Are you sure you want to buy this NFT for {formatEth(price) ?? '???'}{' '}
          ETH?
        </p>

        <div className="flex justify-end gap-3 mt-6">
          <button
            onClick={onClose}
            className="bg-gray-200 text-gray-700 py-2 px-6 rounded-lg hover:bg-gray-300 font-semibold transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={buyListingFunction}
            disabled={buying}
            className="bg-[var(--color-primary)] text-white py-2 px-6 rounded-lg hover:bg-[var(--color-primary-hover)] font-semibold transition-colors disabled:opacity-50 disabled:cursor-wait"
          >
            OK
          </button>
        </div>

      </div>
    </div>
  );
}
