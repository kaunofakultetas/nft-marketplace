// -----------------------------------------------------------
//  [*] Test support — the Sepolia double behind the RPC relay
//
//  The SPA reads the chain only through the backend's
//  JSON-RPC relay (POST /api/rpc): wagmi's http transport for
//  tokenURI, ownerOf, getProceeds and the wallet's balance,
//  and for waiting on a transaction's receipt. This module is
//  the chain those requests reach
//  — a small in-memory Sepolia that speaks JSON-RPC the way
//  Infura does:
//
//    - single requests and batches (JSON-RPC lets a client
//      send several calls in one post, and the relay passes
//      them on untouched)
//    - eth_call against the contracts it knows, and against
//      Multicall3's aggregate3 — viem folds the page's
//      concurrent reads into one such call, each read
//      succeeding or failing on its own
//    - a revert answered like a node: JSON-RPC error 3,
//      "execution reverted" with the reason when there is
//      one, and the revert data
//    - eth_getBalance, eth_blockNumber, eth_chainId,
//      net_version, eth_getCode, eth_getTransactionReceipt;
//      any other method is Infura's -32601, so a page calling
//      something new shows up instead of passing
//
//  It knows the marketplace and the ERC-721 collections FROM
//  THE CONTRACTS' OWN SIGNATURES (NftMarketplace.sol and the
//  ERC-721 standard), not through the ABI files the app ships
//  — calldata built from a drifted ABI is calldata this chain
//  cannot read. Writes arrive from the MetaMask double
//  (submit) and are mined at once, or held until the test
//  mines them; a transaction the contract refuses is mined
//  with status 0, as on the real chain. The rules are the
//  contract's: listing needs ownership, a positive price and
//  the marketplace's approval; a purchase pays exactly the
//  price; proceeds wait in the contract until withdrawn.
//
//  The state starts from fixtures.js and is rebuilt before
//  every test (setup.js calls reset). Every request is
//  recorded (requests), every contract read decoded (reads),
//  every transaction kept (transactions).
//
//  Used by:
//    - backend/handlers.js — POST /api/rpc
//    - wallets/metamask.js — broadcasting the student's
//      transactions
//    - setup.js — reset before every test
//    - core/structural.test.js — the contracts' signatures
//    - tests that shape the chain (owners, balances,
//      proceeds, burned tokens, mining) or read what was asked
// -----------------------------------------------------------

import { HttpResponse } from 'msw';
import {
  decodeFunctionData, encodeErrorResult, encodeFunctionResult, keccak256,
  multicall3Abi, parseAbi, toHex,
} from 'viem';
import * as f from '../backend/fixtures';


// Multicall3 — deployed at the same address on every chain
export const MULTICALL3 = '0xca11bde05977b3631167028862be2a173976ca11';

export const SEPOLIA_HEX = toHex(f.SEPOLIA_CHAIN_ID);

// The marketplace as NftMarketplace.sol declares it — also
// what core/structural.test.js holds the app's ABI file to
export const MARKETPLACE_ABI = parseAbi([
  'function listItem(address nftAddress, uint256 tokenId, uint256 price)',
  'function updateListing(address nftAddress, uint256 tokenId, uint256 newPrice)',
  'function cancelListing(address nftAddress, uint256 tokenId)',
  'function buyListing(address nftAddress, uint256 tokenId) payable',
  'function withdrawProceeds()',
  'function getListing(address nftAddress, uint256 tokenId) view returns ((uint256 price, address seller))',
  'function getProceeds(address seller) view returns (uint256)',
  'error NftMarketplace__PriceMustBeAboveZero()',
  'error NftMarketplace__NotApprovedForMarketplace()',
  'error NftMarketplace__AlreadyListed(address nftAddress, uint256 tokenId)',
  'error NftMarketplace__NotListed(address nftAddress, uint256 tokenId)',
  'error NftMarketplace__NotOwner()',
  'error NftMarketplace__NotSeller()',
  'error NftMarketplace__ListingStale(address nftAddress, uint256 tokenId)',
  'error NftMarketplace__PriceNotMet(address nftAddress, uint256 tokenId, uint256 price)',
  'error NftMarketplace__SellerCannotBuy()',
  'error NftMarketplace__NoProceeds()',
]);

