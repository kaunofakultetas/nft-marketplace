// -----------------------------------------------------------
//  [*] Test support — the MetaMask double (EIP-1193 + EIP-6963)
//
//  The SPA never meets a real wallet in this suite.
//  installMetamask puts an EIP-1193 provider — its request
//  method, on and removeListener — where wagmi's injected
//  connector looks for it, and answers like the extension
//  wherever the app depends on it:
//
//    - FOUND like MetaMask: on window.ethereum (vi.stubGlobal —
//      ConnectButton checks for it there) and announced
//      through EIP-6963 under rdns io.metamask on install and
//      on every eip6963:requestProvider — which is how wagmi
//      reconnects a site the student permitted before
//    - accounts: eth_accounts answers an empty list until the
//      site is permitted; wagmi's connect asks
//      wallet_requestPermissions first (eth_requestAccounts
//      for a wallet that lacks it) — the popup is approved by
//      default, declined (4001) or left open (hold / hang — a
//      second permissions request meanwhile is MetaMask's
//      -32002 "already pending"); wagmi's disconnect is
//      wallet_revokePermissions
//    - chains: eth_chainId in hex; wallet_switchEthereumChain
//      to a chain the wallet does not know is 4902;
//      wallet_addEthereumChain adds the chain and switches to
//      it, the way the extension's add-network popup does
//    - transactions: eth_sendTransaction from a permitted
//      account opens the confirmation (approved by default,
//      or "User denied transaction signature") and broadcasts
//      to the Sepolia double, which mines it; every sent
//      transaction is kept with its calldata decoded
//    - any other method is -32601, so a page calling something
//      new shows up in the call record instead of passing
//
//  Every call lands in wallet.calls. Any method can be made to
//  fail, to be declined, to hang, to wait for the test (hold,
//  then release or decline) or to answer something else; what
//  the student does inside the extension is changeAccounts /
//  changeChain / emit. Nothing here knows React — tests wrap
//  the moves that update state in act.
//
//  A double stops answering discovery requests once its test
//  has finished; the stubbed window.ethereum is undone by
//  setup.js.
//
//  Used by:
//    - components/connect-button.test.jsx
//    - the page and modal tests that need a connected student
// -----------------------------------------------------------

import { onTestFinished, vi } from 'vitest';
import * as f from '../backend/fixtures';
import { sepolia } from '../chain/sepolia';
import { TEST_ORIGIN } from '../location';


// Chain ids the tests move between — Sepolia, and Ethereum
// mainnet, which every wallet knows
export const MAINNET = 1;
export const SEPOLIA = f.SEPOLIA_CHAIN_ID;

// What MetaMask says when the student presses "Cancel" — on a
// connection or network popup, and on a transaction
export const USER_REJECTED = 'User rejected the request.';
export const TX_DENIED = 'MetaMask Tx Signature: User denied transaction signature.';

export const hexChain = (id) => `0x${Number(id).toString(16)}`;

// The popups MetaMask refuses to open twice for one site
const PERMISSION_PROMPTS = new Set(['eth_requestAccounts', 'wallet_requestPermissions']);

const WALLET_ICON = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg"/%3E';

let walletSerial = 0;







// -----------------------------------------------------------
// rpcError / userRejected
// -----------------------------------------------------------
//
// MetaMask's errors: an Error carrying the EIP-1193 `code`
// (and `data` when there is any) — wagmi and viem read the
// code, the toasts show what formatWalletError makes of the
// message. userRejected is the student's "Cancel", in the
// words MetaMask uses for the method that was refused.
//
// Used by:
//   - installMetamask (below), tests that script a failure
// -----------------------------------------------------------

export function rpcError(code, message, data) {
  const error = new Error(message);
  error.code = code;
  if (data !== undefined) error.data = data;
  return error;
}

export const userRejected = (method) => rpcError(4001, method === 'eth_sendTransaction' ? TX_DENIED : USER_REJECTED);







