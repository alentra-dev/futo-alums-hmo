import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Records today's portal visit for the signed-in account. Supabase query builders are lazy:
 * the request is sent only when the builder is awaited, so `void supabase.rpc(...)` silently
 * sends nothing (which left portal activity empty from 26 Aug to 22 Oct 2026). Failures are
 * logged, never thrown, because activity tracking must not block the portal.
 */
export async function recordPortalSignIn(client: Pick<SupabaseClient, 'rpc'>) {
  try {
    const { error } = await client.rpc('record_portal_sign_in');
    if (error) console.warn('Portal activity was not recorded:', error.message);
  } catch (reason) {
    console.warn('Portal activity was not recorded:', reason instanceof Error ? reason.message : reason);
  }
}
