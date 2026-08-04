// -----------------------------------------------------------
//  [*] Contract ABIs
//
//  The two ABI JSONs were exported by the original Hardhat
//  deployment of the contracts. The marketplace ADDRESS is
//  not here — it comes from the backend at runtime
//  (getConfig().nftMarketplaceAddress, see config.js).
// -----------------------------------------------------------

import nftAbi from './BasicNft.json';
import nftMarketplaceAbi from './NftMarketplace.json';







// -----------------------------------------------------------
// nftAbi / nftMarketplaceAbi
// -----------------------------------------------------------
//
// Used by:
//   - components/NFTBox — tokenURI reads (nftAbi)
//   - components/BuyNftModal, components/UpdateListingModal —
//     buy / update / cancel writes (nftMarketplaceAbi)
//   - pages/SellNft — approve (nftAbi), list + withdraw
//     (nftMarketplaceAbi)
// -----------------------------------------------------------

export { nftAbi, nftMarketplaceAbi };
