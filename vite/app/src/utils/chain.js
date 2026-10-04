// -----------------------------------------------------------
//  [*] Chain helpers — what a failed read means, and waiting
//      for a transaction
//
//  Every chain read goes through the backend's RPC relay, so a
//  read can fail two very different ways: the CONTRACT refuses
//  (a revert — a burned token, an id that never existed — or
//  no contract at the address at all), which says something
//  about the token; or the WAY to the chain fails (the relay
//  down, Infura's quota spent), which says nothing about the
//  token and must never be blamed on it. And a transaction a
//  wallet sends is only a hash until it is mined — the pages
//  wait for its receipt through the same relay, and read its
//  status: a mined transaction may still have reverted.
// -----------------------------------------------------------

import { ContractFunctionRevertedError, ContractFunctionZeroDataError, TransactionReceiptNotFoundError } from 'viem';


// How often a pending transaction's receipt is asked for —
// Sepolia mines a block every 12 seconds
const RECEIPT_POLL_MS = 2000;







// -----------------------------------------------------------
// contractRefused
// -----------------------------------------------------------
//
// Whether a failed contract read is the contract's own answer
// — a revert, or nothing at the address to answer — rather
// than the relay failing on the way. Walks the error's causes:
// wagmi hands viem's error over wrapped.
//
// Used by:
//   - hooks/useNftMetadata — tokenURI
//   - pages/NftDetail — ownerOf
// -----------------------------------------------------------

export function contractRefused(error) {
  return Boolean(error?.walk?.((cause) => (
    cause instanceof ContractFunctionRevertedError || cause instanceof ContractFunctionZeroDataError
  )));
}







// -----------------------------------------------------------
// waitForReceipt
// -----------------------------------------------------------
//
// The receipt of a sent transaction, asked for through the
// given viem client every couple of seconds until it is
// mined. Only "not mined yet" is waited out: any other
// failure — the relay down after viem's own retries — is
// thrown at once, so the page can say it cannot confirm the
// transaction instead of waiting for ever.
//
// Used by:
//   - pages/SellNft — the approval before a listing, and a
//     withdrawal
// -----------------------------------------------------------

export async function waitForReceipt(client, hash) {
  for (;;) {
    try {
      return await client.getTransactionReceipt({ hash });
    } catch (error) {
      if (!(error instanceof TransactionReceiptNotFoundError)) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, RECEIPT_POLL_MS));
  }
}
