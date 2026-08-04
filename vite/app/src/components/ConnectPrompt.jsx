// -----------------------------------------------------------
//  [*] ConnectPrompt — the shared "connect your wallet" gate
//
//  Every data page renders this instead of its content while
//  no wallet is connected: one centered white card with the
//  faculty logo, the page-specific message and the RainbowKit
//  Connect button — so the user can act right where they are
//  told to. One component = one voice across the app.
// -----------------------------------------------------------

import ConnectButton from '@/components/ConnectButton';







// -----------------------------------------------------------
// ConnectPrompt (default export)
// -----------------------------------------------------------
//
// Used by:
//   - pages/Home, pages/MyNfts, pages/History, pages/SellNft
// -----------------------------------------------------------

export default function ConnectPrompt({ message }) {
  return (
    <div className="flex justify-center items-center min-h-[65vh] px-4">
      <div className="bg-white border border-gray-200 rounded-xl shadow-sm px-10 py-12 text-center flex flex-col items-center gap-5 max-w-md w-full">
        <img src="/img/logo_knf.png" alt="" className="h-14" />
        <div className="text-xl font-semibold text-gray-800">{message}</div>
        <ConnectButton />
      </div>
    </div>
  );
}