// An ERC-721 collection as the standard declares it, with
// OpenZeppelin 5's custom errors
export const ERC721_ABI = parseAbi([
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function tokenURI(uint256 tokenId) view returns (string)',
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function balanceOf(address owner) view returns (uint256)',
  'function getApproved(uint256 tokenId) view returns (address)',
  'function isApprovedForAll(address owner, address operator) view returns (bool)',
  'function approve(address to, uint256 tokenId)',
  'function setApprovalForAll(address operator, bool approved)',
  'function transferFrom(address from, address to, uint256 tokenId)',
  'function safeTransferFrom(address from, address to, uint256 tokenId)',
  'error ERC721NonexistentToken(uint256 tokenId)',
  'error ERC721InvalidApprover(address approver)',
  'error ERC721InsufficientApproval(address operator, uint256 tokenId)',
]);

// Solidity's built-in Error(string) — a require() with a
// reason, OpenZeppelin 4's way of refusing
const ERROR_STRING_ABI = [{ type: 'error', name: 'Error', inputs: [{ name: 'message', type: 'string' }] }];

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

// Any bytes do for a contract's code — callers only ask
// whether there is some
const SOME_CODE = '0x6080604052348015600f57600080fd5b50';







// -----------------------------------------------------------
// Revert
// -----------------------------------------------------------
//
// A refusal of the contract: the revert data a node hands
// back and, for a require() with a reason, the reason —
// thrown by the contract rules below and turned into the
// node's answer (an RPC error for a direct call, a failed
// entry inside a multicall, status 0 in a mined
// transaction's receipt).
//
// Used by:
//   - the contract rules and the request handlers below
// -----------------------------------------------------------

class Revert extends Error {
  constructor(data, reason = null) {
    super(reason ? `execution reverted: ${reason}` : 'execution reverted');
    this.data = data;
    this.reason = reason;
  }
}

const refuse = (abi, errorName, args = []) => new Revert(encodeErrorResult({ abi, errorName, args }));
const refuseWithReason = (reason) => new Revert(encodeErrorResult({ abi: ERROR_STRING_ABI, errorName: 'Error', args: [reason] }), reason);
const marketplaceRefuses = (errorName, args) => refuse(MARKETPLACE_ABI, errorName, args);

// A JSON-RPC failure, answered as the request's error
class RpcFailure extends Error {
  constructor(error) {
    super(error.message);
    this.error = error;
  }
}







// -----------------------------------------------------------
// buildState
// -----------------------------------------------------------
//
// The chain's starting state from fixtures.js: every
// collection with its tokens (owner, tokenURI, approved
// address) and operators, the marketplace's listings (one per
// token the backend lists, at the listed price) and proceeds,
// the ether balances and the latest block. Token ids are kept
// as decimal strings, addresses lowercase.
//
// Used by:
//   - sepolia.reset (below)
// -----------------------------------------------------------

function buildState() {

  const collections = new Map(Object.entries(f.chainCollections).map(([address, collection]) => [address, {
    name: collection.name,
    symbol: collection.symbol,
    nonexistent: collection.nonexistent,
    operators: new Set(),
    tokens: new Map(Object.entries(collection.tokens).map(([id, token]) => [id, {
      owner: token.owner,
      uri: token.uri,
      approved: token.approved ?? ZERO_ADDRESS,
    }])),
  }]));


  const listings = new Map(f.listings().listings.map((listing) => [
    `${listing.nftAddress}-${listing.tokenId}`,
    { price: BigInt(listing.price), seller: listing.seller },
  ]));


  return {
    block: f.LATEST_BLOCK,
    balances: new Map(Object.entries(f.chainBalances).map(([address, amount]) => [address, BigInt(amount)])),
    collections,
    listings,
    proceeds: new Map(Object.entries(f.chainProceeds).map(([address, amount]) => [address, BigInt(amount)])),
    nonces: new Map(),
  };
}







