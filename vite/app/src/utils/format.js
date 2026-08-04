// -----------------------------------------------------------
//  [*] Formatting helpers
//
//  Shared display transforms: addresses shown short
//  everywhere (full 42-char addresses blow up table rows and
//  card lines, the full value rides the title tooltip), and
//  the Sepolia Etherscan links the GUI scatters around on
//  purpose — every address and transaction is one click from
//  the raw chain data.
// -----------------------------------------------------------







// -----------------------------------------------------------
// truncateAddress
// -----------------------------------------------------------
//
// "0x123456...abcd" — keeps both checksum-recognizable ends.
//
// Used by:
//   - components/NFTBox — the "Owned by" line
//   - pages/History — every address cell
//   - pages/NftDetail — the history stripes
// -----------------------------------------------------------

export function truncateAddress(address) {
  if (!address) return '';
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}







// -----------------------------------------------------------
// etherscanAddressUrl / etherscanTxUrl
// -----------------------------------------------------------
//
// Used by:
//   - pages/Home — the contract link under the stats bar
//   - pages/History — the Tx column
//   - pages/NftDetail — contract/owner links, history stripes
// -----------------------------------------------------------

const ETHERSCAN_URL = 'https://sepolia.etherscan.io';

export function etherscanAddressUrl(address) {
  return `${ETHERSCAN_URL}/address/${address}`;
}

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
// capped at 140 chars. A user clicking "Reject" in the
// wallet gets a friendly sentence, not an error dump. The
// full error always stays in the browser console (the call
// sites console.log it before toasting).
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

  const firstLine = text.split('\n')[0].trim();
  return firstLine.length > 140 ? `${firstLine.slice(0, 140)}…` : firstLine;
}
