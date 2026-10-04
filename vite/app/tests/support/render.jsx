// -----------------------------------------------------------
//  [*] Test support — rendering with the app's providers
//
//  Pages and components are rendered the way main.jsx frames
//  them in production, so nothing in a test is fed a context
//  the real app would not provide:
//
//    WagmiProvider        — a wagmi config built exactly as
//                           main.jsx's bootstrap builds it:
//                           Sepolia only, reads through the
//                           runtime config's RPC relay URL,
//                           the injected connector (and, as in
//                           the browser, the EIP-6963 wallets
//                           it discovers)
//    QueryClientProvider  — one TanStack client per render,
//                           retries off and no cache kept (the
//                           retry policy of main.jsx is not the
//                           subject of a page test); wagmi's
//                           reads run on it too
//    MemoryRouter         — for renderPage: starts at `route`,
//                           with the page mounted on the route
//                           PATTERN (`path`) so useParams gives
//                           it its :nftAddress / :tokenId
//    Toaster              — the toast outlet App.jsx renders,
//                           so a page's toasts reach the screen
//
//  renderPage puts that frame around any element; renderApp
//  mounts the REAL App.jsx instead — its own BrowserRouter,
//  header, footer, toast outlet and every route — started at
//  a route through the History API. Both put a test-net error
//  boundary around what they render (App.jsx has none of its
//  own: a crash there blanks the whole page), so a crash fails
//  its test with the real message — and the page's chrome is
//  gone, exactly as it would be for the student.
//
//  Used by:
//    - every component and page test
// -----------------------------------------------------------

import { Component } from 'react';
import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { WagmiProvider, createConfig, http } from 'wagmi';
import { sepolia } from 'wagmi/chains';
import { injected } from 'wagmi/connectors';
import { Toaster } from 'react-hot-toast';
import { getConfig } from '@/config';
import App from '@/App';







// -----------------------------------------------------------
// makeQueryClient
// -----------------------------------------------------------
//
// A client whose failures surface at once: no retries (a page
// under test must show its error state on the first answer),
// zero retry delay for queries that set their own retry count,
// no garbage-collection wait so a test leaves nothing behind.
//
// Used by:
//   - renderPage, renderApp (below)
// -----------------------------------------------------------

export function makeQueryClient(overrides = {}) {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, retryDelay: 0, gcTime: 0, ...overrides },
      mutations: { retry: false },
    },
  });
}







// -----------------------------------------------------------
// makeWagmiConfig
// -----------------------------------------------------------
//
// The wagmi config main.jsx's bootstrap builds from the
// runtime config — the structural test checks the two stay
// the same. Built per render, after setup.js has loaded the
// runtime config.
//
// Used by:
//   - renderPage, renderApp (below)
// -----------------------------------------------------------

export function makeWagmiConfig() {
  return createConfig({
    chains: [sepolia],
    transports: {
      [sepolia.id]: http(getConfig().rpcUrl),
    },
    connectors: [injected()],
  });
}







// -----------------------------------------------------------
// TestErrorBoundary
// -----------------------------------------------------------
//
// Catches a render-time throw of what it wraps and shows it
// as "render crashed: <message>" — so a page that cannot cope
// with an answer fails its test with the real message instead
// of an uncaught exception from deep inside React
// (contract.js' expectNoCrash reads it).
//
// Used by:
//   - renderPage, renderApp (below)
// -----------------------------------------------------------

export class TestErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return <div data-testid="render-crashed">render crashed: {String(this.state.error?.message ?? this.state.error)}</div>;
    }
    return this.props.children;
  }
}







// -----------------------------------------------------------
// Providers
// -----------------------------------------------------------
//
// main.jsx's provider stack — wagmi outside, the query client
// inside — around `children`.
//
// Used by:
//   - renderPage, renderApp (below)
// -----------------------------------------------------------

function Providers({ wagmiConfig, client, children }) {
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={client}>
        {children}
      </QueryClientProvider>
    </WagmiProvider>
  );
}







// -----------------------------------------------------------
// renderPage
// -----------------------------------------------------------
//
// Renders an element inside the production frame (see the
// header) and returns Testing Library's result plus the query
// client, the wagmi config and a userEvent instance. The
// frame is Testing Library's `wrapper`, so a rerender keeps
// it — and the page's state — and only swaps the element.
//
// `route` is the memory router's initial entry, "/" unless
// the test names another. `path` is the route pattern the
// element is mounted on, so useParams reads its params from
// the route; without it the element is rendered directly
// inside the router. `client` and `wagmi` are a prepared
// QueryClient and wagmi config — fresh ones otherwise.
//
// Used by:
//   - component and page tests
// -----------------------------------------------------------

export function renderPage(ui, { route = '/', path, client, wagmi } = {}) {
  const queryClient = client ?? makeQueryClient();
  const wagmiConfig = wagmi ?? makeWagmiConfig();
  const user = userEvent.setup();

  const Frame = ({ children }) => (
    <Providers wagmiConfig={wagmiConfig} client={queryClient}>
      <MemoryRouter initialEntries={[route]}>
        <Toaster />
        <TestErrorBoundary>{children}</TestErrorBoundary>
      </MemoryRouter>
    </Providers>
  );
  const mounted = (element) => (path ? <Routes><Route path={path} element={element} /></Routes> : element);

  const result = render(mounted(ui), { wrapper: Frame });

  return { ...result, rerender: (next) => result.rerender(mounted(next)), queryClient, wagmiConfig, user };
}







// -----------------------------------------------------------
// renderApp
// -----------------------------------------------------------
//
// The whole application: App.jsx with its own BrowserRouter,
// header, footer and toast outlet, the location moved to
// `route` first (history.replaceState — jsdom keeps the
// origin). Only the providers come from here, as main.jsx
// provides them in production.
//
// Used by:
//   - App / routing tests, the route sweep, page smoke tests
// -----------------------------------------------------------

export function renderApp({ route = '/', client, wagmi } = {}) {
  window.history.replaceState(null, '', route);
  const queryClient = client ?? makeQueryClient();
  const wagmiConfig = wagmi ?? makeWagmiConfig();
  const user = userEvent.setup();

  const result = render(
    <Providers wagmiConfig={wagmiConfig} client={queryClient}>
      <TestErrorBoundary>
        <App />
      </TestErrorBoundary>
    </Providers>
  );

  return { ...result, queryClient, wagmiConfig, user };
}
