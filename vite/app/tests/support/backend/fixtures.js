// -----------------------------------------------------------
//  [*] Test support — the marketplace world the doubles serve
//
//  One small, coherent marketplace that every double answers
//  from: the backend's API (the indexer's view of the
//  contract), the Sepolia chain behind the backend's RPC relay
//  (owners, token URIs, balances, proceeds) and the IPFS
//  gateway (the metadata files and images). The three agree
//  with each other the way the live system does — the
//  listings are the replay of the event story, the owners on
//  the chain match the listings' sellers and the wallets'
//  holdings, every listed token is approved for the
//  marketplace, the archive rows describe the files the
//  gateway serves.
//
//  The story, oldest first: a classmate (SELLER) lists PUG #0
//  and later lowers its price; the student at the keyboard
//  (STUDENT — the account in the MetaMask double) lists PUG #1
//  and PUG #2, and BUYER buys PUG #2, which leaves the student
//  with unwithdrawn proceeds; SELLER lists two tokens of a
//  student-made collection (ART), cancels one and lists a
//  third. PUG is the course's own NFT (the "Dogie" BasicNft:
//  every token shares one tokenURI, the real PUG metadata);
//  ART is a student's collection minted every way a student
//  can get it wrong — an image where the JSON should be, a
//  file that is not JSON, JSON without "image", the
//  non-standard "image_url", a file nobody hosts any more, a
//  burned token.
//
//  Shapes are the backend's (backend/app/marketplace/routes.py):
//  addresses lowercase, token ids and wei amounts strings,
//  keys sorted the way Flask's jsonify writes them.
//  handlers.js serves these by default; a test that needs a
//  variation copies a body and edits the copy rather than
//  changing a fixture other tests share.
//
//  Used by:
//    - handlers.js — the default answers of the API and the
//      gateway
//    - chain/sepolia.js — the chain's starting state
//    - wallets/metamask.js — the student's accounts
//    - page, component and hook tests — the values they
//      assert on
// -----------------------------------------------------------

import { getAddress, parseEther } from 'viem';


// The marketplace contract, lowercase as the backend's tables
// and /api/stats carry it (/api/config hands it out in the
// checksummed form it is configured with, see config below)
export const MARKETPLACE = '0x190d72e59ba67551da3be56e6837731338919dac';

// The people: the student at the keyboard, a second account
// in the same MetaMask, the classmate who sells and the one
// who bought from the student
export const STUDENT = '0x519c864f4cb663758c864724dd7b178cb88a00a5';
export const OTHER_ACCOUNT = '0x49d364b9eb061a9acef9c6ad11d9e9054a9abd86';
export const SELLER = '0x69fdf463d634078171b418cf44983a0a2653c33f';
export const BUYER = '0x98897bceecad3f1f06b65648c2a0cc8c51422ba1';

// The two NFT collections: the course's PUG ("Dogie") and a
// student-made one
export const PUGS = '0x9af3a7e9f86432ed7bf70f908d92b572f440340e';
export const ART = '0x24ad9a64b846a8ae5d3a833d7cf30de8199b0ba0';

// Sepolia, as the chain and the backend name it
export const SEPOLIA_CHAIN_ID = 11155111;







// -----------------------------------------------------------
// checksummed / short / wei / timeOf
// -----------------------------------------------------------
//
// checksummed gives an address in the EIP-55 form wagmi hands
// the page (the backend answers lowercase); short
// writes an address the way the GUI shortens it everywhere —
// its first six and last four characters around three dots;
// wei turns an ether amount into the wei string the backend
// sends; timeOf is the unix time of a Sepolia block in this
// world — twelve seconds a block from a fixed anchor, so the
// story's dates are fixed and the tests can read them.
//
// Used by:
//   - the fixtures below
//   - tests asserting what wagmi shows, an address on screen,
//     or a date
// -----------------------------------------------------------

export const checksummed = (address) => getAddress(address);

export const short = (address) => `${address.slice(0, 6)}...${address.slice(-4)}`;

