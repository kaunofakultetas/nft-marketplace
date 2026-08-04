// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// ---------------------------------------------------------------------------------------
//  [*] NftMarketplace — the KNF teaching marketplace contract
//
//  A minimal self-custodial NFT marketplace: sellers keep their tokens in their OWN
//  wallet and only grant this contract an approval, buyers pay the exact listing price,
//  and sale earnings are PULLED by the seller afterwards (withdrawProceeds) instead of
//  being pushed during the sale — a seller whose wallet rejects ETH can never block a
//  purchase that way.
//
//  Events — the whole public history. The backend indexer rebuilds the entire
//  marketplace from these four alone, which is why every state change emits exactly one:
//
//    ItemListed    seller, nftAddress, tokenId | price
//    ItemUpdated   seller, nftAddress, tokenId | newPrice
//    ItemCanceled  seller, nftAddress, tokenId |
//    ItemBought    buyer,  nftAddress, tokenId | seller, price
//
//  (the three params before the bar are INDEXED — they become log topics; everything
//  after it rides in the data field)
//
//  Fixed since the 2024 deployment, all of which students can still watch misbehaving
//  on the old contract:
//    - isListed compared a uint256 against < 0, so it was a NO-OP: updateListing could
//      conjure a listing that had never been approved, and cancelListing fired events
//      for tokens that were never listed
//    - a sale credited msg.value while announcing price, so overpayment silently
//      enriched the seller — the price must now match EXACTLY
//    - a listing went STALE in silence when the seller moved the token or revoked the
//      approval; buying one failed with a bare ERC-721 revert instead of a named error
//    - price updates were announced as ItemListed, making a reprice indistinguishable
//      from a new listing
//    - approvals granted with setApprovalForAll were refused
//
//  Compile notes: OpenZeppelin v5 (ReentrancyGuard lives in utils/ since v5, not
//  security/) and Solidity ^0.8.20.
//
//  Used by:
//    - backend/app/marketplace/indexer.py — decodes the four events into SQLite; the
//      topic hashes live there and MUST be recomputed when an event signature changes
//    - vite/app/src/pages/SellNft — listItem, withdrawProceeds
//    - vite/app/src/components/UpdateListingModal — updateListing, cancelListing
//    - vite/app/src/components/BuyNftModal — buyListing
// ---------------------------------------------------------------------------------------

import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";








// ---------------------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------------------
//
// Custom errors rather than require strings: cheaper, and the wallet shows the NAME, so
// a failed transaction tells the student what they did wrong.
//
// Used by:
//   - every function of NftMarketplace (below)
// ---------------------------------------------------------------------------------------

error NftMarketplace__PriceMustBeAboveZero();
error NftMarketplace__NotApprovedForMarketplace();
error NftMarketplace__AlreadyListed(address nftAddress, uint256 tokenId);
error NftMarketplace__NotListed(address nftAddress, uint256 tokenId);
error NftMarketplace__NotOwner();
error NftMarketplace__NotSeller();
error NftMarketplace__ListingStale(address nftAddress, uint256 tokenId);
error NftMarketplace__PriceNotMet(address nftAddress, uint256 tokenId, uint256 price);
error NftMarketplace__NoProceeds();
error NftMarketplace__TransferFailed();








