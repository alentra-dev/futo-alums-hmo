export function getPagesRedirect(rawRedirect: string | null, origin: string, baseUrl: string) {
  if (!rawRedirect) return null;

  try {
    const target = new URL(rawRedirect);
    if (target.origin !== origin || !target.pathname.startsWith(baseUrl)) return null;
    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return null;
  }
}
