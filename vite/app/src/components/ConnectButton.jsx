// -----------------------------------------------------------
//  [*] ConnectButton — self-reliant wallet connection
//
//  The whole wallet UX in one pill, no RainbowKit, no
//  WalletConnect cloud, no project ids — just wagmi talking
//  to the browser's injected provider (MetaMask). Four
//  states, checked in order:
//
//    no extension  → "Install MetaMask" link
//    disconnected  → "Connect Wallet" (fires the injected
//                    connector)
//    wrong chain   → red "switch to Sepolia" (one-click
//                    switchChain)
//    connected     → balance + short address; clicking
//                    disconnects
//
//  Deliberately teachable: this file is everything it takes
//  to talk to window.ethereum.
// -----------------------------------------------------------

import { useAccount, useConnect, useDisconnect, useBalance, useSwitchChain } from 'wagmi';
import { sepolia } from 'wagmi/chains';
import { formatEther } from 'viem';
import { truncateAddress } from '@/utils/format';


// The shared pill shape; each state appends its colours
const PILL = 'px-4 py-2 rounded-full text-sm font-semibold transition-colors ';
const PILL_LIGHT = PILL + 'bg-white text-[var(--color-primary)] border border-gray-300 hover:bg-gray-100';








// -----------------------------------------------------------
// ConnectButton (default export)
// -----------------------------------------------------------
//
// Used by:
//   - components/Header — the top bar
//   - components/ConnectPrompt — every page's wallet gate
// -----------------------------------------------------------

export default function ConnectButton() {

  const { address, isConnected, chain } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain } = useSwitchChain();
  const { data: balance } = useBalance({ address });


  if (typeof window !== 'undefined' && !window.ethereum && !isConnected) {
    return (
      <a
        href="https://metamask.io/download/"
        target="_blank"
        rel="noopener noreferrer"
        className={PILL_LIGHT}
      >
        Install MetaMask
      </a>
    );
  }


  if (!isConnected) {
    return (
      <button
        onClick={() => connect({ connector: connectors[0] })}
        disabled={isPending}
        className={PILL_LIGHT + ' disabled:opacity-60'}
      >
        {isPending ? 'Connecting…' : 'Connect Wallet'}
      </button>
    );
  }


  if (chain?.id !== sepolia.id) {
    return (
      <button
        onClick={() => switchChain({ chainId: sepolia.id })}
        className={PILL + 'bg-red-600 text-white hover:bg-red-700'}
      >
        Wrong network — switch to Sepolia
      </button>
    );
  }


  return (
    <button onClick={() => disconnect()} title="Disconnect" className={PILL_LIGHT + ' font-mono'}>
      {balance ? `${Number(formatEther(balance.value)).toFixed(4)} ETH · ` : ''}{truncateAddress(address)}
    </button>
  );
}
