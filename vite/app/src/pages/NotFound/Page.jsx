// -----------------------------------------------------------
//  [*] NotFound — an address no route knows
//
//  The catch-all page: a mistyped or outdated address gets a
//  plain "Page not found" inside the usual shell, with the
//  way back, instead of an empty page. Needs no wallet and
//  reads nothing.
//
//  Used by:
//    - App.jsx — the catch-all route
// -----------------------------------------------------------

import { useLocation } from 'react-router-dom';
import BackLink from '@/components/BackLink';







// -----------------------------------------------------------
// NotFoundPage (default export)
// -----------------------------------------------------------
//
// Names the address the student asked for, so a typo is easy
// to spot.
//
// Used by:
//   - App.jsx — route "*"
// -----------------------------------------------------------

export default function NotFoundPage() {

  const { pathname } = useLocation();


  return (
    <div className="container mx-auto max-w-7xl px-4 py-16 text-center">
      <h1 className="text-3xl font-bold tracking-tight mb-2">Page not found</h1>
      <p className="text-gray-600 mb-8">
        There is no page at <span className="font-mono break-all">{pathname}</span>.
      </p>
      <BackLink />
    </div>
  );
}
