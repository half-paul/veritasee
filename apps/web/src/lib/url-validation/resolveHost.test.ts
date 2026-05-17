import { describe, expect, it, vi } from 'vitest';

// Mock node:dns so we never hit a real resolver in unit tests.
vi.mock('node:dns', () => {
  const lookup = vi.fn();
  return {
    promises: { lookup },
    default: { promises: { lookup } },
  };
});

// Import after the mock so resolveHost picks up the mocked dns module.
import { promises as dns } from 'node:dns';
import { resolveHost } from './resolveHost';

describe('resolveHost', () => {
  it('returns the literal directly for IPv4 literals (no DNS call)', async () => {
    const result = await resolveHost('8.8.8.8');
    expect(result).toEqual({ ok: true, addresses: ['8.8.8.8'] });
    expect(dns.lookup).not.toHaveBeenCalled();
  });

  it('returns the literal directly for IPv6 literals (no DNS call)', async () => {
    const result = await resolveHost('2606:4700:4700::1111');
    expect(result).toEqual({ ok: true, addresses: ['2606:4700:4700::1111'] });
    expect(dns.lookup).not.toHaveBeenCalled();
  });

  it('returns every A/AAAA record from dns.lookup', async () => {
    vi.mocked(dns.lookup).mockResolvedValue([
      { address: '208.80.154.224', family: 4 },
      { address: '2620:0:861:ed1a::1', family: 6 },
    ] as never);
    const result = await resolveHost('en.wikipedia.org');
    expect(result).toEqual({
      ok: true,
      addresses: ['208.80.154.224', '2620:0:861:ed1a::1'],
    });
  });

  it('flattens dns errors into a non-throwing result', async () => {
    vi.mocked(dns.lookup).mockRejectedValue(
      Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' }) as never,
    );
    const result = await resolveHost('nonexistent.invalid');
    expect(result).toEqual({ ok: false, reason: 'lookup_failed' });
  });
});
