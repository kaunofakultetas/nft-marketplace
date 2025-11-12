"use client"
import { useQuery, gql } from "@apollo/client"
import { GET_ACTIVE_ITEM } from "@/constants/subgraphQueries"
import { useAccount } from "wagmi"
import { wagmiConfig } from "./_app"
import { ConnectButton } from "@rainbow-me/rainbowkit"
import Link from "next/link"
import NFTBox from "@/components/NFTBox"

export default function Home() {
    const { loading, error, data: listedNfts } = useQuery(GET_ACTIVE_ITEM)
    const { isConnected } = useAccount()

    return (
        <div className="container mx-auto max-w-7xl">
            <h1 className="py-4  font-bold text-2xl">NFTs For Sale</h1>
            <div className="flex flex-wrap gap-4">
                {isConnected ? (
                    loading || !listedNfts ? (
                        <div>Loading...</div>
                    ) : listedNfts.activeItems.length <= 0 ? (
                        <div className="my-10 text-xl font-semibold">
                            No NFTs Listed Yet!
                            <br />
                            <Link href="/sell-nft" className="">
                                <button
                                    type="button"
                                    className="text-white bg-sky-400 hover:bg-sky-500 focus:ring-4 focus:ring-blue-300 font-medium my-4 rounded-lg text-lg px-10 py-2.5 me-2 mb-2 dark:bg-blue-600 dark:hover:bg-blue-700 focus:outline-none dark:focus:ring-blue-800"
                                >
                                    Sell your NFT
                                </button>
                            </Link>
                        </div>
                    ) : (
                        listedNfts.activeItems.map((nft, index) => {
                            const { price, nftAddress, tokenId, seller } = nft

                            return (
                                <div key={index}>
                                    <NFTBox
                                        price={price}
                                        nftAddress={nftAddress}
                                        tokenId={tokenId}
                                        seller={seller}
                                    />
                                </div>
                            )
                        })
                    )
                ) : (
                    <div className="flex justify-center w-full  items-center h-[60vh] text-2xl font-medium">
                        Kindly Connect Eth Sepolia Network
                    </div>
                )}
            </div>
        </div>
    )
}