// -----------------------------------------------------------
// The ERC-721 collections
// -----------------------------------------------------------
//
// A collection's views and writes over its state. An unknown
// or burned token refuses the way its OpenZeppelin generation
// does (a reason string for the course's OZ 4 contract,
// ERC721NonexistentToken for OZ 5); approve takes the owner or
// an operator; a transfer needs the owner, the approved
// address or an operator, and clears the token's approval.
//
// Used by:
//   - execute (below), the marketplace rules
// -----------------------------------------------------------

function tokenOf(collection, tokenId) {
  const token = collection.tokens.get(String(tokenId));
  if (token) return token;
  if (collection.nonexistent === 'reason') throw refuseWithReason('ERC721: invalid token ID');
  throw refuse(ERC721_ABI, 'ERC721NonexistentToken', [BigInt(tokenId)]);
}

const mayManage = (collection, token, spender) => (
  spender === token.owner || collection.operators.has(`${token.owner}|${spender}`)
);

const ERC721_RULES = {
  name: (collection) => collection.name,
  symbol: (collection) => collection.symbol,
  tokenURI: (collection, [tokenId]) => tokenOf(collection, tokenId).uri,
  ownerOf: (collection, [tokenId]) => tokenOf(collection, tokenId).owner,
  balanceOf: (collection, [owner]) => BigInt([...collection.tokens.values()].filter((t) => t.owner === owner.toLowerCase()).length),
  getApproved: (collection, [tokenId]) => tokenOf(collection, tokenId).approved,
  isApprovedForAll: (collection, [owner, operator]) => collection.operators.has(`${owner.toLowerCase()}|${operator.toLowerCase()}`),

  approve: (collection, [to, tokenId], { from }) => {
    const token = tokenOf(collection, tokenId);
    if (!mayManage(collection, token, from)) {
      if (collection.nonexistent === 'reason') throw refuseWithReason('ERC721: approve caller is not token owner or approved for all');
      throw refuse(ERC721_ABI, 'ERC721InvalidApprover', [from]);
    }
    token.approved = to.toLowerCase();
  },

  setApprovalForAll: (collection, [operator, approved], { from }) => {
    const key = `${from}|${operator.toLowerCase()}`;
    if (approved) collection.operators.add(key); else collection.operators.delete(key);
  },

  transferFrom: (collection, [from, to, tokenId], { from: spender }) => {
    const token = tokenOf(collection, tokenId);
    if (token.owner !== from.toLowerCase() || !(mayManage(collection, token, spender) || token.approved === spender)) {
      throw refuse(ERC721_ABI, 'ERC721InsufficientApproval', [spender, BigInt(tokenId)]);
    }
    token.owner = to.toLowerCase();
    token.approved = ZERO_ADDRESS;
  },
};
ERC721_RULES.safeTransferFrom = ERC721_RULES.transferFrom;







// -----------------------------------------------------------
// The marketplace
// -----------------------------------------------------------
//
// NftMarketplace.sol's rules over the state, in the order the
// contract checks them; a purchase moves the token through
// the collection's own transfer, as the contract does.
//
// Used by:
//   - execute (below)
// -----------------------------------------------------------

const approvedForMarketplace = (state, nftAddress, tokenId) => {
  const collection = state.collections.get(nftAddress.toLowerCase());
  const token = tokenOf(collection, tokenId);
  return token.approved === f.MARKETPLACE || collection.operators.has(`${token.owner}|${f.MARKETPLACE}`);
};

const listingKey = (nftAddress, tokenId) => `${nftAddress.toLowerCase()}-${tokenId}`;

