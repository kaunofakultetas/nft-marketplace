"use client"
import { useState, useEffect } from "react"
import { useParams, useRouter } from "next/navigation"
import { useAccount } from "wagmi"
import { ethers } from "ethers"
import { useQuery } from "@apollo/client"
import { gql } from "@apollo/client"
import Image from "next/image"
import Link from "next/link"
import UpdateListingModal from "@/components/UpdateListingModal"
import BuyNftModal from "@/components/BuyNftModal"

// GraphQL query for this specific NFT's history
const GET_NFT_HISTORY = gql`
    query GetNftHistory($nftAddress: String!, $tokenId: String!) {
        activeItems(where: { nftAddress: $nftAddress, tokenId: $tokenId }) {
            id
            seller
            buyer
            price
        }
        itemListeds(where: { nftAddress: $nftAddress, tokenId: $tokenId }, orderBy: tokenId) {
            id
            seller
            price
        }
        itemBoughts(where: { nftAddress: $nftAddress, tokenId: $tokenId }, orderBy: tokenId) {
            id
            buyer
            price
        }
        itemCanceleds(where: { nftAddress: $nftAddress, tokenId: $tokenId }, orderBy: tokenId) {
            id
            seller
        }
    }
`

export default function NFTDetailPage() {
    const params = useParams()
    const router = useRouter()
    const { address: userAddress, isConnected } = useAccount()
    
    const nftAddress = params.nftAddress
    const tokenId = params.tokenId

    const [metadata, setMetadata] = useState(null)
    const [metadataURL, setMetadataURL] = useState(null)
    const [currentOwner, setCurrentOwner] = useState(null)
    const [loading, setLoading] = useState(true)
    const [showUpdateModal, setShowUpdateModal] = useState(false)
    const [showBuyModal, setShowBuyModal] = useState(false)

    const { data: historyData, loading: historyLoading } = useQuery(GET_NFT_HISTORY, {
        variables: {
            nftAddress: nftAddress?.toLowerCase(),
            tokenId: tokenId
        }
    })

    useEffect(() => {
        if (nftAddress && tokenId) {
            fetchNFTData()
        }
    }, [nftAddress, tokenId])

    const fetchNFTData = async () => {
        setLoading(true)
        try {
            const provider = new ethers.JsonRpcProvider(process.env.NEXT_PUBLIC_RPC_URL)
            const nftContract = new ethers.Contract(
                nftAddress,
                [
                    "function ownerOf(uint256 tokenId) view returns (address)",
                    "function tokenURI(uint256 tokenId) view returns (string)"
                ],
                provider
            )

            // Get current owner
            const owner = await nftContract.ownerOf(tokenId)
            setCurrentOwner(owner)

            // Get metadata
            const tokenURI = await nftContract.tokenURI(tokenId)
            
            // Fetch metadata JSON with timeout
            const IPFS_GATEWAY = process.env.NEXT_PUBLIC_IPFS_GATEWAY || "/ipfs/"
            const TIMEOUT_MS = parseInt(process.env.NEXT_PUBLIC_IPFS_TIMEOUT) || 10000
            
            let metadataURL = tokenURI
            if (tokenURI.startsWith("ipfs://")) {
                metadataURL = tokenURI.replace("ipfs://", IPFS_GATEWAY)
            } else if (tokenURI.includes("ipfs.io/ipfs/") || tokenURI.includes("gateway.ipfs.io/ipfs/")) {
                // Replace external gateway with local one
                metadataURL = tokenURI
                    .replace("https://ipfs.io/ipfs/", IPFS_GATEWAY)
                    .replace("https://gateway.ipfs.io/ipfs/", IPFS_GATEWAY)
                    .replace("http://ipfs.io/ipfs/", IPFS_GATEWAY)
                    .replace("http://gateway.ipfs.io/ipfs/", IPFS_GATEWAY)
            }

            console.log("🔍 Fetching NFT metadata from:", metadataURL)
            
            // Store the metadata URL for display
            setMetadataURL(metadataURL)
            
            const controller = new AbortController()
            const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS)
            
            const response = await fetch(metadataURL, { signal: controller.signal })
            clearTimeout(timeoutId)
            const metadataJson = await response.json()
            
            // Handle image URL
            let imageURL = metadataJson.image
            if (imageURL?.startsWith("ipfs://")) {
                imageURL = imageURL.replace("ipfs://", IPFS_GATEWAY)
            } else if (imageURL?.includes("ipfs.io/ipfs/") || imageURL?.includes("gateway.ipfs.io/ipfs/")) {
                imageURL = imageURL
                    .replace("https://ipfs.io/ipfs/", IPFS_GATEWAY)
                    .replace("https://gateway.ipfs.io/ipfs/", IPFS_GATEWAY)
                    .replace("http://ipfs.io/ipfs/", IPFS_GATEWAY)
                    .replace("http://gateway.ipfs.io/ipfs/", IPFS_GATEWAY)
            }
            
            console.log("✅ NFT metadata loaded, image URL:", imageURL)
            console.log("📦 Full metadata:", metadataJson)
            
            setMetadata({
                ...metadataJson,
                image: imageURL
            })
        } catch (error) {
            console.error("❌ Error fetching NFT data:", error)
            // Set placeholder data on error
            setMetadata({
                name: `NFT #${tokenId}`,
                description: "Metadata unavailable",
                image: null
            })
        } finally {
            setLoading(false)
        }
    }

    const truncateAddress = (addr) => {
        if (!addr) return ""
        return `${addr.slice(0, 6)}...${addr.slice(-4)}`
    }

    const isOwner = currentOwner?.toLowerCase() === userAddress?.toLowerCase()
    const activeItem = historyData?.activeItems?.[0]
    const isListed = activeItem && activeItem.buyer === "0x0000000000000000000000000000000000000000"
    const currentPrice = isListed ? activeItem.price : null

    if (loading || historyLoading) {
        return (
            <div className="container mx-auto max-w-7xl px-4 py-8">
                <div className="text-center py-16">Loading NFT details...</div>
            </div>
        )
    }

    // Debug logging
    console.log("🎨 Rendering NFT detail page with metadata:", metadata)
    console.log("🖼️ Image URL:", metadata?.image)

    return (
        <div className="container mx-auto max-w-7xl px-4 py-8">
            {/* Back button */}
            <Link href="/" className="text-blue-600 hover:text-blue-800 mb-6 inline-block">
                ← Back to Marketplace
            </Link>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mt-6">
                {/* Left: Image */}
                <div className="bg-white rounded-lg shadow-lg p-6">
                    <div className="relative w-full aspect-square">
                        {metadata?.image ? (
                            <Image
                                loader={() => metadata.image}
                                src={metadata.image}
                                alt={metadata.name || "NFT"}
                                fill
                                className="object-contain rounded-lg"
                                onError={(e) => {
                                    console.error("❌ Image failed to load:", metadata.image)
                                    e.target.style.display = 'none'
                                }}
                            />
                        ) : (
                            <div className="w-full h-full bg-gray-200 rounded-lg flex items-center justify-center">
                                <div className="text-center text-gray-500">
                                    <div className="text-6xl mb-2">🖼️</div>
                                    <div className="text-sm">NFT #{tokenId}</div>
                                    <div className="text-xs">Image unavailable</div>
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                {/* Right: Details */}
                <div className="space-y-6">
                    {/* NFT Info */}
                    <div className="bg-white rounded-lg shadow-lg p-6">
                        <h1 className="text-3xl font-bold mb-2">
                            {metadata?.name || `NFT #${tokenId}`}
                        </h1>
                        <p className="text-gray-600 mb-4">
                            {metadata?.description || "No description"}
                        </p>

                        <div className="space-y-2 text-sm">
                            <div className="flex justify-between">
                                <span className="text-gray-600">Contract Address:</span>
                                <span className="font-mono">{nftAddress}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-gray-600">Token ID:</span>
                                <span className="font-mono">#{tokenId}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-gray-600">Current Owner:</span>
                                <span className="font-mono">
                                    {isOwner ? "You" : currentOwner}
                                </span>
                            </div>
                            {metadataURL && (
                                <div className="flex justify-between">
                                    <span className="text-gray-600">Metadata:</span>
                                    <a 
                                        href={metadataURL} 
                                        target="_blank" 
                                        rel="noopener noreferrer"
                                        className="text-blue-600 hover:text-blue-800 underline font-mono text-sm break-all"
                                    >
                                        View JSON →
                                    </a>
                                </div>
                            )}
                            {isListed && currentPrice && (
                                <div className="flex justify-between text-lg font-bold pt-2 border-t">
                                    <span>Current Price:</span>
                                    <span className="text-blue-600">
                                        {ethers.formatUnits(currentPrice, "ether")} ETH
                                    </span>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Actions */}
                    {isConnected && (
                        <div className="bg-white rounded-lg shadow-lg p-6">
                            <h3 className="text-xl font-bold mb-4">Actions</h3>
                            
                            {isOwner ? (
                                <div className="space-y-3">
                                    {isListed ? (
                                        <>
                                            <p className="text-sm text-gray-600 mb-4">
                                                Your NFT is currently listed for sale
                                            </p>
                                            <button
                                                onClick={() => setShowUpdateModal(true)}
                                                className="w-full bg-blue-600 text-white py-3 px-6 rounded-lg hover:bg-blue-700 font-semibold"
                                            >
                                                Update Listing / Cancel
                                            </button>
                                        </>
                                    ) : (
                                        <>
                                            <p className="text-sm text-gray-600 mb-4">
                                                You own this NFT
                                            </p>
                                            <Link href={`/sell-nft?nftAddress=${nftAddress}&tokenId=${tokenId}`}>
                                                <button className="w-full bg-green-600 text-white py-3 px-6 rounded-lg hover:bg-green-700 font-semibold">
                                                    List for Sale
                                                </button>
                                            </Link>
                                        </>
                                    )}
                                </div>
                            ) : isListed && currentPrice ? (
                                <button
                                    onClick={() => setShowBuyModal(true)}
                                    className="w-full bg-blue-600 text-white py-3 px-6 rounded-lg hover:bg-blue-700 font-semibold"
                                >
                                    Buy Now for {ethers.formatUnits(currentPrice, "ether")} ETH
                                </button>
                            ) : (
                                <p className="text-gray-600">This NFT is not currently for sale</p>
                            )}
                        </div>
                    )}

                    {/* Sale History */}
                    <div className="bg-white rounded-lg shadow-lg p-6">
                        <h3 className="text-xl font-bold mb-4">Transaction History</h3>
                        
                        {historyData?.itemBoughts?.length > 0 ? (
                            <div className="space-y-3">
                                <h4 className="font-semibold text-gray-700">Sales</h4>
                                {historyData.itemBoughts.map((sale, index) => (
                                    <div key={index} className="border-l-4 border-green-500 pl-4 py-2">
                                        <div className="text-sm">
                                            <span className="text-green-600 font-semibold">Sold</span> to{" "}
                                            {truncateAddress(sale.buyer)}
                                        </div>
                                        {sale.price && (
                                            <div className="text-sm text-gray-600">
                                                Price: {ethers.formatUnits(sale.price, "ether")} ETH
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        ) : null}

                        {historyData?.itemListeds?.length > 0 ? (
                            <div className="space-y-3 mt-4">
                                <h4 className="font-semibold text-gray-700">Listings</h4>
                                {historyData.itemListeds.map((listing, index) => (
                                    <div key={index} className="border-l-4 border-blue-500 pl-4 py-2">
                                        <div className="text-sm">
                                            <span className="text-blue-600 font-semibold">Listed</span> by{" "}
                                            {truncateAddress(listing.seller)}
                                        </div>
                                        {listing.price && (
                                            <div className="text-sm text-gray-600">
                                                Price: {ethers.formatUnits(listing.price, "ether")} ETH
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        ) : null}

                        {historyData?.itemCanceleds?.length > 0 ? (
                            <div className="space-y-3 mt-4">
                                <h4 className="font-semibold text-gray-700">Cancellations</h4>
                                {historyData.itemCanceleds.map((cancel, index) => (
                                    <div key={index} className="border-l-4 border-gray-400 pl-4 py-2">
                                        <div className="text-sm">
                                            <span className="text-gray-600 font-semibold">Cancelled</span> by{" "}
                                            {truncateAddress(cancel.seller)}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : null}

                        {!historyData?.itemBoughts?.length && 
                         !historyData?.itemListeds?.length && 
                         !historyData?.itemCanceleds?.length && (
                            <p className="text-gray-500 text-sm">No transaction history yet</p>
                        )}
                    </div>

                    {/* Metadata Attributes */}
                    {metadata?.attributes && metadata.attributes.length > 0 && (
                        <div className="bg-white rounded-lg shadow-lg p-6">
                            <h3 className="text-xl font-bold mb-4">Attributes</h3>
                            <div className="grid grid-cols-2 gap-3">
                                {metadata.attributes.map((attr, index) => (
                                    <div key={index} className="bg-gray-50 rounded p-3">
                                        <div className="text-xs text-gray-600 uppercase">{attr.trait_type}</div>
                                        <div className="font-semibold">{attr.value}</div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Modals */}
            {isListed && (
                <>
                    <UpdateListingModal
                        isVisible={showUpdateModal}
                        tokenId={tokenId}
                        marketplaceAddress={process.env.NEXT_PUBLIC_NFT_MARKETPLACE_ADDRESS}
                        nftAddress={nftAddress}
                        onClose={() => setShowUpdateModal(false)}
                    />
                    <BuyNftModal
                        isVisible={showBuyModal}
                        tokenId={tokenId}
                        marketplaceAddress={process.env.NEXT_PUBLIC_NFT_MARKETPLACE_ADDRESS}
                        nftAddress={nftAddress}
                        onClose={() => setShowBuyModal(false)}
                        price={currentPrice}
                    />
                </>
            )}
        </div>
    )
}