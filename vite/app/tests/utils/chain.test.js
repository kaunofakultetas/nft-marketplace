// -----------------------------------------------------------
//  [*] Tests — the chain helpers (utils/chain.js)
//
//  contractRefused tells the contract's own answer — a revert,
//  or no contract at the address — from the way to the chain
//  failing, through the wrapping wagmi hands viem's error
//  over in; only the first says anything about the token.
//  waitForReceipt asks for a transaction's receipt until it is
//  mined, waiting out only "not mined yet": any other failure
//  — the relay down — ends the wait at once instead of leaving
//  the page waiting for ever. A stand-in client answers, the
//  clock is faked.
// -----------------------------------------------------------

import { describe, it, expect, vi } from 'vitest';
import {
  ContractFunctionExecutionError,
  ContractFunctionRevertedError,
  ContractFunctionZeroDataError,
  HttpRequestError,
  TransactionReceiptNotFoundError,
} from 'viem';
import * as f from '../support/backend/fixtures';
import { contractRefused, waitForReceipt } from '@/utils/chain';


// A transaction of the story, and the receipt it gets mined in
const HASH = f.TX.pug2Bought;
const RECEIPT = { transactionHash: HASH, status: 'success' };

// A read's failure as wagmi hands it over: viem's own error
// for the call, the cause inside it
const failedRead = (cause) => new ContractFunctionExecutionError(cause, { abi: [], functionName: 'tokenURI' });

const relayDown = () => new HttpRequestError({ url: 'http://localhost:3000/api/rpc', status: 502 });







// -----------------------------------------------------------
// contractRefused
// -----------------------------------------------------------

describe('contractRefused', () => {

  it('is the contract\'s own answer when it reverted', () => {
    expect(contractRefused(failedRead(new ContractFunctionRevertedError({ abi: [], functionName: 'tokenURI', message: 'execution reverted' })))).toBe(true);
  });


  it('is the contract\'s own answer when there is no contract at the address to answer', () => {
    expect(contractRefused(failedRead(new ContractFunctionZeroDataError({ functionName: 'tokenURI' })))).toBe(true);
  });


  it('is not when the relay failed on the way', () => {
    expect(contractRefused(failedRead(relayDown()))).toBe(false);
  });


  it.each([
    ['no error at all', undefined],
    ['an error that is no viem error', new Error('Failed to fetch')],
  ])('is not for %s', (_, error) => {
    expect(contractRefused(error)).toBe(false);
  });
});







// -----------------------------------------------------------
// waitForReceipt
// -----------------------------------------------------------

describe('waitForReceipt', () => {

  it('asks every two seconds until the transaction is mined, then hands back its receipt', async () => {
    vi.useFakeTimers();
    const notYet = () => { throw new TransactionReceiptNotFoundError({ hash: HASH }); };
    const client = { getTransactionReceipt: vi.fn().mockImplementationOnce(notYet).mockImplementationOnce(notYet).mockResolvedValue(RECEIPT) };

    const waiting = waitForReceipt(client, HASH);
    await vi.advanceTimersByTimeAsync(1999);
    expect(client.getTransactionReceipt).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2001);
    await expect(waiting).resolves.toBe(RECEIPT);
    expect(client.getTransactionReceipt).toHaveBeenCalledTimes(3);
    expect(client.getTransactionReceipt).toHaveBeenCalledWith({ hash: HASH });
  });


  it('hands back a reverted transaction\'s receipt as it is — reading its status is the caller\'s business', async () => {
    const reverted = { ...RECEIPT, status: 'reverted' };
    await expect(waitForReceipt({ getTransactionReceipt: async () => reverted }, HASH)).resolves.toBe(reverted);
  });


  it('gives up at once when the relay fails — no waiting for ever', async () => {
    const failure = relayDown();
    const client = { getTransactionReceipt: vi.fn().mockRejectedValue(failure) };
    await expect(waitForReceipt(client, HASH)).rejects.toBe(failure);
    expect(client.getTransactionReceipt).toHaveBeenCalledTimes(1);
  });
});