const listingOf = (state, nftAddress, tokenId) => {
  const listing = state.listings.get(listingKey(nftAddress, tokenId));
  if (!listing) throw marketplaceRefuses('NftMarketplace__NotListed', [nftAddress, tokenId]);
  return listing;
};

const ownerOnChain = (state, nftAddress, tokenId) => {
  const collection = state.collections.get(nftAddress.toLowerCase());
  if (!collection) throw new Revert('0x');
  return tokenOf(collection, tokenId).owner;
};

const MARKETPLACE_RULES = {
  getListing: (state, [nftAddress, tokenId]) => {
    const listing = state.listings.get(listingKey(nftAddress, tokenId));
    return listing ? { price: listing.price, seller: listing.seller } : { price: 0n, seller: ZERO_ADDRESS };
  },

  getProceeds: (state, [seller]) => state.proceeds.get(seller.toLowerCase()) ?? 0n,

  listItem: (state, [nftAddress, tokenId, price], { from }) => {
    if (state.listings.has(listingKey(nftAddress, tokenId))) throw marketplaceRefuses('NftMarketplace__AlreadyListed', [nftAddress, tokenId]);
    if (ownerOnChain(state, nftAddress, tokenId) !== from) throw marketplaceRefuses('NftMarketplace__NotOwner');
    if (price === 0n) throw marketplaceRefuses('NftMarketplace__PriceMustBeAboveZero');
    if (!approvedForMarketplace(state, nftAddress, tokenId)) throw marketplaceRefuses('NftMarketplace__NotApprovedForMarketplace');
    state.listings.set(listingKey(nftAddress, tokenId), { price, seller: from });
  },

  updateListing: (state, [nftAddress, tokenId, newPrice], { from }) => {
    const listing = listingOf(state, nftAddress, tokenId);
    if (ownerOnChain(state, nftAddress, tokenId) !== from) throw marketplaceRefuses('NftMarketplace__NotOwner');
    if (listing.seller !== from) throw marketplaceRefuses('NftMarketplace__NotSeller');
    if (newPrice === 0n) throw marketplaceRefuses('NftMarketplace__PriceMustBeAboveZero');
    if (!approvedForMarketplace(state, nftAddress, tokenId)) throw marketplaceRefuses('NftMarketplace__NotApprovedForMarketplace');
    listing.price = newPrice;
  },

  cancelListing: (state, [nftAddress, tokenId], { from }) => {
    const listing = listingOf(state, nftAddress, tokenId);
    if (from !== listing.seller) {
      let owner = null;
      try { owner = ownerOnChain(state, nftAddress, tokenId); } catch { /* a dead token may be cancelled by anyone */ }
      if (owner === listing.seller) throw marketplaceRefuses('NftMarketplace__NotOwner');
    }
    state.listings.delete(listingKey(nftAddress, tokenId));
  },

  buyListing: (state, [nftAddress, tokenId], { from, value }) => {
    const listing = listingOf(state, nftAddress, tokenId);
    if (from === listing.seller) throw marketplaceRefuses('NftMarketplace__SellerCannotBuy');
    if (value !== listing.price) throw marketplaceRefuses('NftMarketplace__PriceNotMet', [nftAddress, tokenId, listing.price]);
    if (ownerOnChain(state, nftAddress, tokenId) !== listing.seller) throw marketplaceRefuses('NftMarketplace__ListingStale', [nftAddress, tokenId]);
    if (!approvedForMarketplace(state, nftAddress, tokenId)) throw marketplaceRefuses('NftMarketplace__NotApprovedForMarketplace');
    state.listings.delete(listingKey(nftAddress, tokenId));
    state.proceeds.set(listing.seller, (state.proceeds.get(listing.seller) ?? 0n) + value);
    const collection = state.collections.get(nftAddress.toLowerCase());
    ERC721_RULES.transferFrom(collection, [listing.seller, from, tokenId], { from: f.MARKETPLACE });
  },

  withdrawProceeds: (state, _, { from }) => {
    const proceeds = state.proceeds.get(from) ?? 0n;
    if (proceeds === 0n) throw marketplaceRefuses('NftMarketplace__NoProceeds');
    state.proceeds.set(from, 0n);
    state.balances.set(from, (state.balances.get(from) ?? 0n) + proceeds);
  },
};







