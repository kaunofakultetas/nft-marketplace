// -----------------------------------------------------------
//  [*] Contract ABIs — how the app speaks to the contracts
//
//  The two ABI JSONs were exported by the original Hardhat
//  deployment of the contracts. The marketplace ADDRESS is
//  not here — it comes from the backend at runtime
//  (getConfig().nftMarketplaceAddress, see config.js); a
//  collection's address is whatever the student's token
//  lives at.
// -----------------------------------------------------------

import nftAbi from './BasicNft.json';
import nftMarketplaceAbi from './NftMarketplace.json';







// -----------------------------------------------------------
// nftAbi
// -----------------------------------------------------------
//
// The ERC-721 collection's interface — the standard's own
// tokenURI, ownerOf and approve are all the app calls on it,
// so any student's collection answers it.
//
// Used by:
//   - hooks/useNftMetadata — tokenURI reads
//   - pages/NftDetail — the owner read
//   - pages/SellNft — the approval before a listing
// -----------------------------------------------------------

export { nftAbi };







// -----------------------------------------------------------
// nftMarketplaceAbi
// -----------------------------------------------------------
//
// The marketplace contract's interface — every write the
// GUI sends it, and the one read of a wallet's proceeds.
//
// Used by:
//   - components/BuyNftModal — buyListing
//   - components/UpdateListingModal — updateListing,
//     cancelListing
//   - pages/SellNft — listItem, withdrawProceeds and the
//     getProceeds read
// -----------------------------------------------------------

export { nftMarketplaceAbi };
