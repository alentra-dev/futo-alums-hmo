const AUTH_CALLBACK_KEYS = ['access_token', 'refresh_token', 'code'];

function parameters(url: URL) {
  const hash = new URLSearchParams(url.hash.replace(/^#/, ''));
  return [url.searchParams, hash];
}

export function hasAuthCallback(url: URL) {
  return parameters(url).some((params) => AUTH_CALLBACK_KEYS.some((key) => params.has(key)));
}

export function authCallbackError(url: URL) {
  for (const params of parameters(url)) {
    if (params.has('error') || params.has('error_code') || params.has('error_description')) {
      return 'This sign-in link has expired or was already used. Request a new secure sign-in link below.';
    }
  }
  return null;
}

export function buildFreshAuthUrl(url: URL, marker = Date.now()) {
  const fresh = new URL(url);
  fresh.hash = '';
  fresh.searchParams.delete('code');
  fresh.searchParams.delete('error');
  fresh.searchParams.delete('error_code');
  fresh.searchParams.delete('error_description');
  fresh.searchParams.set('_auth', String(marker));
  return fresh.toString();
}

export function buildMagicLinkRedirect(origin: string, basePath: string, marker = Date.now()) {
  const redirect = new URL(basePath, origin);
  redirect.searchParams.set('_login', String(marker));
  return redirect.toString();
}