// -----------------------------------------------------------
// contractAt / decodeCall
// -----------------------------------------------------------
//
// contractAt names what lives at an address: the marketplace,
// a collection, or nothing (an account without code).
// decodeCall reads calldata sent to an address as the
// function and arguments the contract there declares — null
// for an address without code or calldata the contract does
// not understand.
//
// Used by:
//   - execute (below)
//   - wallets/metamask.js — the record of sent transactions
// -----------------------------------------------------------

function contractAt(state, address) {
  const to = String(address ?? '').toLowerCase();
  if (to === f.MARKETPLACE) return { kind: 'marketplace', abi: MARKETPLACE_ABI };
  if (state.collections.has(to)) return { kind: 'collection', abi: ERC721_ABI, collection: state.collections.get(to) };
  return null;
}

export function decodeCall(address, data) {
  const contract = contractAt(sepolia.state, address);
  if (!contract) return null;
  try {
    const { functionName, args = [] } = decodeFunctionData({ abi: contract.abi, data });
    return { functionName, args: [...args] };
  } catch {
    return null;
  }
}







// -----------------------------------------------------------
// multicall
// -----------------------------------------------------------
//
// Multicall3's functions as viem uses them: aggregate3 runs
// each inner call on its own (a failing one answers success
// false with its revert data when it may fail) — viem folds
// the page's concurrent reads into one — and getEthBalance is
// how viem reads a wallet's ether once multicall batching is
// on (wagmi turns it on); the block and chain getters answer
// from the chain. Anything else reverts without data.
//
// Used by:
//   - execute (below)
// -----------------------------------------------------------

function multicall(state, data, { recordReads, via }) {

  const { functionName, args = [] } = decodeFunctionData({ abi: multicall3Abi, data });
  if (recordReads && functionName !== 'aggregate3') sepolia.reads.push({ to: MULTICALL3, functionName, args: [...args], via });


  const rules = {
    aggregate3: ([calls]) => calls.map(({ target, allowFailure, callData }) => {
      try {
        return { success: true, returnData: execute(state, { from: MULTICALL3, to: target, data: callData }, { via: 'multicall', recordReads }) };
      } catch (error) {
        if (!(error instanceof Revert)) throw error;
        if (!allowFailure) throw new Revert(error.data, error.reason);
        return { success: false, returnData: error.data };
      }
    }),
    getEthBalance: ([address]) => state.balances.get(address.toLowerCase()) ?? 0n,
    getBlockNumber: () => BigInt(state.block),
    getChainId: () => BigInt(f.SEPOLIA_CHAIN_ID),
    getCurrentBlockTimestamp: () => BigInt(f.timeOf(state.block)),
  };

  if (!rules[functionName]) throw new Revert('0x');
  return encodeFunctionResult({ abi: multicall3Abi, functionName, result: rules[functionName](args) });
}







// -----------------------------------------------------------
// execute
// -----------------------------------------------------------
//
// Runs one call or transaction against a state and returns
// its ABI-encoded result: Multicall3 answers through
// multicall above, a call to an account without code returns
// nothing, calldata the contract does not understand reverts
// without data. Every contract call is recorded in `reads`
// when it does not change state.
//
// Used by:
//   - multicall (above), the eth_call handler and mine (below)
// -----------------------------------------------------------

