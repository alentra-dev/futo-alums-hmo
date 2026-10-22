import { describe, expect, it, vi } from 'vitest';
import { recordPortalSignIn } from './portalActivity';

// Mimics a PostgREST builder: nothing is sent until then() is called.
function lazyClient(result: { error: { message: string } | null } | Error) {
  const sent = vi.fn();
  const rpc = vi.fn(() => ({
    then(resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) {
      sent();
      return result instanceof Error ? Promise.reject(result).then(resolve, reject) : Promise.resolve(result).then(resolve, reject);
    },
  }));
  return { client: { rpc } as never, rpc, sent };
}

describe('portal activity recording', () => {
  it('actually sends the lazy request', async () => {
    const { client, rpc, sent } = lazyClient({ error: null });
    await recordPortalSignIn(client);
    expect(rpc).toHaveBeenCalledWith('record_portal_sign_in');
    expect(sent).toHaveBeenCalledTimes(1);
  });

  it.each([{ error: { message: 'denied' } }, new Error('offline')])('reports a failure without throwing', async (result) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await expect(recordPortalSignIn(lazyClient(result).client)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith('Portal activity was not recorded:', expect.stringMatching(/denied|offline/));
    warn.mockRestore();
  });
});
