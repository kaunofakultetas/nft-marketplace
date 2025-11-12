import { Inter } from "next/font/google"
import "./globals.css"
import Header from "@/components/Header"
import Provider from "./_app"
import { Toaster } from "react-hot-toast"

const inter = Inter({ subsets: ["latin"] })

export const metadata = {
    title: "NFT Marketplace",
    description: "NFT Marketplace",
}

export default function RootLayout({ children }) {
    return (
        <html lang="en">
            <body className={inter.className}>
                <Provider>
                    <Toaster 
                        position="bottom-left"
                        toastOptions={{
                            duration: 10000,
                            style: {
                                background: '#363636',
                                color: '#fff',
                            },
                            success: {
                                duration: 10000,
                                iconTheme: {
                                    primary: 'green',
                                    secondary: 'white',
                                },
                            },
                            error: {
                                duration: 15000,
                                iconTheme: {
                                    primary: 'red',
                                    secondary: 'white',
                                },
                            },
                        }}
                    />
                    <Header />
                    {children}
                </Provider>
            </body>
        </html>
    )
}
