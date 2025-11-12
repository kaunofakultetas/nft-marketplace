"use client"
import React from "react"
import { Modal } from "@web3uikit/core"
import { useAccount, useWriteContract } from "wagmi"
import { ethers } from "ethers"
import { nftMarketplaceAbi } from "@/constants"
import toast from "react-hot-toast"

const BuyNftModal = ({ nftAddress, tokenId, isVisible, marketplaceAddress, onClose, price }) => {
    const { writeContractAsync: buyNftFunc } = useWriteContract()
    const { isConnected } = useAccount()

    const handleUpdateListingSuccess = () => {
        toast.success("Successfully bought the NFT!")
        // onClose && onClose()
    }

    const buyListingFunction = async () => {
        console.log("buy Button clicked")
        console.log("user is connected", isConnected)
        console.log("price", ethers.parseEther(price))
        try {
            const buyRequest = await buyNftFunc({
                address: marketplaceAddress,
                abi: nftMarketplaceAbi,
                functionName: "buyListing",
                args: [nftAddress, tokenId],
                value: price,
            })

            handleUpdateListingSuccess()
        } catch (error) {
            console.log("Buy Item Error:", error)
            toast.error(error.message || "Failed to buy NFT. Please try again.")
        }
    }

    return (
        <Modal
            isVisible={isVisible}
            onCancel={onClose}
            onCloseButtonPressed={onClose}
            onOk={() => {
                buyListingFunction()
            }}
        >
            <div>
                <p className="text-xl text-gray-950 font-semibold">
                    Are you sure you want to buy this NFT for {price ? ethers.formatUnits(price, "ether") : "???"}{" "}
                    ETH?
                </p>
            </div>
        </Modal>
    )
}

export default BuyNftModal