export const wei = (ether) => parseEther(ether).toString();

const ANCHOR_BLOCK = 9712000;
const ANCHOR_TIME = 1790060000;

export const timeOf = (block) => ANCHOR_TIME + (block - ANCHOR_BLOCK) * 12;







// -----------------------------------------------------------
// IPFS — the files the gateway serves
// -----------------------------------------------------------
//
// The PUG's two files are the real ones of the course
// (metadata pointing at the image through the public ipfs.io
// gateway); the ART collection lives in one directory, except
// token #1, whose tokenURI is a bare image, and token #5,
// whose directory nobody hosts any more. Each file is its
// body and the Content-Type the gateway answers with; the
// gateway double answers any other path like an IPFS node
// that cannot find it.
// -----------------------------------------------------------

export const PUG_JSON_CID = 'bafybeig37ioir76s7mg5oobetncojcm3c3hxasyd4rvid4jqhy4gkaheg4';
export const PUG_IMAGE_CID = 'QmSsYRx3LpDAb1GZQm7zZ1AuHZjfbPkD6J7s9r41xu1mf8';
export const ART_DIR = 'bafybei2kpehdmoemeamafvd7sbjdz5ycbvj7kq4ogpjm7eyobzzjjliius';
export const ART_1_IMAGE_CID = 'bafkreiyho67dkx3htkufgo5el2fubvoju36abw2vywisxwxyln7veddtn5';
export const LOST_DIR = 'bafybeisnhq2afc2rkc62zzi44qrg73v4grjuexjo75cstwp6pobpk4lfyk';

// The tokenURI every PUG answers (the course contract's
// TOKEN_URI constant), and where the page finds both files on
// the local gateway
export const PUG_TOKEN_URI = `ipfs://${PUG_JSON_CID}/?filename=0-PUG.json`;
export const PUG_JSON_URL = `/ipfs/${PUG_JSON_CID}/?filename=0-PUG.json`;
export const PUG_IMAGE_URL = `/ipfs/${PUG_IMAGE_CID}?filename=pug.png`;

export const PUG_METADATA = {
  name: 'PUG',
  description: 'An adorable PUG pup!',
  image: `https://ipfs.io/ipfs/${PUG_IMAGE_CID}?filename=pug.png`,
  attributes: [{ trait_type: 'cuteness', value: 100 }],
};

export const ART_0_METADATA = {
  name: 'Vilnius at Dusk',
  description: 'The old town roofs from Gediminas Hill, minted for the second lab.',
  image: `ipfs://${ART_DIR}/0.png`,
  attributes: [{ trait_type: 'Palette', value: 'Amber' }, { trait_type: 'Edition', value: 1 }],
};

// A 1×1 PNG — what every image file holds
export const PNG = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='),
  (c) => c.charCodeAt(0),
);

const json = (value) => ({ body: JSON.stringify(value), type: 'application/json' });
const png = { body: PNG, type: 'image/png' };

export const ipfsFiles = {
  [PUG_JSON_CID]: json(PUG_METADATA),
  [PUG_IMAGE_CID]: png,

  [`${ART_DIR}/0.json`]: json(ART_0_METADATA),
  [`${ART_DIR}/0.png`]: png,

  // Token #1 — its tokenURI IS the image
  [ART_1_IMAGE_CID]: png,

  // Token #2 — a .json file holding YAML
  [`${ART_DIR}/2.json`]: { body: `name: Trakai Island Castle\nimage: ipfs://${ART_DIR}/2.png\n`, type: 'application/json' },

  // Token #3 — JSON without the "image" field
  [`${ART_DIR}/3.json`]: json({ name: 'Curonian Spit', description: 'The dunes of Nida at noon.' }),

  // Token #4 — the image under the non-standard "image_url"
  [`${ART_DIR}/4.json`]: json({ name: 'Kaunas Castle', description: 'Red brick on the river bend.', image_url: `ipfs://${ART_DIR}/4.png` }),
  [`${ART_DIR}/4.png`]: png,
};