function execute(state, { from, to, data = '0x', value = 0n }, { via = 'direct', recordReads = true } = {}) {

  const address = String(to ?? '').toLowerCase();
  const sender = String(from ?? ZERO_ADDRESS).toLowerCase();

  if (address === MULTICALL3) return multicall(state, data, { recordReads, via });


  const contract = contractAt(state, address);
  if (!contract) return '0x';

  let decoded;
  try {
    decoded = decodeFunctionData({ abi: contract.abi, data });
  } catch {
    throw new Revert('0x');
  }
  const args = [...(decoded.args ?? [])];
  const fn = contract.abi.find((item) => item.type === 'function' && item.name === decoded.functionName);
  const isView = fn.stateMutability === 'view';
  if (isView && recordReads) sepolia.reads.push({ to: address, functionName: decoded.functionName, args, via });


  const context = { from: sender, value: BigInt(value) };
  const result = contract.kind === 'marketplace'
    ? MARKETPLACE_RULES[decoded.functionName](state, args, context)
    : ERC721_RULES[decoded.functionName](contract.collection, args, context);

  if (!isView) return '0x';
  return encodeFunctionResult({ abi: contract.abi, functionName: decoded.functionName, result });
}







// -----------------------------------------------------------
// mine
// -----------------------------------------------------------
//
// Puts a transaction into the next block: runs it against a
// copy of the state and keeps the copy only when the contract
// accepted it (a refused transaction changes nothing but still
// lands, with status 0); the sender pays the value it sent.
// The receipt carries every field a client reads from one.
//
// Used by:
//   - sepolia.submit, sepolia.mine (below)
// -----------------------------------------------------------

function mine(transaction) {

  const state = sepolia.state;
  const attempt = structuredClone(state);
  let status = 1;

  try {
    if (transaction.value) {
      const balance = attempt.balances.get(transaction.from) ?? 0n;
      attempt.balances.set(transaction.from, balance - transaction.value);
    }
    execute(attempt, transaction, { recordReads: false });
  } catch (error) {
    if (!(error instanceof Revert)) throw error;
    status = 0;
  }

  const block = state.block + 1;
  if (status === 1) Object.assign(state, attempt);
  state.block = block;


  transaction.receipt = {
    blockHash: keccak256(toHex(`block ${block}`)),
    blockNumber: toHex(block),
    contractAddress: null,
    cumulativeGasUsed: toHex(84000),
    effectiveGasPrice: toHex(1500000000),
    from: transaction.from,
    gasUsed: toHex(84000),
    logs: [],
    logsBloom: `0x${'0'.repeat(512)}`,
    status: toHex(status),
    to: transaction.to,
    transactionHash: transaction.hash,
    transactionIndex: '0x0',
    type: '0x2',
  };
}







// -----------------------------------------------------------
// The JSON-RPC methods
// -----------------------------------------------------------
//
// What the relay answers per method; a method missing here is
// Infura's "does not exist" error.
//
// Used by:
//   - answer (below)
// -----------------------------------------------------------

const asBigInt = (hex) => (hex === undefined || hex === null ? 0n : BigInt(hex));

const METHODS = {
  eth_chainId: () => SEPOLIA_HEX,
  net_version: () => String(f.SEPOLIA_CHAIN_ID),
  eth_blockNumber: () => toHex(sepolia.state.block),

  eth_getBalance: ([address]) => toHex(sepolia.state.balances.get(String(address).toLowerCase()) ?? 0n),

  eth_getCode: ([address]) => (contractAt(sepolia.state, address) ? SOME_CODE : '0x'),

  eth_call: ([call]) => {
    try {
      return execute(structuredClone(sepolia.state), { ...call, value: asBigInt(call.value) });
    } catch (error) {
      if (!(error instanceof Revert)) throw error;
      throw new RpcFailure({ code: 3, message: error.message, data: error.data });
    }
  },

  eth_getTransactionReceipt: ([hash]) => sepolia.transactions.find((tx) => tx.hash === hash)?.receipt ?? null,
};

function answer({ id, jsonrpc = '2.0', method, params = [] }) {
  sepolia.requests.push({ method, params });
  if (!METHODS[method]) {
    return { jsonrpc, id, error: { code: -32601, message: `the method ${method} does not exist/is not available` } };
  }
  try {
    return { jsonrpc, id, result: METHODS[method](params) };
  } catch (error) {
    if (!(error instanceof RpcFailure)) throw error;
    return { jsonrpc, id, error: error.error };
  }
}







