"use client"
import "@rainbow-me/rainbowkit/styles.css"
import { getDefaultConfig, getDefaultWallets, RainbowKitProvider } from "@rainbow-me/rainbowkit"
import { WagmiProvider, http, createConfig } from "wagmi"
import { mainnet, sepolia, polygon, optimism, arbitrum, base } from "wagmi/chains"
import { QueryClientProvider, QueryClient } from "@tanstack/react-query"
import { ApolloProvider, ApolloClient, InMemoryCache } from "@apollo/client"
import { injected, metaMask } from "wagmi/connectors"

const projectId = process.env.NEXT_PUBLIC_PROJECT_ID || ""

export const wagmiConfig = getDefaultConfig({
    appName: "Nft Marketplace",
    projectId: projectId,
    chains: [sepolia],
    transports: {
        [sepolia.id]: http(process.env.NEXT_PUBLIC_RPC_URL),
    },
    ssr: true,
    connectors: [injected()],
})

const client = new ApolloClient({
    cache: new InMemoryCache(),
    uri: process.env.NEXT_PUBLIC_GRAPH_URL || "/subgraphs/name/nftmarketplace",
})

const queryClient = new QueryClient()

export default function Provider({ children }) {
    return (
        <WagmiProvider config={wagmiConfig}>
            <QueryClientProvider client={queryClient}>
                <RainbowKitProvider>
                    <ApolloProvider client={client}>
                        {children}
                    </ApolloProvider>
                </RainbowKitProvider>
            </QueryClientProvider>
        </WagmiProvider>
    )
}
