// -----------------------------------------------------------
//  [*] Header — the burgundy top bar
//
//  Sticky on every page: KNF logo + wordmark linking back to
//  "/", the five nav links and RainbowKit's Connect button.
//  The current page's pill stays filled white — NavLink's
//  isActive drives it, with `end` on "/" so Home doesn't
//  claim every route.
//
//  Split into (root component last):
//
//    NavItem — one white-pill nav link (active = filled)
//    Header  — the bar itself (default export)
// -----------------------------------------------------------

import { Link, NavLink } from 'react-router-dom';
import ConnectButton from '@/components/ConnectButton';







// -----------------------------------------------------------
// NavItem
// -----------------------------------------------------------
//
// Used by:
//   - Header (below)
// -----------------------------------------------------------

function NavItem({ to, children }) {
  return (
    <NavLink
      to={to}
      end={to === '/'}
      className={({ isActive }) =>
        'px-4 py-2 rounded-full text-sm font-semibold transition-colors ' +
        (isActive
          ? 'bg-white text-[var(--color-primary)]'
          : 'text-white/90 hover:bg-white/15 hover:text-white')
      }
    >
      {children}
    </NavLink>
  );
}







// -----------------------------------------------------------
// Header (default export)
// -----------------------------------------------------------
//
// Used by:
//   - App.jsx — rendered above the routed page
// -----------------------------------------------------------

export default function Header() {
  return (
    <nav className="sticky top-0 z-40 px-6 py-2.5 flex flex-row flex-wrap gap-y-2 justify-between items-center bg-[var(--color-primary)] shadow-md">

      {/* Wordmark links back to root */}
      <Link to="/" className="flex flex-row items-center gap-3">
        <img src="/img/logo_knf.png" alt="" className="h-10" />
        <h1 className="font-bold text-xl text-white tracking-tight">NFT Marketplace</h1>
      </Link>

      <div className="flex flex-row flex-wrap items-center gap-1.5">
        <NavItem to="/">Home</NavItem>
        <NavItem to="/my-nfts">My NFTs</NavItem>
        <NavItem to="/sell-nft">Sell NFT</NavItem>
        <NavItem to="/history">Activity</NavItem>
        <NavItem to="/about">About</NavItem>
        <span className="ml-2">
          <ConnectButton />
        </span>
      </div>

    </nav>
  );
}