// -----------------------------------------------------------
// installMetamask
// -----------------------------------------------------------
//
// The wallet holds the student's account (STUDENT, lowercase
// as MetaMask hands accounts out) and the site is not yet
// permitted unless `connected` says it was permitted on an
// earlier visit. It sits on Sepolia and knows mainnet and
// Sepolia — always with the chain it sits on among them. It
// announces itself through EIP-6963 at once and on every
// request (false: never — a wallet found only on
// window.ethereum), and it sits on window.ethereum unless
// onWindow is turned off.
//
// A switch fires chainChanged and a change of the permitted
// accounts fires accountsChanged unless emitsChainChanged /
// emitsAccountsChanged are turned off.
//
// The handle it returns keeps the record: the provider and
// its EIP-6963 info, every call, the transactions sent, the
// chains added, and the wallet's chain, the accounts the site
// can see and the permission as they stand — with readers for
// the methods called, the calls to one method and the
// listeners of one event. It plays what the student does
// inside the extension: emit an event, change the accounts,
// change the chain (silently if asked).
//
// And it scripts deviations per method: fail with an error
// (an internal JSON-RPC error unless the test brings its
// own), decline, hang, answer through a function of the
// params, or hold the call until the test releases it — with
// the real answer or one of its own — or declines it. A hang
// stays until restore brings the real answers back, and so do
// fail, decline and answer unless limited to the next call
// (once); a hold catches only the next call and tells whether
// it came and with what params.
//
// Used by:
//   - the component, page and modal tests
// -----------------------------------------------------------