// -----------------------------------------------------------
// The chain — who owns what, what each token's URI is
// -----------------------------------------------------------
//
// The starting state of the Sepolia double: the two
// collections with their tokens (owner, tokenURI; a burned
// token is simply absent), ether balances, the marketplace's
// unwithdrawn proceeds and the latest block. Every token the
// backend lists is approved for the marketplace — the
// contract refuses a listing without that approval.
// -----------------------------------------------------------

export const chainCollections = {
  [PUGS]: {
    name: 'Dogie',
    symbol: 'DOG',
    // The course contract was built on OpenZeppelin 4: an
    // unknown token reverts with a reason string
    nonexistent: 'reason',
    tokens: {
      0: { owner: SELLER, uri: PUG_TOKEN_URI, approved: MARKETPLACE },
      1: { owner: STUDENT, uri: PUG_TOKEN_URI, approved: MARKETPLACE },
      2: { owner: BUYER, uri: PUG_TOKEN_URI },
      3: { owner: STUDENT, uri: PUG_TOKEN_URI },
    },
  },
  [ART]: {
    name: 'Lithuanian Landscapes',
    symbol: 'LTL',
    // OpenZeppelin 5: an unknown (or burned) token reverts
    // with ERC721NonexistentToken
    nonexistent: 'custom',
    tokens: {
      0: { owner: SELLER, uri: `ipfs://${ART_DIR}/0.json`, approved: MARKETPLACE },
      1: { owner: SELLER, uri: `ipfs://${ART_1_IMAGE_CID}`, approved: MARKETPLACE },
      2: { owner: STUDENT, uri: `ipfs://${ART_DIR}/2.json` },
      3: { owner: SELLER, uri: `ipfs://${ART_DIR}/3.json` },
      4: { owner: SELLER, uri: `ipfs://${ART_DIR}/4.json` },
      5: { owner: SELLER, uri: `ipfs://${LOST_DIR}/5.json` },
      // #6 was burned — tokenURI and ownerOf revert
    },
  },
};

// Ether in every wallet — the second account cannot afford
// even the cheapest PUG
export const chainBalances = {
  [STUDENT]: wei('1.5'),
  [OTHER_ACCOUNT]: wei('0.01'),
  [SELLER]: wei('4.2'),
  [BUYER]: wei('0.25'),
};

// The marketplace's unwithdrawn sale proceeds — the student's
// from selling PUG #2
export const chainProceeds = {
  [STUDENT]: wei('0.03'),
};

export const LATEST_BLOCK = 9713052;







// -----------------------------------------------------------
// The event story — what the indexer read from the contract
// -----------------------------------------------------------
//
// Oldest first, each event as GET /api/activity carries it:
// the actor is the seller everywhere except a sale, where the
// buyer acts and the seller is named too; a cancellation has
// no price.
// -----------------------------------------------------------

export const TX = {
  pug0Listed: '0x857debe4a22570fb02b5884cd7f7ca097578b50a76d148ece820ba2f23fcffce',
  pug1Listed: '0x9c5a342305af47ac6feb49d2fb85145fed749bf0ec87e1621543c4d99b88a748',
  pug2Listed: '0xb3d6c2ed6cb97af24b98398e368ce821d2e5d7d27eb1f1a02d24234dcc8f06da',
  pug0Updated: '0x70d55ac8841306d02664eeda63d7d9c5ffa782cd3ec41ecb14583614cbece0a7',
  pug2Bought: '0x3dbcdcf2f3be1b12d75a1ffc49fdf025d9924f1a674e734f34f5e73d4b962999',
  art1Listed: '0xb01c56c4b806aa93a29026ba5576142948a7ae520a8cbdb2ada94ced9351a6b7',
  art3Listed: '0xde694485f3150070fe4adda995e222c0f95d4d21808a69ac20e8e68ae1487bb2',
  art3Canceled: '0x2b7cf179594e5b4befa9e50430204cac850c21328e72027b650cf39b2d94006f',
  art0Listed: '0x0f67bbc9a3d52730a35a3f8ccee53f50f8caa1d7fc10a53cc7cc7fdd42fe116b',
};

