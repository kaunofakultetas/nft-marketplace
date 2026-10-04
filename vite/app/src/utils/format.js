// -----------------------------------------------------------
//  [*] Formatting helpers — addresses, amounts, links, dates
//
//  Shared display transforms: addresses shown short
//  everywhere (full 42-char addresses blow up table rows and
//  card lines, the full value rides the title tooltip), wei
//  amounts as ether, and the Sepolia Etherscan links the GUI
//  scatters around on purpose — every address and
//  transaction is one click from the raw chain data.
//
//  Every transform takes what a backend answer or a chain
//  read hands it, malformed values included: it never throws
//  while a page renders — a value it cannot read comes back
//  empty, for the page to say so.
// -----------------------------------------------------------

import { formatUnits } from 'ethers';


// Sepolia's Etherscan — where every address and transaction
// link of the GUI points
const ETHERSCAN_URL = 'https://sepolia.etherscan.io';







// -----------------------------------------------------------
// truncateAddress
// -----------------------------------------------------------
//
// "0x123456...abcd" — keeps both checksum-recognizable ends.
// Anything that is no text (a missing address, a number in a
// malformed answer) comes back empty.
//
// Used by:
//   - components/ConnectButton — the connected account
//   - components/NFTBox — the "Owned by" line
//   - pages/SellNft — the picker's chips
//   - pages/History — every address cell
//   - pages/NftDetail — the contract and owner rows
// -----------------------------------------------------------

export function truncateAddress(address) {
  if (typeof address !== 'string' || !address) return '';
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}







// -----------------------------------------------------------
// parseWei
// -----------------------------------------------------------
//
// A wei amount as a bigint — the backend hands amounts over as
// decimal strings (uint256 overflows a JSON number), the chain
// as bigints — or null for anything that is no whole,
// non-negative number of wei: a malformed answer must not
// crash the page that reads it.
//
// Used by:
//   - formatEth (below)
//   - pages/Home — the price sorters
//   - pages/NftDetail — the balance check before a purchase
// -----------------------------------------------------------

export function parseWei(value) {
  if (typeof value === 'bigint') return value >= 0n ? value : null;
  if (typeof value === 'number') return Number.isInteger(value) && value >= 0 ? BigInt(value) : null;
  if (typeof value === 'string' && /^\d+$/.test(value)) return BigInt(value);
  return null;
}







// -----------------------------------------------------------
// formatEth
// -----------------------------------------------------------
//
// A wei amount as the ether figure the GUI prints before
// "ETH" — ethers' own rendering, so one ether reads "1.0" —
// or null when the amount cannot be read (see parseWei). The
// caller says what an unreadable amount means where it shows
// one.
//
// Used by:
//   - components/NFTBox, components/BuyNftModal — prices
//   - pages/Home — the stats bar
//   - pages/History — the price column
//   - pages/About — the lifetime volume
//   - pages/SellNft — the proceeds card
//   - pages/NftDetail — price, Buy button, balance, history
// -----------------------------------------------------------

export function formatEth(value) {
  const wei = parseWei(value);
  return wei === null ? null : formatUnits(wei, 'ether');
}







// -----------------------------------------------------------
// etherscanAddressUrl
// -----------------------------------------------------------
//
// An address's page on Sepolia's Etherscan — a contract and
// a wallet alike, one click from its raw chain data.
//
// Used by:
//   - pages/Home — the contract link under the stats bar
//   - pages/About — the marketplace contract fact
//   - pages/NftDetail — the contract and owner links, the
//     history stripes' actors
// -----------------------------------------------------------

export function etherscanAddressUrl(address) {
  return `${ETHERSCAN_URL}/address/${address}`;
}







// -----------------------------------------------------------
// etherscanTxUrl
// -----------------------------------------------------------
//
// A transaction's page on Sepolia's Etherscan — the on-chain
// receipt of an event the GUI shows.
//
// Used by:
//   - pages/History — the Tx column
//   - pages/NftDetail — every history stripe's receipt
// -----------------------------------------------------------

export function etherscanTxUrl(txHash) {
  return `${ETHERSCAN_URL}/tx/${txHash}`;
}







// -----------------------------------------------------------
// formatDateTime
// -----------------------------------------------------------
//
// A block's unix time as "YYYY-MM-DD HH:MM:SS" in the
// viewer's local timezone — THE one date format of this GUI,
// everywhere a timestamp is shown.
//
// Used by:
//   - pages/History — the Time column
//   - pages/NftDetail — the history timeline
//   - pages/Home — the indexer freshness line
//   - pages/About — the deployment row
// -----------------------------------------------------------

export function formatDateTime(unixSeconds) {
  if (!unixSeconds) return '';
  const date = new Date(unixSeconds * 1000);
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}







// -----------------------------------------------------------
// formatWalletError
// -----------------------------------------------------------
//
// Wallet/RPC errors arrive as MULTI-HUNDRED-character dumps
// (request args, hex calldata, library versions) — this
// boils one down to the toast-sized human part: viem's
// shortMessage when present, the first line otherwise,
// capped at 140 chars. A first line that ends in a colon
// announces the line after it — viem words a revert that
// gives its reason that way — so the two travel together.
// A user clicking "Reject" in the wallet gets a friendly
// sentence, not an error dump. The full error always stays
// in the browser console (the call sites console.log it
// before toasting).
//
// Used by:
//   - pages/SellNft — approve / list / withdraw failures
//   - components/BuyNftModal — buy failures
//   - components/UpdateListingModal — update / cancel failures
// -----------------------------------------------------------

export function formatWalletError(error, fallback) {
  if (!error) return fallback;

  const text = error.shortMessage || error.message || fallback;
  if (error.code === 4001 || /user (rejected|denied)/i.test(text)) {
    return 'Transaction rejected in the wallet.';
  }

  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
  const sentence = lines[0]?.endsWith(':') && lines[1] ? `${lines[0]} ${lines[1]}` : (lines[0] || fallback);
  return sentence.length > 140 ? `${sentence.slice(0, 140)}…` : sentence;
}