// -----------------------------------------------------------
// sepolia
// -----------------------------------------------------------
//
// The chain itself: its state and records, the relay's msw
// resolver, and the moves a test makes on it — the
// transaction the wallet broadcasts, mining held and
// released, and the world bent (a token's owner or URI, a
// burned token, a balance, proceeds, a listing).
//
// The relay answers a batch with a batch, in order. A request
// the double itself trips over (a bug of the double, never a
// behaviour of the app) is answered as an internal error AND
// recorded in `faults`, which setup.js turns into a failed
// test — msw would otherwise quietly answer it with a 500 the
// app may well tolerate. submit gives a transaction its hash
// (derived from sender, nonce and calldata, so it is the same
// on every run) and mines it unless mining is held; mine then
// mines everything waiting.
//
// Used by:
//   - backend/handlers.js, wallets/metamask.js, setup.js
//   - tests (through the moves and records)
// -----------------------------------------------------------

export const sepolia = {
  state: null,
  requests: [],
  reads: [],
  transactions: [],
  faults: [],
  holding: false,

  reset() {
    sepolia.state = buildState();
    sepolia.requests = [];
    sepolia.reads = [];
    sepolia.transactions = [];
    sepolia.faults = [];
    sepolia.holding = false;
  },

  // The msw resolver of POST /api/rpc
  async relay({ request }) {
    const body = await request.json();
    const safely = (one) => {
      try {
        return answer(one);
      } catch (error) {
        sepolia.faults.push(`${one?.method}: ${error.stack ?? error}`);
        return { jsonrpc: '2.0', id: one?.id ?? null, error: { code: -32603, message: `the Sepolia double failed: ${error.message}` } };
      }
    };
    return HttpResponse.json(Array.isArray(body) ? body.map(safely) : safely(body));
  },

  // The methods asked, in order — and the reads of one
  // contract function
  methods: () => sepolia.requests.map((request) => request.method),
  readsOf: (functionName) => sepolia.reads.filter((read) => read.functionName === functionName),

  submit({ from, to, data = '0x', value }) {
    const sender = String(from).toLowerCase();
    const nonce = sepolia.state.nonces.get(sender) ?? 0;
    sepolia.state.nonces.set(sender, nonce + 1);

    const transaction = {
      hash: keccak256(toHex(`${sender}:${nonce}:${data}`)),
      from: sender,
      to: String(to).toLowerCase(),
      data,
      value: asBigInt(value),
      call: decodeCall(to, data),
      receipt: null,
    };
    sepolia.transactions.push(transaction);
    if (!sepolia.holding) mine(transaction);
    return transaction.hash;
  },

  holdMining() {
    sepolia.holding = true;
  },

  mine() {
    sepolia.holding = false;
    for (const transaction of sepolia.transactions) {
      if (!transaction.receipt) mine(transaction);
    }
  },

  // The world bent for one test
  setOwner(nftAddress, tokenId, owner) {
    sepolia.state.collections.get(nftAddress).tokens.get(String(tokenId)).owner = owner.toLowerCase();
  },
  setTokenURI(nftAddress, tokenId, uri) {
    sepolia.state.collections.get(nftAddress).tokens.get(String(tokenId)).uri = uri;
  },
  burn(nftAddress, tokenId) {
    sepolia.state.collections.get(nftAddress).tokens.delete(String(tokenId));
  },
  mint(nftAddress, tokenId, owner, uri) {
    sepolia.state.collections.get(nftAddress).tokens.set(String(tokenId), { owner: owner.toLowerCase(), uri, approved: ZERO_ADDRESS });
  },
  setBalance(address, amount) {
    sepolia.state.balances.set(address.toLowerCase(), BigInt(amount));
  },
  setProceeds(address, amount) {
    sepolia.state.proceeds.set(address.toLowerCase(), BigInt(amount));
  },
};

sepolia.reset();
