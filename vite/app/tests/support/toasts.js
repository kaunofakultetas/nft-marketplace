// -----------------------------------------------------------
//  [*] Test support — reading the toasts
//
//  The marketplace narrates every wallet step in react-hot-toast
//  toasts: a status region per toast, its message as text,
//  stacked in the outlet App.jsx renders (renderPage puts one
//  in its frame too). Toasts live in a module-level store —
//  setup.js removes them after every test.
//
//  Used by:
//    - the page, modal and app tests that assert a toast
// -----------------------------------------------------------

import { screen, waitFor } from '@testing-library/react';
import { expect } from 'vitest';







// -----------------------------------------------------------
// toasts / toastSaying / waitForToasts
// -----------------------------------------------------------
//
// toasts reads the messages of every toast on screen in the
// order the outlet holds them — the newest first; toastSaying
// waits for the toast whose message is exactly the given text
// and returns its status region; waitForToasts waits until
// the messages on screen are exactly the given ones.
//
// Used by:
//   - the tests listed in the header
// -----------------------------------------------------------

export const toasts = () => screen.queryAllByRole('status').map((toast) => toast.textContent);

export async function toastSaying(text) {
  const message = await screen.findByText(text);
  const toast = message.closest('[role="status"]');
  if (!toast) throw new Error(`"${text}" is on screen, but not in a toast`);
  return toast;
}

export async function waitForToasts(expected) {
  await waitFor(() => expect(toasts()).toEqual(expected));
}
