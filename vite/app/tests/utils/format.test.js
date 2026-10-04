// -----------------------------------------------------------
//  [*] Tests — the display helpers (utils/format.js)
//
//  The transforms every page shares: an address shortened to
//  its two recognizable ends, a wei amount read and shown in
//  ether — anything that is no amount read as none, never a
//  throw while a page renders — the Sepolia Etherscan links
//  scattered around on purpose, THE one date format of the GUI
//  (local time, zero-padded, in the viewer's own time zone —
//  summer and winter time, a year boundary, another zone), and
//  formatWalletError, which boils a multi-hundred-character
//  wallet or RPC dump down to a toast-sized sentence: viem's
//  short message over the full one, the first line only —
//  with the line it announces when it ends in a colon, the
//  way viem gives a revert's reason — at most 140
//  characters, and one friendly sentence for every
//  way a student can press "Reject" — the error code, viem's
//  words, MetaMask's own.
// -----------------------------------------------------------

import { describe, it, expect, vi } from 'vitest';
import { UserRejectedRequestError, ContractFunctionExecutionError, ContractFunctionRevertedError } from 'viem';
import * as f from '../support/backend/fixtures';
import { truncateAddress, parseWei, formatEth, etherscanAddressUrl, etherscanTxUrl, formatDateTime, formatWalletError } from '@/utils/format';


const REJECTED = 'Transaction rejected in the wallet.';
const FALLBACK = 'Failed to buy NFT. Please try again.';







// -----------------------------------------------------------
// truncateAddress
// -----------------------------------------------------------
//
// An address shortened to its two ends, its case kept — and
// nothing for no address, or for one that is no text.
// -----------------------------------------------------------

describe('truncateAddress', () => {

  it('keeps the first six and the last four characters around three dots', () => {
    expect(truncateAddress(f.STUDENT)).toBe('0x519c...00a5');
  });


  it('keeps the case it is given — a checksummed address stays checksummed', () => {
    expect(truncateAddress(f.checksummed(f.STUDENT))).toBe('0x519C...00A5');
  });


  it.each([
    ['undefined', undefined],
    ['null', null],
    ['an empty string', ''],
  ])('shows nothing for %s — a row without an actor stays blank', (_, value) => {
    expect(truncateAddress(value)).toBe('');
  });


  it.each([
    ['a number', 1234567890],
    ['an object', { address: f.STUDENT }],
  ])('shows nothing for %s in a malformed answer, rather than throwing', (_, value) => {
    expect(truncateAddress(value)).toBe('');
  });
});







// -----------------------------------------------------------
// parseWei / formatEth
// -----------------------------------------------------------
//
// Amounts read as whole wei — anything else as no amount —
// and shown in ether the way ethers renders them.
// -----------------------------------------------------------

describe('parseWei / formatEth', () => {

  it.each([
    ['the backend\'s decimal string', '50000000000000000', 50000000000000000n],
    ['a bigint from the chain', 30000000000000000n, 30000000000000000n],
    ['a whole number', 5e16, 50000000000000000n],
    ['zero', '0', 0n],
    ['an amount beyond 64 bits', '1000000000000000000000000000001', 1000000000000000000000000000001n],
  ])('reads %s as a bigint', (_, value, wei) => {
    expect(parseWei(value)).toBe(wei);
  });


  it.each([
    ['undefined', undefined],
    ['null', null],
    ['an empty string', ''],
    ['text that is no number', '💾 <script>alert(1)</script>'],
    ['a decimal', '0.05'],
    ['a negative amount', '-1'],
    ['a negative bigint', -1n],
    ['a fraction of a wei', 1.5],
    ['an object', { wei: '1' }],
  ])('reads %s as no amount at all', (_, value) => {
    expect(parseWei(value)).toBeNull();
    expect(formatEth(value)).toBeNull();
  });


  it('shows ether the way ethers renders it — one decimal at least, every wei kept', () => {
    expect(formatEth('50000000000000000')).toBe('0.05');
    expect(formatEth(10n ** 18n)).toBe('1.0');
    expect(formatEth('0')).toBe('0.0');
    expect(formatEth('1000000000000000001')).toBe('1.000000000000000001');
  });
});







// -----------------------------------------------------------
// The Etherscan links
// -----------------------------------------------------------
//
// The links to an address's page and a transaction's page on
// Sepolia Etherscan.
// -----------------------------------------------------------

describe('etherscanAddressUrl / etherscanTxUrl', () => {

  it('links an address to its page on Sepolia Etherscan', () => {
    expect(etherscanAddressUrl(f.MARKETPLACE)).toBe(`https://sepolia.etherscan.io/address/${f.MARKETPLACE}`);
  });


  it('links a transaction to its page on Sepolia Etherscan', () => {
    expect(etherscanTxUrl(f.TX.pug2Bought)).toBe(`https://sepolia.etherscan.io/tx/${f.TX.pug2Bought}`);
  });
});







// -----------------------------------------------------------
// formatDateTime
// -----------------------------------------------------------
//
// setup.js puts every test in Europe/Vilnius; the zone tests
// stub another.
// -----------------------------------------------------------

