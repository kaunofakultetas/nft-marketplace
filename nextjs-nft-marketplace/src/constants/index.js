import nftAbi from "./BasicNft.json"
import nftMarketplaceAbi from "./NftMarketplace.json"

const nftMarketplaceAddress = process.env.NEXT_PUBLIC_NFT_MARKETPLACE_ADDRESS

export { nftAbi, nftMarketplaceAbi, nftMarketplaceAddress }
