"use client"
import { useQuery } from "@apollo/client"
import { GET_ALL_LISTED, GET_ALL_BOUGHT, GET_ALL_CANCELED } from "@/constants/subgraphQueries"
import { useAccount } from "wagmi"
import { ethers } from "ethers"
import Link from "next/link"

export default function History() {
    const { isConnected } = useAccount()
    const { loading: loadingListed, data: listedData } = useQuery(GET_ALL_LISTED)
    const { loading: loadingBought, data: boughtData } = useQuery(GET_ALL_BOUGHT)
    const { loading: loadingCanceled, data: canceledData } = useQuery(GET_ALL_CANCELED)

    const truncateAddress = (address) => {
        if (!address) return ""
        return `${address.slice(0, 6)}...${address.slice(-4)}`
    }

    if (!isConnected) {
        return (
            <div className="container mx-auto max-w-7xl">
                <div className="flex flex-col justify-center items-center h-[60vh] text-2xl font-medium">
                    <p>Please connect your wallet to view marketplace history</p>
                </div>
            </div>
        )
    }

    return (
        <div className="container mx-auto max-w-7xl px-4 py-8">
            <h1 className="text-3xl font-bold mb-8">Marketplace History</h1>

            {/* Recently Listed Section */}
            <section className="mb-12">
                <h2 className="text-2xl font-semibold mb-4 flex items-center">
                    📝 Recently Listed
                </h2>
                {loadingListed ? (
                    <div className="text-gray-500">Loading...</div>
                ) : listedData?.itemListeds?.length > 0 ? (
                    <div className="bg-white rounded-lg shadow overflow-hidden">
                        <table className="min-w-full divide-y divide-gray-200">
                            <thead className="bg-gray-50">
                                <tr>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                        NFT
                                    </th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                        Token ID
                                    </th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                        Price
                                    </th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                        Seller
                                    </th>
                                </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-gray-200">
                                {listedData.itemListeds.map((item, index) => (
                                    <tr key={index} className="hover:bg-gray-50">
                                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                                            {item.nftAddress}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                            #{item.tokenId}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 font-semibold">
                                            {ethers.formatUnits(item.price, "ether")} ETH
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                            {item.seller}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                ) : (
                    <div className="text-gray-500 bg-gray-50 p-6 rounded-lg">
                        No listings found
                    </div>
                )}
            </section>

            {/* Recently Sold Section */}
            <section className="mb-12">
                <h2 className="text-2xl font-semibold mb-4 flex items-center">
                    ✅ Recently Sold
                </h2>
                {loadingBought ? (
                    <div className="text-gray-500">Loading...</div>
                ) : boughtData?.itemBoughts?.length > 0 ? (
                    <div className="bg-white rounded-lg shadow overflow-hidden">
                        <table className="min-w-full divide-y divide-gray-200">
                            <thead className="bg-gray-50">
                                <tr>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                        NFT
                                    </th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                        Token ID
                                    </th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                        Buyer
                                    </th>
                                </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-gray-200">
                                {boughtData.itemBoughts.map((item, index) => (
                                    <tr key={index} className="hover:bg-gray-50">
                                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                                            {item.nftAddress}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                            #{item.tokenId}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                            {item.buyer}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                ) : (
                    <div className="text-gray-500 bg-gray-50 p-6 rounded-lg">
                        No sales found
                    </div>
                )}
            </section>

            {/* Canceled Listings Section */}
            <section className="mb-12">
                <h2 className="text-2xl font-semibold mb-4 flex items-center">
                    ❌ Canceled Listings
                </h2>
                {loadingCanceled ? (
                    <div className="text-gray-500">Loading...</div>
                ) : canceledData?.itemCanceleds?.length > 0 ? (
                    <div className="bg-white rounded-lg shadow overflow-hidden">
                        <table className="min-w-full divide-y divide-gray-200">
                            <thead className="bg-gray-50">
                                <tr>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                        NFT
                                    </th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                        Token ID
                                    </th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                        Seller
                                    </th>
                                </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-gray-200">
                                {canceledData.itemCanceleds.map((item, index) => (
                                    <tr key={index} className="hover:bg-gray-50">
                                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                                            {item.nftAddress}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                            #{item.tokenId}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                            {item.seller}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                ) : (
                    <div className="text-gray-500 bg-gray-50 p-6 rounded-lg">
                        No canceled listings found
                    </div>
                )}
            </section>

            {/* Back to Home Link */}
            <div className="mt-8">
                <Link href="/" className="text-blue-600 hover:text-blue-800 font-medium">
                    ← Back to Marketplace
                </Link>
            </div>
        </div>
    )
}

