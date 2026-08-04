// -----------------------------------------------------------
//  [*] App — page shell and routing
//
//  The root of the React app: the toast outlet and the fixed
//  shell — Header on top, the routed page on the grey
//  canvas, Footer pinned to the bottom by the flex column.
//  Routes:
//    - /                        — NFTs currently for sale
//    - /my-nfts                 — the connected wallet's NFTs
//    - /sell-nft                — approve + list form, proceeds
//    - /history                 — the marketplace activity feed
//    - /about                   — this instance, technically
//    - /nft/:nftAddress/:tokenId — single NFT detail + actions
//
//  Every page requires a connected wallet and renders its own
//  "connect first" placeholder when there is none.
//
//  Used by:
//    - main.jsx — mounted into #root inside the provider stack
// -----------------------------------------------------------

import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';

import Header from '@/components/Header';
import Footer from '@/components/Footer';

// Pages
import HomePage from '@/pages/Home/Page';
import MyNftsPage from '@/pages/MyNfts/Page';
import SellNftPage from '@/pages/SellNft/Page';
import HistoryPage from '@/pages/History/Page';
import NftDetailPage from '@/pages/NftDetail/Page';
import AboutPage from '@/pages/About/Page';







// -----------------------------------------------------------
// App (default export)
// -----------------------------------------------------------
//
// Used by:
//   - main.jsx — mounted into #root inside the provider stack
// -----------------------------------------------------------

export default function App() {
  return (
    <Router>

      {/* Toasts live above the router so every page shares the
          same outlet; errors linger longer than successes */}
      <Toaster
        position="top-center"
        toastOptions={{
          duration: 10000,
          style: {
            background: '#363636',
            color: '#fff',
            maxWidth: '380px',
            wordBreak: 'break-word',
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

      <div className="flex flex-col min-h-screen bg-gray-100">
        <Header />

        <main className="flex-1">
          <Routes>
            <Route index element={<HomePage />} />
            <Route path="my-nfts" element={<MyNftsPage />} />
            <Route path="sell-nft" element={<SellNftPage />} />
            <Route path="history" element={<HistoryPage />} />
            <Route path="about" element={<AboutPage />} />
            <Route path="nft/:nftAddress/:tokenId" element={<NftDetailPage />} />
          </Routes>
        </main>

        <Footer />
      </div>

    </Router>
  );
}
