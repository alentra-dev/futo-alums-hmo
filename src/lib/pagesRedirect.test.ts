import { describe, expect, it } from 'vitest';
import { getPagesRedirect } from './pagesRedirect';

describe('getPagesRedirect', () => {
  it('restores a route under the GitHub Pages base path', () => {
    expect(getPagesRedirect(
      'https://alentra-dev.github.io/futo-alums-hmo/join?source=whatsapp#apply',
      'https://alentra-dev.github.io',
      '/futo-alums-hmo/',
    )).toBe('/futo-alums-hmo/join?source=whatsapp#apply');
  });

  it('rejects redirects to another origin', () => {
    expect(getPagesRedirect(
      'https://example.com/futo-alums-hmo/join',
      'https://alentra-dev.github.io',
      '/futo-alums-hmo/',
    )).toBeNull();
  });

  it('rejects routes outside the application base path', () => {
    expect(getPagesRedirect(
      'https://alentra-dev.github.io/another-project',
      'https://alentra-dev.github.io',
      '/futo-alums-hmo/',
    )).toBeNull();
  });
});
