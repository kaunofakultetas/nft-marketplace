"use client"
import { nftMarketplaceAbi } from "@/constants"
import { ethers } from "ethers"
import React, { useState } from "react"
import { useWriteContract } from "wagmi"
import toast from "react-hot-toast"

const UpdateListingModal = ({ nftAddress, tokenId, isVisible, marketplaceAddress, onClose }) => {
    const { writeContractAsync: updateContract } = useWriteContract()
    const { writeContractAsync: cancelContract } = useWriteContract()
    const [priceToUpdateListingWith, setPriceToUpdateListingWith] = useState(0)

    const handleUpdateListingSuccess = () => {
        toast.success("Listing updated successfully!")
        onClose && onClose()
        setPriceToUpdateListingWith("0")
    }

    const handleCancelListingSuccess = () => {
        toast.success("Listing cancelled successfully!")
        onClose && onClose()
    }

    const updateListingFunction = async () => {
        if (priceToUpdateListingWith <= 0) {
            alert("Please enter a price greater than 0!")
            return
        }
        try {
            const updateRequest = await updateContract({
                address: marketplaceAddress,
                abi: nftMarketplaceAbi,
                functionName: "updateListing",
                args: [nftAddress, tokenId, ethers.parseEther(priceToUpdateListingWith || "0")],
            })

            handleUpdateListingSuccess()
        } catch (error) {
            console.log("Update Listing Error:", error)
            toast.error(error.message || "Failed to update listing")
        }
    }

    const cancelListingFunction = async () => {
        try {
            const cancelRequest = await cancelContract({
                address: marketplaceAddress,
                abi: nftMarketplaceAbi,
                functionName: "cancelListing",
                args: [nftAddress, tokenId],
            })

            handleCancelListingSuccess()
        } catch (error) {
            console.log("Cancel Listing Error:", error)
            toast.error(error.message || "Failed to cancel listing")
        }
    }

    if (!isVisible) return null

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
            <div className="bg-white rounded-lg shadow-xl p-6 max-w-md w-full mx-4">
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

                {/* Update Price Section */}
                <div className="mb-6">
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                        Update Listing Price (ETH)
                    </label>
                    <input
                        type="number"
                        step="0.001"
                        min="0"
                        placeholder="Enter new price in ETH"
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        onChange={(event) => {
                            setPriceToUpdateListingWith(event.target.value)
                        }}
                    />
                </div>

                {/* Action Buttons */}
                <div className="space-y-3">
                    <button
                        onClick={updateListingFunction}
                        className="w-full bg-blue-600 text-white py-3 px-6 rounded-lg hover:bg-blue-700 font-semibold transition-colors"
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
    )
}

export default UpdateListingModal
