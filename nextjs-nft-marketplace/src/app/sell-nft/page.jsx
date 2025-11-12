"use client"
import { Form, Button } from "@web3uikit/core"
import React, { useState, useEffect, Suspense } from "react"
import styles from "../../styles/Home.module.css"
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from "wagmi"
import { nftAbi, nftMarketplaceAbi, nftMarketplaceAddress } from "@/constants"
import { wagmiConfig } from "../_app"
import { ConnectButton } from "@rainbow-me/rainbowkit"
import { ethers } from "ethers"
import { useSearchParams } from "next/navigation"
import toast from "react-hot-toast"

const SellPageContent = () => {
    const [proceeds, setProceeds] = useState("0")
    const { isConnected, address: userAddress } = useAccount({ wagmiConfig })
    const searchParams = useSearchParams()
    
    // Get prefilled values from URL
    const prefilledNftAddress = searchParams.get('nftAddress') || ""
    const prefilledTokenId = searchParams.get('tokenId') || ""
    const { writeContractAsync: approveNft } = useWriteContract()
    const { writeContractAsync: listNft } = useWriteContract()
    const { writeContractAsync: withdrawProceedsFromContract } = useWriteContract()

    // 1.  function that return proceeds
    const { data: returnedProceeds } = useReadContract({
        address: nftMarketplaceAddress,
        abi: nftMarketplaceAbi,
        functionName: "getProceeds",
        args: [userAddress],
    })
    useEffect(() => {
        if (returnedProceeds) {
            setProceeds(returnedProceeds.toString())
        }
    }, [returnedProceeds])

    // 2. List Sell
    const approveAndList = async (data) => {
        console.log("Approving...")

        // data from form
        const nftAddress = data.data[0].inputResult
        const tokenId = data.data[1].inputResult
        const priceInput = data.data[2].inputResult
        if (!(nftAddress && tokenId && priceInput)) {
            toast.error("Please fill in all fields: NFT Address, Token ID, and Price")
            throw new Error("Missing required fields") // Prevent form reset
        }
        const price = ethers.parseUnits(priceInput, "ether").toString()

        try {
            console.log("📝 Submitting approval transaction...")
            toast.loading("Please confirm the approval transaction in your wallet")

            const approvalTxHash = await approveNft({
                address: nftAddress,
                abi: nftAbi,
                functionName: "approve",
                args: [nftMarketplaceAddress, tokenId],
            })

            console.log("⏳ Waiting for approval transaction to be confirmed...")
            toast.loading("Waiting for approval to be confirmed on blockchain...")

            // Wait for approval transaction to be confirmed
            const provider = new ethers.JsonRpcProvider(process.env.NEXT_PUBLIC_RPC_URL)
            const receipt = await provider.waitForTransaction(approvalTxHash)
            
            console.log("✅ Approval confirmed! Now listing NFT...")
            toast.success("Approval confirmed! Now listing your NFT...")

            // Now list the NFT
            handleApproveSuccess(nftAddress, tokenId, price)
        } catch (error) {
            console.log("Approve Error:", error)
            toast.error(error.message || "Failed to approve NFT. Please try again.")
            throw error // Prevent form reset
        }
    }

    // list approved nft
    const handleApproveSuccess = async (nftAddress, tokenId, price) => {
        try {
            console.log("📝 Submitting listing transaction...")
            toast.loading("Please confirm the listing transaction in your wallet")

            const listRequest = await listNft({
                address: nftMarketplaceAddress,
                abi: nftMarketplaceAbi,
                functionName: "listItem",
                args: [nftAddress, tokenId, price],
            })

            handleListSuccess()
        } catch (error) {
            console.log("List Error: ", error)
            toast.error(error.message || "Failed to list NFT. Please try again.")
            throw error
        }
    }

    // withdraw proceeds
    const withdrawProceeds = async () => {
        try {
            const withdrawRequest = await withdrawProceedsFromContract({
                address: nftMarketplaceAddress,
                abi: nftMarketplaceAbi,
                functionName: "withdrawProceeds",
            })

            handleWithdrawSuccess()
        } catch (error) {
            console.log("Withdraw Error:", error)
            toast.error(error.message || "Failed to withdraw proceeds. Please try again.")
        }
    }

    const handleListSuccess = () => {
        toast.success("Your NFT has been successfully listed on the marketplace!")
    }
    const handleWithdrawSuccess = () => {
        toast.success("Proceeds withdrawn successfully!")
    }
    if (!isConnected) {
        return (
            <div className="flex flex-col gap-6 justify-center items-center h-[80vh]">
                <div className="text-xl font-sans font-semibold">
                    Kindly first Connect your account!
                </div>
                <ConnectButton label="Connect Now" />{" "}
            </div>
        )
    }

    return (
        <div className={styles.container}>
            {/* Custom styling for submit button */}
            <style jsx global>{`
                #Main\\ Form button[type="submit"] {
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%) !important;
                    color: white !important;
                    font-size: 18px !important;
                    font-weight: 600 !important;
                    padding: 14px 32px !important;
                    border-radius: 10px !important;
                    border: none !important;
                    cursor: pointer !important;
                    box-shadow: 0 4px 15px rgba(102, 126, 234, 0.4) !important;
                    transition: all 0.3s ease !important;
                    margin-top: 20px !important;
                }
                #Main\\ Form button[type="submit"]:hover {
                    transform: translateY(-2px) !important;
                    box-shadow: 0 6px 20px rgba(102, 126, 234, 0.6) !important;
                }
                #Main\\ Form button[type="submit"]:active {
                    transform: translateY(0px) !important;
                }
            `}</style>
            
            {/* Show message when fields are prefilled */}
            {prefilledNftAddress && prefilledTokenId && (
                <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-4">
                    <p className="text-green-800">
                        ✅ NFT details have been prefilled! Just enter the price.
                    </p>
                </div>
            )}
            
            {/* Form  */}
            <Form
                onSubmit={approveAndList}
                title="Sell your NFT!"
                id="Main Form"
                buttonConfig={{
                    theme: "primary",
                    text: "List NFT for Sale",
                    disabled: false,
                }}
                data={[
                    {
                        name: "NFT Address",
                        type: "text",
                        inputWidth: "50%",
                        value: prefilledNftAddress,
                        key: "nftAddress",
                    },
                    {
                        name: "Token ID",
                        type: "number",
                        // inputWidth: "50%",
                        value: prefilledTokenId,
                        key: "tokenId",
                    },
                    {
                        name: "Price (in ETH)",
                        type: "number",
                        // inputWidth: "",
                        value: "",
                        key: "price",
                    },
                ]}
            />
            {/* All Proceeds */}
            <div>Withdraw {ethers.formatUnits(proceeds, "ether")} ETH proceeds</div>
            {proceeds != "0" ? (
                <button
                    className="text-white text-xl bg-green-400 hover:bg-green-700 focus:ring-4 focus:ring-green-800 font-medium rounded-lg px-5 py-2.5 me-2 mb-2  focus:outline-none dark:focus:ring-blue-800"
                    text="Withdraw"
                    type="button"
                    onClick={() => {
                        withdrawProceeds()
                    }}
                >
                    Withdraw Now
                </button>
            ) : (
                <div>No Proceeds Detected</div>
            )}
        </div>
    )
}

const SellPage = () => {
    return (
        <Suspense fallback={<div className="container mx-auto p-8">Loading...</div>}>
            <SellPageContent />
        </Suspense>
    )
}

export default SellPage
