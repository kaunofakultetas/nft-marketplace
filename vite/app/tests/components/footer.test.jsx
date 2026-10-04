// -----------------------------------------------------------
//  [*] Tests — Footer
//
//  The burgundy bottom bar: one copyright line, the page's
//  contentinfo landmark.
// -----------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderPage } from '../support/render';
import Footer from '@/components/Footer';







// -----------------------------------------------------------
// Footer
// -----------------------------------------------------------
//
// The bottom bar: the page's contentinfo landmark with the
// copyright line, nothing to click.
// -----------------------------------------------------------

describe('Footer', () => {

  it('is the page\'s contentinfo landmark and carries the copyright line', () => {
    renderPage(<Footer />);
    expect(screen.getByRole('contentinfo')).toHaveTextContent(/^Copyright © \| All Rights Reserved \| VUKnF$/);
  });


  it('holds nothing to click', () => {
    renderPage(<Footer />);
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });
});