const event = (type, nftAddress, tokenId, { seller = null, buyer = null, price = null }, blockNumber, txHash) => ({
  blockNumber,
  buyer,
  nftAddress,
  price,
  seller,
  timestamp: timeOf(blockNumber),
  tokenId: String(tokenId),
  txHash,
  type,
});

export const STORY = [
  event('Listed', PUGS, 0, { seller: SELLER, price: wei('0.08') }, 9712004, TX.pug0Listed),
  event('Listed', PUGS, 1, { seller: STUDENT, price: wei('0.1') }, 9712118, TX.pug1Listed),
  event('Listed', PUGS, 2, { seller: STUDENT, price: wei('0.03') }, 9712240, TX.pug2Listed),
  event('Updated', PUGS, 0, { seller: SELLER, price: wei('0.05') }, 9712377, TX.pug0Updated),
  event('Bought', PUGS, 2, { seller: STUDENT, buyer: BUYER, price: wei('0.03') }, 9712502, TX.pug2Bought),
  event('Listed', ART, 1, { seller: SELLER, price: wei('0.02') }, 9712633, TX.art1Listed),
  event('Listed', ART, 3, { seller: SELLER, price: wei('0.5') }, 9712760, TX.art3Listed),
  event('Canceled', ART, 3, { seller: SELLER }, 9712801, TX.art3Canceled),
  event('Listed', ART, 0, { seller: SELLER, price: wei('1.25') }, 9712915, TX.art0Listed),
];

// The indexer's position and the contract's deployment
export const LAST_SCANNED_BLOCK = 9713040;
export const DEPLOYMENT_BLOCK = 9650112;

// The four events the indexer decodes — signature and topic
// hash exactly as backend/main.py's EVENT_TOPICS holds them
export const EVENT_TOPICS = {
  Bought: { signature: 'ItemBought(address,address,uint256,address,uint256)', topic0: '0x93c830507acd24c092e291f65f36eccf9df2be394d8b7a1802669761ff1ed995' },
  Canceled: { signature: 'ItemCanceled(address,address,uint256)', topic0: '0x9ba1a3cb55ce8d63d072a886f94d2a744f50cddf82128e897d0661f5ec623158' },
  Listed: { signature: 'ItemListed(address,address,uint256,uint256)', topic0: '0xd547e933094f12a9159076970143ebe73234e64480317844b0dcb36117116de4' },
  Updated: { signature: 'ItemUpdated(address,address,uint256,uint256)', topic0: '0x3c33e65e8698294810b631d476d60b44425303828da0b1f8b635231bfda12be2' },
};

// The pinner's rows (Pinned_Files) for every token the
// marketplace has seen — both files pinned for the healthy
// ones; for a token whose metadata cannot name an image, the
// image row is 'invalid'. In the order /api/nft answers them:
// by kind name, the image first (the backend's own suite pins
// that order)
const pinned = (cid, kind) => ({ cid, kind, status: 'pinned' });
const invalidImage = { cid: null, kind: 'image', status: 'invalid' };

export const ARCHIVE = {
  [`${PUGS}-0`]: [pinned(PUG_IMAGE_CID, 'image'), pinned(PUG_JSON_CID, 'metadata')],
  [`${PUGS}-1`]: [pinned(PUG_IMAGE_CID, 'image'), pinned(PUG_JSON_CID, 'metadata')],
  [`${PUGS}-2`]: [pinned(PUG_IMAGE_CID, 'image'), pinned(PUG_JSON_CID, 'metadata')],
  [`${ART}-0`]: [pinned(ART_DIR, 'image'), pinned(ART_DIR, 'metadata')],
  [`${ART}-1`]: [invalidImage, pinned(ART_1_IMAGE_CID, 'metadata')],
  [`${ART}-3`]: [invalidImage, pinned(ART_DIR, 'metadata')],
};







