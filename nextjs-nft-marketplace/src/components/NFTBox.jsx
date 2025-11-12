import { wagmiConfig } from "@/app/_app"
import { nftAbi, nftMarketplaceAddress } from "@/constants"
import React, { useState, useEffect } from "react"
import { useAccount, useReadContract, useWriteContract } from "wagmi"
import Image from "next/image"
import { ethers } from "ethers"
import UpdateListingModal from "./UpdateListingModal"
import BuyNftModal from "./BuyNftModal"
import { useRouter } from "next/navigation"
import toast from "react-hot-toast"




const truncateStr = (fullStr, strLen) => {
    if (fullStr.length <= strLen) return fullStr

    const separator = "..."
    const seperatorLength = separator.length
    const charsToShow = strLen - seperatorLength
    const frontChars = Math.ceil(charsToShow / 2)
    const backChars = Math.floor(charsToShow / 2)
    return (
        fullStr.substring(0, frontChars) +
        separator +
        fullStr.substring(fullStr.length - backChars)
    )
}

const NFTBox = ({ price, nftAddress, tokenId, seller }) => {
    const [imageURI, setImageURI] = useState("")
    const [tokenName, setTokenName] = useState("")
    const [tokenDescription, setTokenDescription] = useState("")
    const [showModal, setShowModal] = useState(false)
    const [showBuyModal, setShowBuyModel] = useState(false)
    const [loading, setLoading] = useState(true)
    const hideModal = () => setShowModal(false)
    const hideBuyModal = () => setShowBuyModel(false)
    const { isConnected, address: userAddress } = useAccount({ wagmiConfig })


    const router = useRouter()


    // getTokenURI - readContract
    const {
        data: tokenURI,
        error,
        isPending,
    } = useReadContract({
        address: nftAddress,
        abi: nftAbi,
        functionName: "tokenURI",
        args: [tokenId],
    })

    // buyItem - write contract
    const { writeContract: buyItemContractFunction } = useWriteContract()



    // Helper function for fetch with timeout
    const fetchWithTimeout = async (url, timeout = 10000) => {
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), timeout)
        
        try {
            const response = await fetch(url, { signal: controller.signal })
            clearTimeout(timeoutId)
            return response
        } catch (error) {
            clearTimeout(timeoutId)
            if (error.name === 'AbortError') {
                throw new Error(`Request timeout after ${timeout}ms: ${url}`)
            }
            throw error
        }
    }

    // update ui
    async function updateUI() {
        if (tokenURI) {
            const IPFS_GATEWAY = process.env.NEXT_PUBLIC_IPFS_GATEWAY || "/ipfs/"
            const TIMEOUT_MS = parseInt(process.env.NEXT_PUBLIC_IPFS_TIMEOUT) || 10000
            
            try {
                // Handle both ipfs:// and https://ipfs.io/ipfs/ formats
                let requestURL = tokenURI
                if (tokenURI.startsWith("ipfs://")) {
                    requestURL = tokenURI.replace("ipfs://", IPFS_GATEWAY)
                } else if (tokenURI.includes("ipfs.io/ipfs/") || tokenURI.includes("gateway.ipfs.io/ipfs/")) {
                    requestURL = tokenURI
                        .replace("https://ipfs.io/ipfs/", IPFS_GATEWAY)
                        .replace("https://gateway.ipfs.io/ipfs/", IPFS_GATEWAY)
                        .replace("http://ipfs.io/ipfs/", IPFS_GATEWAY)
                        .replace("http://gateway.ipfs.io/ipfs/", IPFS_GATEWAY)
                }
                
                console.log("🔍 Fetching NFT metadata from:", requestURL)
                const response = await fetchWithTimeout(requestURL, TIMEOUT_MS)
                const tokenURIResponse = await response.json()
                const imageURI = tokenURIResponse.image
                
                // Same logic for image URI
                let imageURIURL = imageURI
                if (imageURI.startsWith("ipfs://")) {
                    imageURIURL = imageURI.replace("ipfs://", IPFS_GATEWAY)
                } else if (imageURI.includes("ipfs.io/ipfs/") || imageURI.includes("gateway.ipfs.io/ipfs/")) {
                    imageURIURL = imageURI
                        .replace("https://ipfs.io/ipfs/", IPFS_GATEWAY)
                        .replace("https://gateway.ipfs.io/ipfs/", IPFS_GATEWAY)
                        .replace("http://ipfs.io/ipfs/", IPFS_GATEWAY)
                        .replace("http://gateway.ipfs.io/ipfs/", IPFS_GATEWAY)
                }
                
                setImageURI(imageURIURL)
                setTokenName(tokenURIResponse.name)
                setTokenDescription(tokenURIResponse.description)
                setLoading(false)
            } catch (error) {
                console.error("❌ Failed to load NFT metadata:", error.message)
                // Use placeholder data when metadata fails to load
                setTokenName(`NFT #${tokenId}`)
                setTokenDescription("Metadata unavailable - NFT exists on-chain")
                setImageURI("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'%3E%3Crect fill='%23ddd' width='200' height='200'/%3E%3Ctext fill='%23999' font-family='sans-serif' font-size='14' dy='100' text-anchor='middle' x='100'%3ENFT %23" + tokenId + "%3C/tspan%3E%3Ctspan x='100' dy='20'%3EMetadata Unavailable%3C/tspan%3E%3C/text%3E%3C/svg%3E")
                setLoading(false)
            }
        }
    }





    useEffect(() => {
        if (isConnected) {
            updateUI()
        }
    }, [isConnected, isPending])

    const isOwnedByUser = seller === userAddress.toLowerCase() || seller === undefined

    const formattedSellerAddress = isOwnedByUser ? "you" : truncateStr(seller || "", 15)

    // Replace handleCardClick:
    const handleCardClick = () => {
        // Navigate to detail page
        router.push(`/nft/${nftAddress}/${tokenId}`)
    }

    const buyItemFunction = () => {
        if (!price) {
            console.log("Cannot buy - NFT not listed for sale")
            return
        }
        console.log("buyItem function clicked")
        setShowBuyModel(!showBuyModal)
    }

    const handleBuyItemSuccess = () => {
        toast.success("Item bought successfully!")
    }

    if (loading) {
        return (
            <div className="w-[280px]">
                <div 
                    className="h-[420px] flex items-center justify-center border-2 border-gray-300 bg-gray-50 rounded-lg cursor-pointer hover:shadow-md transition-shadow"
                    onClick={handleCardClick}
                >
                    <div className="text-gray-500">Loading NFT...</div>
                </div>
            </div>
        )
    }
    return (
        <div className="w-[280px]">
            <div className="h-[420px]">
                {imageURI ? (
                    <div className="h-full">
                        {/* Only show modals if there's a price */}
                        {price && (
                            <>
                                <UpdateListingModal
                                    isVisible={showModal}
                                    tokenId={tokenId}
                                    marketplaceAddress={nftMarketplaceAddress}
                                    nftAddress={nftAddress}
                                    onClose={hideModal}
                                />
                                <BuyNftModal
                                    isVisible={showBuyModal}
                                    tokenId={tokenId}
                                    marketplaceAddress={nftMarketplaceAddress}
                                    nftAddress={nftAddress}
                                    onClose={hideBuyModal}
                                    price={price}
                                />
                            </>
                        )}
                        <div 
                            className="border border-gray-200 rounded-lg shadow-md hover:shadow-xl transition-shadow cursor-pointer bg-white h-full flex flex-col"
                            onClick={handleCardClick}
                        >
                            {/* Title - Fixed height with truncation */}
                            <div className="px-4 pt-4 pb-2">
                                <h3 className="text-lg font-bold truncate" title={tokenName || "No name"}>
                                    {tokenName || <span className="text-gray-400 italic">No name</span>}
                                </h3>
                            </div>
                            
                            {/* Description - Fixed height with truncation */}
                            <div className="px-4 pb-2">
                                <p className="text-sm text-gray-600 line-clamp-2 h-10" title={tokenDescription || "No description"}>
                                    {tokenDescription || <span className="text-gray-400 italic">No description</span>}
                                </p>
                            </div>
                            
                            {/* Card content */}
                            <div className="px-4 pb-4 flex-1 flex flex-col">
                                <div className="flex flex-col gap-2">
                                    <div className="text-sm text-gray-500">#{tokenId}</div>
                                    <div className="italic text-sm text-gray-500">
                                        Owned by {formattedSellerAddress}
                                    </div>
                                    {/* Fixed size container for image */}
                                    <div className="w-full h-[200px] flex items-center justify-center bg-gray-100 rounded overflow-hidden">
                                        <Image
                                            loader={() => imageURI}
                                            src={imageURI}
                                            height="200"
                                            width="200"
                                            alt={"nft-image"}
                                            style={{ objectFit: 'cover', width: '100%', height: '100%' }}
                                        />
                                    </div>
                                    {price ? (
                                        <div className="text-base font-semibold text-blue-600 mt-2">
                                            {ethers.formatUnits(price, "ether")} ETH
                                        </div>
                                    ) : (
                                        <div className="text-gray-500 text-sm mt-2">Not for sale</div>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                ) : (
                    <div 
                        className="flex items-center justify-center h-full border border-gray-200 rounded-lg bg-gray-50 cursor-pointer"
                        onClick={handleCardClick}
                    >
                        <div className="text-gray-500">Loading...</div>
                    </div>
                )}
            </div>
        </div>
    )
}

export default NFTBox