contract NftMarketplace is ReentrancyGuard {

    // What a listing is: an asking price plus WHO gets paid for it. The token itself
    // never moves here — it stays in the seller's wallet until someone buys.
    struct Listing {
        uint256 price;
        address seller;
    }

    // nftAddress => tokenId => listing. A price of 0 means "not listed": listItem
    // refuses a zero price precisely so this sentinel can never collide with a real one.
    mapping(address => mapping(uint256 => Listing)) private s_listings;

    // seller => ETH earned and not yet withdrawn
    mapping(address => uint256) private s_proceeds;






    // -----------------------------------------------------------------------------------
    // ItemListed
    // -----------------------------------------------------------------------------------
    //
    // A token entered the market. Emitted ONLY by listItem — a reprice announces
    // ItemUpdated instead, so the indexer never has to guess which of the two happened.
    //
    // Used by:
    //   - indexer.py — inserts a Listed row and an active listing
    // -----------------------------------------------------------------------------------

    event ItemListed(
        address indexed seller,
        address indexed nftAddress,
        uint256 indexed tokenId,
        uint256 price
    );






    // -----------------------------------------------------------------------------------
    // ItemUpdated
    // -----------------------------------------------------------------------------------
    //
    // The asking price of an existing listing changed.
    //
    // Used by:
    //   - indexer.py — inserts an Updated row and overwrites the active listing's price
    // -----------------------------------------------------------------------------------

    event ItemUpdated(
        address indexed seller,
        address indexed nftAddress,
        uint256 indexed tokenId,
        uint256 newPrice
    );






    // -----------------------------------------------------------------------------------
    // ItemCanceled
    // -----------------------------------------------------------------------------------
    //
    // A listing was withdrawn from the market.
    //
    // Used by:
    //   - indexer.py — inserts a Canceled row and deletes the active listing
    // -----------------------------------------------------------------------------------

    event ItemCanceled(
        address indexed seller,
        address indexed nftAddress,
        uint256 indexed tokenId
    );






    // -----------------------------------------------------------------------------------
    // ItemBought
    // -----------------------------------------------------------------------------------
    //
    // A sale completed. Carries the SELLER as well as the buyer — the 2024 contract
    // omitted it, which left the activity feed unable to show who sold to whom.
    //
    // Used by:
    //   - indexer.py — inserts a Bought row and deletes the active listing
    // -----------------------------------------------------------------------------------

    event ItemBought(
        address indexed buyer,
        address indexed nftAddress,
        uint256 indexed tokenId,
        address seller,
        uint256 price
    );






    // -----------------------------------------------------------------------------------
    // notListed
    // -----------------------------------------------------------------------------------
    //
    // Refuses tokens already on the market — price 0 IS the "not listed" sentinel.
    //
    // Used by:
    //   - listItem (below)
    // -----------------------------------------------------------------------------------

    modifier notListed(address nftAddress, uint256 tokenId) {
        if (s_listings[nftAddress][tokenId].price > 0) {
            revert NftMarketplace__AlreadyListed(nftAddress, tokenId);
        }
        _;
    }






    // -----------------------------------------------------------------------------------
    // isListed
    // -----------------------------------------------------------------------------------
    //
    // The mirror of notListed. In the 2024 contract this read `price < 0` on an UNSIGNED
    // integer — never true, so the guard did nothing at all and every function it
    // protected happily ran on empty listings.
    //
    // Used by:
    //   - updateListing, cancelListing, buyListing (below)
    // -----------------------------------------------------------------------------------

    modifier isListed(address nftAddress, uint256 tokenId) {
        if (s_listings[nftAddress][tokenId].price == 0) {
            revert NftMarketplace__NotListed(nftAddress, tokenId);
        }
        _;
    }






    // -----------------------------------------------------------------------------------
    // isOwner
    // -----------------------------------------------------------------------------------
    //
    // Asks the NFT contract itself who owns the token — this marketplace never takes
    // custody, so ownership is always read live rather than remembered.
    //
    // Used by:
    //   - listItem, updateListing, cancelListing (below)
    // -----------------------------------------------------------------------------------

    modifier isOwner(address nftAddress, uint256 tokenId, address spender) {
        if (IERC721(nftAddress).ownerOf(tokenId) != spender) {
            revert NftMarketplace__NotOwner();
        }
        _;
    }






    // -----------------------------------------------------------------------------------
    // listItem
    // -----------------------------------------------------------------------------------
    //
    // Puts a token on the market at a fixed price. The seller must FIRST approve this
    // contract on the NFT contract — either approve(marketplace, tokenId) for the one
    // token or setApprovalForAll(marketplace, true) for the whole collection; both are
    // accepted.
    //
    // Used by:
    //   - vite/app/src/pages/SellNft — after its approve() step
    // -----------------------------------------------------------------------------------

    function listItem(
        address nftAddress,
        uint256 tokenId,
        uint256 price
    )
        external
        notListed(nftAddress, tokenId)
        isOwner(nftAddress, tokenId, msg.sender)
    {
        if (price == 0) {
            revert NftMarketplace__PriceMustBeAboveZero();
        }
        if (!_isApprovedForMarketplace(nftAddress, tokenId)) {
            revert NftMarketplace__NotApprovedForMarketplace();
        }

        s_listings[nftAddress][tokenId] = Listing(price, msg.sender);
        emit ItemListed(msg.sender, nftAddress, tokenId, price);
    }






    // -----------------------------------------------------------------------------------
    // updateListing
    // -----------------------------------------------------------------------------------
    //
    // Changes the asking price. Only the ORIGINAL seller may do it, and they must still
    // own the token: if the NFT changed hands while listed, the new owner's route is
    // cancel and re-list, never a reprice — otherwise the listing would keep paying out
    // to the previous owner.
    //
    // Used by:
    //   - vite/app/src/components/UpdateListingModal
    // -----------------------------------------------------------------------------------

    function updateListing(
        address nftAddress,
        uint256 tokenId,
        uint256 newPrice
    )
        external
        isListed(nftAddress, tokenId)
        isOwner(nftAddress, tokenId, msg.sender)
    {
        if (s_listings[nftAddress][tokenId].seller != msg.sender) {
            revert NftMarketplace__NotSeller();
        }
        if (newPrice == 0) {
            revert NftMarketplace__PriceMustBeAboveZero();
        }
        if (!_isApprovedForMarketplace(nftAddress, tokenId)) {
            revert NftMarketplace__NotApprovedForMarketplace();
        }

        s_listings[nftAddress][tokenId].price = newPrice;
        emit ItemUpdated(msg.sender, nftAddress, tokenId, newPrice);
    }






    // -----------------------------------------------------------------------------------
    // cancelListing
    // -----------------------------------------------------------------------------------
    //
    // Takes a listing off the market. Guarded by CURRENT ownership rather than by
    // seller: whoever holds the token may clear its listing, which is what lets a new
    // owner clean up a stale listing they inherited.
    //
    // Used by:
    //   - vite/app/src/components/UpdateListingModal
    // -----------------------------------------------------------------------------------

    function cancelListing(
        address nftAddress,
        uint256 tokenId
    )
        external
        isListed(nftAddress, tokenId)
        isOwner(nftAddress, tokenId, msg.sender)
    {
        delete (s_listings[nftAddress][tokenId]);
        emit ItemCanceled(msg.sender, nftAddress, tokenId);
    }






    // -----------------------------------------------------------------------------------
    // buyListing
    // -----------------------------------------------------------------------------------
    //
    // Buys a listed token for EXACTLY its asking price — an over- or underpayment
    // reverts rather than being pocketed or refunded, so there is no surprise in either
    // direction. The token moves straight from the seller's wallet to the buyer's; the
    // ETH waits in this contract until the seller withdraws it.
    //
    // Used by:
    //   - vite/app/src/components/BuyNftModal
    // -----------------------------------------------------------------------------------

    function buyListing(
        address nftAddress,
        uint256 tokenId
    )
        external
        payable
        isListed(nftAddress, tokenId)
        nonReentrant
    {
        Listing memory listedItem = s_listings[nftAddress][tokenId];

        if (msg.value != listedItem.price) {
            revert NftMarketplace__PriceNotMet(nftAddress, tokenId, listedItem.price);
        }

        // A listing goes stale the moment the seller moves the token or revokes the
        // approval — nothing on-chain tells this contract about either. Both are checked
        // HERE so a buyer gets a named error instead of a bare ERC-721 revert from deep
        // inside the token contract.
        if (IERC721(nftAddress).ownerOf(tokenId) != listedItem.seller) {
            revert NftMarketplace__ListingStale(nftAddress, tokenId);
        }
        if (!_isApprovedForMarketplace(nftAddress, tokenId)) {
            revert NftMarketplace__NotApprovedForMarketplace();
        }

        // Effects before interactions: the listing is gone and the money is booked
        // BEFORE the token moves, because safeTransferFrom calls the buyer's
        // onERC721Received hook — a contract buyer re-entering here finds nothing left
        // to buy (and nonReentrant refuses the call anyway)
        delete (s_listings[nftAddress][tokenId]);
        s_proceeds[listedItem.seller] += msg.value;

        IERC721(nftAddress).safeTransferFrom(listedItem.seller, msg.sender, tokenId);

        emit ItemBought(
            msg.sender,
            nftAddress,
            tokenId,
            listedItem.seller,
            listedItem.price
        );
    }






    // -----------------------------------------------------------------------------------
    // withdrawProceeds
    // -----------------------------------------------------------------------------------
    //
    // Pays out everything the caller has earned from sales. The balance is zeroed BEFORE
    // the transfer (checks-effects-interactions), so a re-entering recipient finds
    // nothing left to claim — and nonReentrant refuses the attempt on top of that.
    //
    // Used by:
    //   - vite/app/src/pages/SellNft — the Proceeds card
    // -----------------------------------------------------------------------------------

    function withdrawProceeds() external nonReentrant {
        uint256 proceeds = s_proceeds[msg.sender];
        if (proceeds == 0) {
            revert NftMarketplace__NoProceeds();
        }
        s_proceeds[msg.sender] = 0;

        (bool sent, ) = payable(msg.sender).call{value: proceeds}("");
        if (!sent) {
            revert NftMarketplace__TransferFailed();
        }
    }






    // -----------------------------------------------------------------------------------
    // _isApprovedForMarketplace
    // -----------------------------------------------------------------------------------
    //
    // Both approval styles count: the single-token approve() and the collection-wide
    // setApprovalForAll(). The 2024 contract accepted only the first, so students who
    // used the second were refused with a confusing error.
    //
    // Used by:
    //   - listItem, updateListing, buyListing (above)
    // -----------------------------------------------------------------------------------

    function _isApprovedForMarketplace(
        address nftAddress,
        uint256 tokenId
    ) private view returns (bool) {
        IERC721 nft = IERC721(nftAddress);
        return nft.getApproved(tokenId) == address(this)
            || nft.isApprovedForAll(nft.ownerOf(tokenId), address(this));
    }






    // -----------------------------------------------------------------------------------
    // getListing
    // -----------------------------------------------------------------------------------
    //
    // The live listing of one token; price 0 means not listed.
    //
    // Used by:
    //   - nothing in this stack — the GUI reads listings from the backend's indexed
    //     database, not from the chain. Kept for students inspecting it in Remix.
    // -----------------------------------------------------------------------------------

    function getListing(
        address nftAddress,
        uint256 tokenId
    ) external view returns (Listing memory) {
        return s_listings[nftAddress][tokenId];
    }






    // -----------------------------------------------------------------------------------
    // getProceeds
    // -----------------------------------------------------------------------------------
    //
    // How much ETH a seller has earned and not yet withdrawn.
    //
    // Used by:
    //   - vite/app/src/pages/SellNft — the Proceeds card
    // -----------------------------------------------------------------------------------

    function getProceeds(address seller) external view returns (uint256) {
        return s_proceeds[seller];
    }
}