// -----------------------------------------------------------
// Backend answers — GET /api/…
// -----------------------------------------------------------
//
// Each a function returning a fresh body, computed from the
// story so the answers can never disagree with it: the active
// listings are the indexer's replay (a listing or a price
// update puts a token up at its block, a sale or a
// cancellation takes it down; newest listing block first),
// the totals count the same rows the backend's SQL does.
// -----------------------------------------------------------

// GET /api/config — FRONTEND_CONFIG of backend/main.py
export const config = () => ({
  ipfsGateway: '/ipfs/',
  ipfsTimeout: 10000,
  nftMarketplaceAddress: checksummed(MARKETPLACE),
  rpcUrl: '/api/rpc',
});

// The indexer's replay: each live listing with the block it
// was listed (or re-priced) at, which orders the storefront
const activeListings = () => {
  const live = new Map();
  for (const e of STORY) {
    const key = `${e.nftAddress}-${e.tokenId}`;
    const listing = { nftAddress: e.nftAddress, price: e.price, seller: e.seller, tokenId: e.tokenId };
    if (e.type === 'Listed' || e.type === 'Updated') live.set(key, { block: e.blockNumber, listing });
    else live.delete(key);
  }
  return [...live.values()].sort((a, b) => b.block - a.block).map((entry) => entry.listing);
};

// GET /api/listings
export const listings = () => ({ listings: activeListings() });

// GET /api/activity?limit=N — newest first
export const activity = () => ({ activity: structuredClone(STORY).reverse() });

// GET /api/stats
export const stats = () => {
  const live = activeListings();
  const sales = STORY.filter((e) => e.type === 'Bought');
  const statuses = Object.values(ARCHIVE).flat().reduce((counts, row) => ({ ...counts, [row.status]: (counts[row.status] ?? 0) + 1 }), {});
  return {
    activeListings: live.length,
    archive: Object.fromEntries(Object.entries(statuses).sort(([a], [b]) => a.localeCompare(b))),
    chainId: SEPOLIA_CHAIN_ID,
    deployedAt: timeOf(DEPLOYMENT_BLOCK),
    deploymentBlock: DEPLOYMENT_BLOCK,
    eventTopics: structuredClone(EVENT_TOPICS),
    floorPriceWei: live.length ? live.map((l) => BigInt(l.price)).reduce((a, b) => (a < b ? a : b)).toString() : null,
    lastScannedAt: timeOf(LAST_SCANNED_BLOCK) + 7,
    lastScannedBlock: LAST_SCANNED_BLOCK,
    marketplaceAddress: MARKETPLACE,
    network: 'Sepolia',
    totalEvents: STORY.length,
    totalSales: sales.length,
    totalVolumeWei: sales.reduce((sum, e) => sum + BigInt(e.price), 0n).toString(),
  };
};

// GET /api/nft/<nftAddress>/<tokenId> — the address is
// lowercased by the backend before the lookup
export const nft = (nftAddress, tokenId) => {
  const address = nftAddress.toLowerCase();
  const listing = activeListings().find((l) => l.nftAddress === address && l.tokenId === String(tokenId));
  return {
    activeListing: listing ? { price: listing.price, seller: listing.seller } : null,
    archive: structuredClone(ARCHIVE[`${address}-${tokenId}`] ?? []),
    events: STORY
      .filter((e) => e.nftAddress === address && e.tokenId === String(tokenId))
      .reverse()
      .map((e) => ({ blockNumber: e.blockNumber, buyer: e.buyer, price: e.price, seller: e.seller, timestamp: e.timestamp, txHash: e.txHash, type: e.type })),
  };
};

// GET /api/my-nfts/<wallet> — what the wallet holds on chain,
// as the backend rebuilds it from the transfer history; a
// wallet that never held anything is an empty list
export const myNfts = (wallet) => ({
  nfts: Object.entries(chainCollections).flatMap(([nftAddress, collection]) => Object.entries(collection.tokens)
    .filter(([, token]) => token.owner === wallet.toLowerCase())
    .map(([tokenId]) => ({ nftAddress, tokenId }))),
});
