// -----------------------------------------------------------
//  [*] Entry point — loads runtime config, mounts the app
//
//  Startup is TWO steps: await GET /api/config (config.js),
//  THEN build the provider stack from those values and render
//  <App /> into #root. Nothing renders before the config is
//  in — every module below the root may call getConfig()
//  synchronously.
//
//  Provider stack — deliberately SELF-RELIANT, no wallet
//  cloud services, no project ids:
//    - WagmiProvider       — plain wagmi, Sepolia only, the
//                            injected connector (MetaMask),
//                            reads through the /api/rpc relay
//    - QueryClientProvider — wagmi internals + every /api
//      read the pages make
//
//  While the backend is down, the config fetch fails and
//  ConfigError renders instead of the app.
//
//  Split into (no root component — this is the entry file):
//
//    ConfigError — full-page "backend unavailable" notice
//    bootstrap   — config → providers → render
// -----------------------------------------------------------

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { WagmiProvider, createConfig, http } from 'wagmi';
import { sepolia } from 'wagmi/chains';
import { injected } from 'wagmi/connectors';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { loadConfig } from '@/config';
import App from '@/App';
import './index.css';


// -----------------------------------------------------------
// ConfigError
// -----------------------------------------------------------
//
// Rendered instead of the app when GET /api/config fails —
// the nft-backend container is down or unreachable.
//
// Used by:
//   - bootstrap (below)
// -----------------------------------------------------------

function ConfigError({ message }) {
  return (
    <div className="flex flex-col gap-4 justify-center items-center h-screen text-center px-8">
      <div className="text-2xl font-bold">Backend unavailable</div>
      <div className="text-gray-600">
        Could not load the runtime configuration from <span className="font-mono">/api/config</span>.
      </div>
      <div className="text-sm text-gray-400 font-mono">{message}</div>
      <button
        onClick={() => window.location.reload()}
        className="text-white bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] font-medium rounded-lg px-6 py-2.5 mt-2"
      >
        Retry
      </button>
    </div>
  );
}


// -----------------------------------------------------------
// bootstrap
// -----------------------------------------------------------
//
// Awaits the runtime config, then builds the wagmi config
// FROM it — that is why it cannot be a module-level
// constant — and renders the provider stack around <App />.
//
// Used by:
//   - the module's last line — runs immediately on load
// -----------------------------------------------------------

async function bootstrap() {
  const root = createRoot(document.getElementById('root'));

  let config;
  try {
    config = await loadConfig();
  } catch (error) {
    root.render(<ConfigError message={error.message} />);
    return;
  }


  // Plain wagmi: the injected connector (MetaMask) for
  // signing, the backend's RPC relay for reads
  const wagmiConfig = createConfig({
    chains: [sepolia],
    transports: {
      [sepolia.id]: http(config.rpcUrl),
    },
    connectors: [injected()],
  });


  const queryClient = new QueryClient();

  root.render(
    <StrictMode>
      <WagmiProvider config={wagmiConfig}>
        <QueryClientProvider client={queryClient}>
          <App />
        </QueryClientProvider>
      </WagmiProvider>
    </StrictMode>,
  );
}

bootstrap();
