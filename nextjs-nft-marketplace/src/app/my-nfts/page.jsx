"use client"
import { useState, useEffect } from "react"
import { useAccount } from "wagmi"
import { ethers } from "ethers"
import { useQuery, gql } from "@apollo/client"
import Link from "next/link"
import NFTBox from "@/components/NFTBox"

// Query to get all active listings
const GET_ACTIVE_LISTINGS = gql`
    {
        activeItems(first: 1000, where: { buyer: "0x0000000000000000000000000000000000000000" }) {
            id
            nftAddress
            tokenId
            seller
            price
        }
    }
`

export default function MyNFTs() {
    const { isConnected, address } = useAccount()
    const [myNfts, setMyNfts] = useState([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState(null)
    
    // Fetch active listings from The Graph
    const { data: listingsData } = useQuery(GET_ACTIVE_LISTINGS)

    useEffect(() => {
        if (!address) {
            setLoading(false)
            return
        }
        fetchMyNFTs()
    }, [address])

    const fetchMyNFTs = async () => {
        setLoading(true)
        setError(null)

        try {
            const ETHERSCAN_API = process.env.NEXT_PUBLIC_ETHERSCAN_API_KEY
            
            if (!ETHERSCAN_API) {
                throw new Error("Etherscan API key not configured")
            }

            console.log("🔍 Fetching NFT transfers from Etherscan V2...")

            // Etherscan V2 API - use main domain with chainid parameter
            const url = `https://api.etherscan.io/v2/api?chainid=11155111&module=account&action=tokennfttx&address=${address}&page=1&offset=10000&startblock=0&endblock=99999999&sort=asc&apikey=${ETHERSCAN_API}`
            
            console.log("🔗 Etherscan API V2 URL:", url.replace(ETHERSCAN_API, 'API_KEY_HIDDEN'))
            
            const response = await fetch(url)

            if (!response.ok) {
                throw new Error(`Etherscan API HTTP error: ${response.status}`)
            }

            const data = await response.json()
            
            console.log("📡 Etherscan API response:", data)

            if (data.status !== "1") {
                // Special case: no transactions is okay
                if (data.message === "No transactions found" || data.result === "No transactions found") {
                    console.log("ℹ️ No NFT transfers found for this address")
                    setMyNfts([])
                    setLoading(false)
                    return
                }
                
                // Show the actual error from Etherscan
                const errorMsg = data.result || data.message || "Unknown Etherscan error"
                throw new Error(`Etherscan API error: ${errorMsg}`)
            }

            console.log(`📦 Found ${data.result.length} NFT transfers`)

            // Process transfers to find current ownership
            // Key format: "contractAddress-tokenId"
            const nftOwnership = {}

            for (const tx of data.result) {
                const key = `${tx.contractAddress.toLowerCase()}-${tx.tokenID}`
                
                // If we received this NFT
                if (tx.to.toLowerCase() === address.toLowerCase()) {
                    nftOwnership[key] = {
                        contractAddress: tx.contractAddress,
                        tokenId: tx.tokenID,
                        tokenName: tx.tokenName,
                        tokenSymbol: tx.tokenSymbol,
                        owns: true
                    }
                }
                // If we sent this NFT away
                else if (tx.from.toLowerCase() === address.toLowerCase()) {
                    nftOwnership[key] = {
                        contractAddress: tx.contractAddress,
                        tokenId: tx.tokenID,
                        tokenName: tx.tokenName,
                        tokenSymbol: tx.tokenSymbol,
                        owns: false
                    }
                }
            }

            // Filter to only owned NFTs
            const ownedNfts = Object.values(nftOwnership).filter(nft => nft.owns)

            console.log(`✅ Currently own ${ownedNfts.length} NFTs`)

            // Fetch metadata for each owned NFT
            const provider = new ethers.JsonRpcProvider(process.env.NEXT_PUBLIC_RPC_URL)
            const nftsWithMetadata = []

            for (const nft of ownedNfts) {
                try {
                    const nftContract = new ethers.Contract(
                        nft.contractAddress,
                        ["function tokenURI(uint256 tokenId) view returns (string)"],
                        provider
                    )

                    const tokenURI = await nftContract.tokenURI(nft.tokenId)
                    
                    nftsWithMetadata.push({
                        nftAddress: nft.contractAddress,
                        tokenId: nft.tokenId,
                        tokenURI: tokenURI,
                        tokenName: nft.tokenName,
                        tokenSymbol: nft.tokenSymbol
                    })
                } catch (err) {
                    console.warn(`⚠️ Failed to get metadata for ${nft.contractAddress} #${nft.tokenId}:`, err.message)
                    // Still add the NFT even without metadata
                    nftsWithMetadata.push({
                        nftAddress: nft.contractAddress,
                        tokenId: nft.tokenId,
                        tokenURI: null,
                        tokenName: nft.tokenName,
                        tokenSymbol: nft.tokenSymbol
                    })
                }
            }

            setMyNfts(nftsWithMetadata)
        } catch (err) {
            console.error("❌ Error fetching NFTs:", err)
            setError(err.message)
        } finally {
            setLoading(false)
        }
    }

    if (!isConnected) {
        return (
            <div className="container mx-auto max-w-7xl">
                <div className="flex flex-col justify-center items-center h-[60vh] text-2xl font-medium">
                    <p>Please connect your wallet to view your NFTs</p>
                </div>
            </div>
        )
    }

    return (
        <div className="container mx-auto max-w-7xl px-4 py-8">
            <div className="flex justify-between items-center mb-8">
                <h1 className="text-3xl font-bold">My NFTs</h1>
            </div>

            {loading ? (
                <div className="flex flex-col justify-center items-center py-16">
                    <div className="text-xl mb-4">Loading your NFTs...</div>
                    <div className="text-sm text-gray-500">Checking Etherscan for ownership history</div>
                </div>
            ) : error ? (
                <div className="bg-red-50 border border-red-200 rounded-lg p-6">
                    <p className="text-red-800 mb-4">Error: {error}</p>
                    <button 
                        onClick={fetchMyNFTs}
                        className="bg-red-600 text-white px-4 py-2 rounded hover:bg-red-700"
                    >
                        Try Again
                    </button>
                </div>
            ) : myNfts.length === 0 ? (
                <div className="text-center py-16">
                    <p className="text-xl text-gray-600 mb-4">You don't own any NFTs yet</p>
                    <p className="text-sm text-gray-500 mb-6">
                        Start by minting or buying NFTs from the marketplace
                    </p>
                    <Link href="/">
                        <button className="bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700">
                            Browse Marketplace
                        </button>
                    </Link>
                </div>
            ) : (
                <>
                    <div className="mb-6 flex justify-between items-center">
                        <p className="text-gray-700">
                            You own <strong>{myNfts.length}</strong> NFT{myNfts.length !== 1 ? 's' : ''}
                        </p>
                        <button
                            onClick={fetchMyNFTs}
                            className="text-sm bg-gray-100 hover:bg-gray-200 px-4 py-2 rounded"
                        >
                            🔄 Refresh
                        </button>
                    </div>
                    
                    <div className="flex flex-wrap gap-4">
                        {myNfts.map((nft, index) => {
                            // Check if this NFT is listed on the marketplace
                            const listing = listingsData?.activeItems?.find(
                                item => 
                                    item.nftAddress.toLowerCase() === nft.nftAddress.toLowerCase() &&
                                    item.tokenId === nft.tokenId
                            )
                            
                            return (
                                <NFTBox
                                    key={`${nft.nftAddress}-${nft.tokenId}`}
                                    nftAddress={nft.nftAddress}
                                    tokenId={nft.tokenId}
                                    tokenURI={nft.tokenURI}
                                    price={listing?.price}
                                    seller={listing?.seller}
                                />
                            )
                        })}
                    </div>
                </>
            )}

            <div className="mt-8">
                <Link href="/" className="text-blue-600 hover:text-blue-800 font-medium">
                    ← Back to Marketplace
                </Link>
            </div>
        </div>
    )
}