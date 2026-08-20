import { describe, expect, it } from 'vitest';
import { authCallbackError, buildFreshAuthUrl, buildMagicLinkRedirect, hasAuthCallback } from './authCallback';

describe('authentication callback URLs', () => {
  it('recognizes token and PKCE callbacks', () => {
    expect(hasAuthCallback(new URL('https://example.com/app/#access_token=token&refresh_token=refresh'))).toBe(true);
    expect(hasAuthCallback(new URL('https://example.com/app/?code=authorization-code'))).toBe(true);
    expect(hasAuthCallback(new URL('https://example.com/app/'))).toBe(false);
  });

  it('turns callback failures into a useful sign-in error', () => {
    const url = new URL('https://example.com/app/#error=access_denied&error_code=otp_expired');
    expect(authCallbackError(url)).toContain('expired or was already used');
  });

  it('creates a clean, uniquely cache-busted URL after authentication', () => {
    const url = new URL('https://example.com/app/?code=secret#access_token=secret');
    expect(buildFreshAuthUrl(url, 123)).toBe('https://example.com/app/?_auth=123');
  });

  it('makes every requested magic-link redirect unique', () => {
    expect(buildMagicLinkRedirect('https://example.com', '/app/', 456)).toBe('https://example.com/app/?_login=456');
  });
});
