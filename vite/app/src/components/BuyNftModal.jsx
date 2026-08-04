// -----------------------------------------------------------
//  [*] BuyNftModal — "are you sure" purchase confirmation
//
//  Confirming calls buyListing on the marketplace with the
//  listing price as msg.value. The wallet popup does the real
//  waiting — the modal only fires the transaction and toasts
//  the submission result.
//
//  Used by:
//    - pages/NftDetail — the "Buy Now" button
// -----------------------------------------------------------

import { useWriteContract } from 'wagmi';
import { ethers } from 'ethers';
import toast from 'react-hot-toast';
import { nftMarketplaceAbi } from '@/constants';
import { formatWalletError } from '@/utils/format';







// -----------------------------------------------------------
// BuyNftModal (default export)
// -----------------------------------------------------------
//
// Used by:
//   - pages/NftDetail — the "Buy Now" button
// -----------------------------------------------------------

export default function BuyNftModal({ nftAddress, tokenId, isVisible, marketplaceAddress, onClose, price }) {

  const { writeContractAsync: buyNftFunc } = useWriteContract();


  const buyListingFunction = async () => {
    try {
      await buyNftFunc({
        address: marketplaceAddress,
        abi: nftMarketplaceAbi,
        functionName: 'buyListing',
        args: [nftAddress, tokenId],
        value: price,
      });

      toast.success('Successfully bought the NFT! The marketplace updates once the indexer scans the block (~30 s).');
    } catch (error) {
      console.log('Buy Item Error:', error);
      toast.error(formatWalletError(error, 'Failed to buy NFT. Please try again.'));
    }
  };


  if (!isVisible) return null;


  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-xl shadow-xl p-6 max-w-md w-full mx-4">

        <p className="text-xl text-gray-950 font-semibold">
          Are you sure you want to buy this NFT for {price ? ethers.formatUnits(price, 'ether') : '???'}{' '}
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
            className="bg-[var(--color-primary)] text-white py-2 px-6 rounded-lg hover:bg-[var(--color-primary-hover)] font-semibold transition-colors"
          >
            OK
          </button>
        </div>

      </div>
    </div>
  );
}
