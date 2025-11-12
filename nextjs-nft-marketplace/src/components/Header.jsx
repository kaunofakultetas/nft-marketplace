"use client"
import React, { useEffect } from "react"
import Link from "next/link"
import { ConnectButton } from "@rainbow-me/rainbowkit"
import { useAccount } from "wagmi"

const Header = () => {
    const { isConnected } = useAccount()

    // useEffect(() => {}, [isConnected])
    return (
        <nav className="px-10 p-2 border-b-2 flex flex-row justify-between items bg-[#78003F]">
            {/* Logo links back to root */}
            <Link href="/" className="flex flex-row items-center">
                <img src="/img/logo_knf.png" alt="NFT Marketplace"className="h-[60px]"/>
                <h1 className="py-4 px-4 font-bold text-3xl text-white">NFT Marketplace</h1>
            </Link>
            
            <div className="flex flex-row items-center">
                <Link href="/">
                    <div className="mr-4 px-6 py-3 text-white hover:bg-white hover:text-[#78003F] rounded-full transition-all duration-300 cursor-pointer font-semibold">
                        Home
                    </div>
                </Link>
                <Link href="/my-nfts">
                    <div className="mr-4 px-6 py-3 text-white hover:bg-white hover:text-[#78003F] rounded-full transition-all duration-300 cursor-pointer font-semibold">
                        My NFTs
                    </div>
                </Link>
                <Link href="/sell-nft">
                    <div className="mr-4 px-6 py-3 text-white hover:bg-white hover:text-[#78003F] rounded-full transition-all duration-300 cursor-pointer font-semibold">
                        Sell NFT
                    </div>
                </Link>
                <Link href="/history">
                    <div className="mr-4 px-6 py-3 text-white hover:bg-white hover:text-[#78003F] rounded-full transition-all duration-300 cursor-pointer font-semibold">
                        History
                    </div>
                </Link>
                <ConnectButton label="Connect" />
            </div>
        </nav>
    )
}

export default Header
