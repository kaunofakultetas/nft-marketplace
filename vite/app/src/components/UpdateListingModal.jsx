// -----------------------------------------------------------
//  [*] UpdateListingModal — manage an existing listing
//
//  Two actions on one modal: update the price (updateListing)
//  or cancel the listing entirely (cancelListing). The price
//  field starts empty; submitting without a positive price is
//  rejected client-side before any wallet popup.
//
//  Used by:
//    - pages/NftDetail — the "Update Listing / Cancel" button
// -----------------------------------------------------------

import { useState } from 'react';
import { useWriteContract } from 'wagmi';
import { ethers } from 'ethers';
import toast from 'react-hot-toast';
import { nftMarketplaceAbi } from '@/constants';
import { formatWalletError } from '@/utils/format';







// -----------------------------------------------------------
// UpdateListingModal (default export)
// -----------------------------------------------------------
//
// Used by:
//   - pages/NftDetail — the "Update Listing / Cancel" button
// -----------------------------------------------------------

export default function UpdateListingModal({ nftAddress, tokenId, isVisible, marketplaceAddress, onClose }) {

  const { writeContractAsync: updateContract } = useWriteContract();
  const { writeContractAsync: cancelContract } = useWriteContract();
  const [priceToUpdateListingWith, setPriceToUpdateListingWith] = useState(0);


  const updateListingFunction = async () => {
    if (priceToUpdateListingWith <= 0) {
      alert('Please enter a price greater than 0!');
      return;
    }
    try {
      await updateContract({
        address: marketplaceAddress,
        abi: nftMarketplaceAbi,
        functionName: 'updateListing',
        args: [nftAddress, tokenId, ethers.parseEther(priceToUpdateListingWith || '0')],
      });

      toast.success('Listing updated! The new price shows once the indexer scans the block (~30 s).');
      onClose && onClose();
      setPriceToUpdateListingWith('0');
    } catch (error) {
      console.log('Update Listing Error:', error);
      toast.error(formatWalletError(error, 'Failed to update listing'));
    }
  };


  const cancelListingFunction = async () => {
    try {
      await cancelContract({
        address: marketplaceAddress,
        abi: nftMarketplaceAbi,
        functionName: 'cancelListing',
        args: [nftAddress, tokenId],
      });

      toast.success('Listing cancelled! It disappears once the indexer scans the block (~30 s).');
      onClose && onClose();
    } catch (error) {
      console.log('Cancel Listing Error:', error);
      toast.error(formatWalletError(error, 'Failed to cancel listing'));
    }
  };


  if (!isVisible) return null;


  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-xl shadow-xl p-6 max-w-md w-full mx-4">

        {/* Header */}
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-2xl font-bold">Manage Listing</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-2xl"
          >
            ×
          </button>
        </div>

        {/* Update price section */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Update Listing Price (ETH)
          </label>
          <input
            type="number"
            step="0.001"
            min="0"
            placeholder="Enter new price in ETH"
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[var(--color-primary)] focus:border-transparent"
            onChange={(event) => {
              setPriceToUpdateListingWith(event.target.value);
            }}
          />
        </div>

        {/* Action buttons */}
        <div className="space-y-3">
          <button
            onClick={updateListingFunction}
            className="w-full bg-[var(--color-primary)] text-white py-3 px-6 rounded-lg hover:bg-[var(--color-primary-hover)] font-semibold transition-colors"
          >
            Update Price
          </button>

          <button
            onClick={cancelListingFunction}
            className="w-full bg-red-600 text-white py-3 px-6 rounded-lg hover:bg-red-700 font-semibold transition-colors"
          >
            Cancel Listing
          </button>

          <button
            onClick={onClose}
            className="w-full bg-gray-200 text-gray-700 py-3 px-6 rounded-lg hover:bg-gray-300 font-semibold transition-colors"
          >
            Close
          </button>
        </div>

      </div>
    </div>
  );
}