describe('formatDateTime', () => {

  it('writes a block time as "YYYY-MM-DD HH:MM:SS" in the viewer\'s time zone — Vilnius summer time', () => {
    expect(formatDateTime(f.timeOf(9712915))).toBe('2026-09-22 12:56:20');
  });


  it('zero-pads every field', () => {
    expect(formatDateTime(1767575045)).toBe('2026-01-05 03:04:05');
  });


  it('follows the zone into winter time', () => {
    expect(formatDateTime(1796119200)).toBe('2026-12-01 12:00:00');
  });


  it('puts a moment just after midnight on the new year\'s date, as Vilnius saw it', () => {
    expect(formatDateTime(1767220200)).toBe('2026-01-01 00:30:00');
  });


  it.each([
    ['UTC', '2026-09-22 09:56:20'],
    ['America/New_York', '2026-09-22 05:56:20'],
    ['Asia/Tokyo', '2026-09-22 18:56:20'],
  ])('shows the same block at its local time in %s', (zone, text) => {
    vi.stubEnv('TZ', zone);
    expect(formatDateTime(f.timeOf(9712915))).toBe(text);
  });


  it.each([
    ['undefined', undefined],
    ['null', null],
    ['zero', 0],
  ])('shows nothing for %s — a block the indexer has no time for', (_, value) => {
    expect(formatDateTime(value)).toBe('');
  });
});







// -----------------------------------------------------------
// formatWalletError
// -----------------------------------------------------------
//
// A wallet or RPC dump boiled down to a toast: the short
// message, the first line with the one it announces, capped
// at 140 — and one sentence for every way to reject.
// -----------------------------------------------------------

describe('formatWalletError', () => {

  it('falls back to the caller\'s sentence when there is no error at all', () => {
    expect(formatWalletError(null, FALLBACK)).toBe(FALLBACK);
    expect(formatWalletError(undefined, FALLBACK)).toBe(FALLBACK);
  });


  it('falls back to the caller\'s sentence when the error carries no words', () => {
    expect(formatWalletError({}, FALLBACK)).toBe(FALLBACK);
  });


  it('prefers viem\'s short message to the full dump', () => {
    const error = { shortMessage: 'The contract function "buyListing" reverted.', message: 'The contract function "buyListing" reverted.\n\nContract Call:\n  address: 0x190d…' };
    expect(formatWalletError(error, FALLBACK)).toBe('The contract function "buyListing" reverted.');
  });


  it('keeps only the first line, trimmed', () => {
    expect(formatWalletError({ message: '  insufficient funds for gas * price + value  \nRequest Arguments:\n  from: 0x519c…' }, FALLBACK))
      .toBe('insufficient funds for gas * price + value');
  });


  it('caps the line at 140 characters with an ellipsis — and leaves one of exactly 140 alone', () => {
    const long = 'x'.repeat(141);
    expect(formatWalletError({ message: long }, FALLBACK)).toBe(`${'x'.repeat(140)}…`);
    expect(formatWalletError({ message: 'y'.repeat(140) }, FALLBACK)).toBe('y'.repeat(140));
  });


  it.each([
    ['the EIP-1193 code 4001, whatever the words', { code: 4001, message: 'Something else entirely' }],
    ['viem\'s "User rejected the request."', { shortMessage: 'User rejected the request.' }],
    ['MetaMask\'s "User denied transaction signature."', { message: 'MetaMask Tx Signature: User denied transaction signature.' }],
    ['the words in another case', { message: 'USER REJECTED the transaction' }],
  ])('says "Transaction rejected in the wallet." for %s', (_, error) => {
    expect(formatWalletError(error, FALLBACK)).toBe(REJECTED);
  });


  it('recognises the rejection inside a real viem error, wrapped the way writeContract wraps it', () => {
    const rejected = new UserRejectedRequestError(new Error('MetaMask Tx Signature: User denied transaction signature.'));
    const wrapped = new ContractFunctionExecutionError(rejected, { abi: [], functionName: 'buyListing' });
    expect(formatWalletError(wrapped, FALLBACK)).toBe(REJECTED);
  });


  it('boils a real viem revert without a reason down to viem\'s one sentence', () => {
    const reverted = new ContractFunctionRevertedError({ abi: [], functionName: 'withdrawProceeds', message: 'execution reverted' });
    const wrapped = new ContractFunctionExecutionError(reverted, { abi: [], functionName: 'withdrawProceeds' });
    expect(formatWalletError(wrapped, FALLBACK)).toBe('The contract function "withdrawProceeds" reverted.');
  });


  it('keeps the reason of a revert that gives one, which viem puts on the line after its sentence', () => {
    const reason = 'ERC721: approve caller is not token owner or approved for all';
    const reverted = new ContractFunctionRevertedError({ abi: [], functionName: 'approve', message: reason });
    const wrapped = new ContractFunctionExecutionError(reverted, { abi: [], functionName: 'approve' });
    expect(formatWalletError(wrapped, FALLBACK)).toContain(reason);
  });
});
