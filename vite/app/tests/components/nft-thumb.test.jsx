// -----------------------------------------------------------
//  [*] Tests — NftThumb (a token's mini identity in the feed)
//
//  The activity feed's answer to "WHICH NFT was that?": a
//  link to the token's own page holding a small square — a
//  pulse while the metadata resolves, the image (decoration,
//  the name says it all) once it is in, a warning sign for a
//  wrongly minted token — then the name (the token's own
//  "NFT #id" when there is none to read) and the id. The
//  link's hover text is the collection address, or the
//  token's diagnosis.
// -----------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderPage } from '../support/render';
import { given } from '../support/backend/server';
import { LocationProbe, currentPath } from '../support/shell/router';
import { DIAGNOSES, DIAGNOSED_TOKENS } from '../support/diagnoses';
import * as f from '../support/backend/fixtures';
import NftThumb from '@/components/NftThumb';


const renderThumb = (nftAddress, tokenId) => renderPage(<><NftThumb nftAddress={nftAddress} tokenId={tokenId} /><LocationProbe /></>);

const thumb = () => screen.getByRole('link');







// -----------------------------------------------------------
// NftThumb
// -----------------------------------------------------------

describe('NftThumb', () => {

  it('links to the token\'s own page, the collection address on hover', async () => {
    const { user } = renderThumb(f.PUGS, '0');
    expect(thumb()).toHaveAttribute('href', `/nft/${f.PUGS}/0`);
    expect(thumb()).toHaveAttribute('title', f.PUGS);
    await user.click(thumb());
    expect(currentPath()).toBe(`/nft/${f.PUGS}/0`);
  });


  it('pulses, named by the token\'s id, while the metadata resolves', async () => {
    given.hang('get', '/ipfs/*');
    renderThumb(f.PUGS, '0');
    expect(thumb()).toHaveTextContent('NFT #0#0');
    expect(thumb().querySelector('img')).toBeNull();
  });


  it('shows the image as decoration, the name and the id once the metadata is in', async () => {
    renderThumb(f.PUGS, '2');
    expect(await within(thumb()).findByText('PUG')).toBeInTheDocument();
    expect(within(thumb()).getByText('#2')).toBeInTheDocument();
    const image = thumb().querySelector('img');
    expect(image).toHaveAttribute('src', f.PUG_IMAGE_URL);
    expect(image).toHaveAttribute('alt', '');
  });


  it.each(Object.keys(DIAGNOSED_TOKENS))('shows a warning sign for a wrongly minted token (%s), its diagnosis on hover', async (key) => {
    const { nftAddress, tokenId, name } = DIAGNOSED_TOKENS[key];
    renderThumb(nftAddress, tokenId);
    expect(await within(thumb()).findByText('⚠')).toBeInTheDocument();
    expect(thumb()).toHaveAttribute('title', DIAGNOSES[key].message);
    expect(thumb()).toHaveTextContent(`⚠${name}#${tokenId}`);
    expect(thumb().querySelector('img')).toBeNull();
  });
});