export function installMetamask({
  accounts = [f.STUDENT],
  connected = false,
  chainId = SEPOLIA,
  chains = [MAINNET, SEPOLIA],
  announce = true,
  onWindow = true,
  emitsChainChanged = true,
  emitsAccountsChanged = true,
} = {}) {

  const state = {
    accounts: accounts.map((a) => a.toLowerCase()),
    connected,
    chainId,
    known: new Set([...chains, chainId]),
  };

  const calls = [];
  const sent = [];
  const added = [];
  const listeners = new Map();
  const overrides = new Map();
  const pendingPrompts = new Set();


  // The extension's side: events, chain moves, the answers
  const emit = (event, payload) => {
    for (const listener of [...(listeners.get(event) ?? [])]) listener(payload);
  };

  const visibleAccounts = () => (state.connected ? [...state.accounts] : []);

  const permit = () => {
    const before = visibleAccounts().join();
    state.connected = state.accounts.length > 0;
    if (emitsAccountsChanged && visibleAccounts().join() !== before) emit('accountsChanged', visibleAccounts());
  };

  const moveTo = (id, { silently }) => {
    if (id === state.chainId) return;
    state.chainId = id;
    if (!silently) emit('chainChanged', hexChain(id));
  };

  const answers = {
    eth_accounts: () => visibleAccounts(),

    eth_requestAccounts: () => {
      permit();
      return visibleAccounts();
    },

    wallet_requestPermissions: () => {
      permit();
      return [{
        caveats: [{ type: 'restrictReturnedAccounts', value: visibleAccounts() }],
        date: Date.now(),
        id: `permission-${walletSerial}`,
        invoker: TEST_ORIGIN,
        parentCapability: 'eth_accounts',
      }];
    },

    wallet_revokePermissions: () => {
      const before = visibleAccounts().join();
      state.connected = false;
      if (emitsAccountsChanged && before !== '') emit('accountsChanged', []);
      return null;
    },

    eth_chainId: () => hexChain(state.chainId),

    wallet_switchEthereumChain: ([{ chainId: hex }] = [{}]) => {
      const id = parseInt(hex, 16);
      if (!state.known.has(id)) {
        throw rpcError(4902, `Unrecognized chain ID "${hex}". Try adding the chain using wallet_addEthereumChain first.`);
      }
      moveTo(id, { silently: !emitsChainChanged });
      return null;
    },

    wallet_addEthereumChain: ([chain] = []) => {
      added.push(chain);
      const id = parseInt(chain.chainId, 16);
      state.known.add(id);
      moveTo(id, { silently: !emitsChainChanged });
      return null;
    },

    eth_sendTransaction: ([transaction] = []) => {
      const from = String(transaction?.from ?? '').toLowerCase();
      if (!state.connected || !state.accounts.includes(from)) {
        throw rpcError(4100, 'The requested account and/or method has not been authorized by the user.');
      }
      const hash = sepolia.submit({ from, to: transaction.to, data: transaction.data, value: transaction.value });
      sent.push(sepolia.transactions.find((tx) => tx.hash === hash));
      return hash;
    },
  };

  const answer = (method, params) => {
    if (!answers[method]) throw rpcError(-32601, `The method "${method}" does not exist / is not available.`);
    return answers[method](params);
  };


  // A scripted deviation for one method: fail, hang, hold,
  // answer — `once` ones are used up by the next call
  const push = (method, override) => {
    overrides.set(method, [...(overrides.get(method) ?? []), override]);
  };

  const run = (override, method, params) => {
    if (override.kind === 'fail') throw override.error;
    if (override.kind === 'answer') return override.fn(params);
    if (PERMISSION_PROMPTS.has(method)) pendingPrompts.add('permissions');
    if (override.kind === 'hang') return new Promise(() => {});
    return override.begin(params);
  };

  async function request({ method, params } = {}) {
    calls.push({ method, params });
    if (PERMISSION_PROMPTS.has(method) && pendingPrompts.has('permissions')) {
      throw rpcError(-32002, `Request of type 'wallet_requestPermissions' already pending for origin ${TEST_ORIGIN}. Please wait.`);
    }
    const queue = overrides.get(method);
    const override = queue?.[0];
    if (override?.once) queue.shift();
    if (override) return run(override, method, params);
    return answer(method, params);
  }


  const provider = {
    isMetaMask: true,
    request,
    on(event, listener) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(listener);
      return provider;
    },
    removeListener(event, listener) {
      listeners.get(event)?.delete(listener);
      return provider;
    },
  };
  provider.addListener = provider.on;
  provider.off = provider.removeListener;


  // EIP-6963: announce now and on every request — until the
  // test is over, so the next test starts with no wallet
  walletSerial += 1;
  const info = Object.freeze({
    uuid: `00000000-0000-4000-8000-${String(walletSerial).padStart(12, '0')}`,
    name: 'MetaMask',
    icon: WALLET_ICON,
    rdns: 'io.metamask',
  });
  const announceProvider = () => {
    window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: Object.freeze({ info, provider }) }));
  };
  if (announce) {
    window.addEventListener('eip6963:requestProvider', announceProvider);
    onTestFinished(() => window.removeEventListener('eip6963:requestProvider', announceProvider));
    announceProvider();
  }


  const wallet = {
    provider,
    info,
    calls,
    sent,
    added,

    get chainId() { return state.chainId; },
    get accounts() { return visibleAccounts(); },
    get connected() { return state.connected; },

    methods: () => calls.map((call) => call.method),
    callsTo: (method) => calls.filter((call) => call.method === method),
    listenerCount: (event) => listeners.get(event)?.size ?? 0,

    emit,

    // The student's own moves inside the extension
    changeAccounts(next) {
      state.accounts = next.map((a) => a.toLowerCase());
      state.connected = next.length > 0;
      emit('accountsChanged', visibleAccounts());
    },
    changeChain(id, { silently = false } = {}) {
      state.known.add(id);
      moveTo(id, { silently });
    },

    // Scripted deviations
    fail(method, error = rpcError(-32603, 'Internal JSON-RPC error.'), { once = false } = {}) {
      push(method, { kind: 'fail', error, once });
      return wallet;
    },
    decline(method, { once = false } = {}) {
      return wallet.fail(method, userRejected(method), { once });
    },
    hang(method) {
      push(method, { kind: 'hang', once: false });
      return wallet;
    },
    hold(method) {
      let settle = null;
      const held = {
        called: false,
        params: undefined,
        release(value) {
          if (!settle) throw new Error(`${method} was never called — nothing to release`);
          settle('release', value);
        },
        decline(error = userRejected(method)) {
          if (!settle) throw new Error(`${method} was never called — nothing to decline`);
          settle('decline', error);
        },
      };
      push(method, {
        kind: 'hold',
        once: true,
        begin: (params) => new Promise((resolve, reject) => {
          held.called = true;
          held.params = params;
          settle = (how, value) => {
            pendingPrompts.delete('permissions');
            if (how === 'decline') {
              reject(value);
              return;
            }
            try {
              resolve(value === undefined ? answer(method, params) : value);
            } catch (error) {
              reject(error);
            }
          };
        }),
      });
      return held;
    },
    answer(method, fn, { once = false } = {}) {
      push(method, { kind: 'answer', fn, once });
      return wallet;
    },
    restore(method) {
      overrides.delete(method);
      pendingPrompts.delete('permissions');
      return wallet;
    },
  };


  if (onWindow) vi.stubGlobal('ethereum', provider);

  return wallet;
}
