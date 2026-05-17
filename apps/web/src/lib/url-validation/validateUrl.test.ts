import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock resolveHost so we don't hit DNS, and so we can program adversarial
// resolutions (DNS-rebinding-style mismatches, IPv4-mapped IPv6, etc.).
vi.mock('./resolveHost', () => ({
  resolveHost: vi.fn(),
}));

import { clearDenylistCache } from './denylist';
import { resolveHost } from './resolveHost';
import { validateUrl } from './validateUrl';
import { MAX_URL_LENGTH } from './types';

const mockResolveHost = vi.mocked(resolveHost);

describe('validateUrl', () => {
  beforeEach(() => {
    clearDenylistCache();
    mockResolveHost.mockReset();
    mockResolveHost.mockResolvedValue({ ok: true, addresses: ['8.8.8.8'] });
  });

  afterEach(() => {
    clearDenylistCache();
  });

  describe('input shape', () => {
    it('rejects an empty string', async () => {
      const result = await validateUrl('');
      expect(result).toMatchObject({ ok: false, code: 'invalid_url' });
    });

    it('rejects a URL exceeding MAX_URL_LENGTH', async () => {
      const long = 'https://example.com/' + 'a'.repeat(MAX_URL_LENGTH);
      const result = await validateUrl(long);
      expect(result).toMatchObject({ ok: false, code: 'too_long' });
    });

    it('rejects an unparseable URL', async () => {
      const result = await validateUrl('not a url');
      expect(result).toMatchObject({ ok: false, code: 'invalid_url' });
    });

    it('rejects http:// (scheme not https)', async () => {
      const result = await validateUrl('http://example.com');
      expect(result).toMatchObject({ ok: false, code: 'invalid_scheme' });
    });

    it('rejects ftp:// (scheme not https)', async () => {
      const result = await validateUrl('ftp://example.com');
      expect(result).toMatchObject({ ok: false, code: 'invalid_scheme' });
    });
  });

  describe('denylist', () => {
    it('rejects an exact denylisted hostname', async () => {
      const result = await validateUrl('https://localhost/path');
      expect(result).toMatchObject({ ok: false, code: 'denylisted', hostname: 'localhost' });
    });

    it('rejects a subdomain of a denylisted entry', async () => {
      process.env.URL_DENYLIST_EXTRA = 'evil.com';
      clearDenylistCache();
      try {
        const result = await validateUrl('https://a.evil.com/x');
        expect(result).toMatchObject({ ok: false, code: 'denylisted' });
      } finally {
        delete process.env.URL_DENYLIST_EXTRA;
        clearDenylistCache();
      }
    });

    it('rejects the AWS metadata IP-literal hostname', async () => {
      const result = await validateUrl('https://169.254.169.254/latest/meta-data/');
      expect(result).toMatchObject({ ok: false, code: 'denylisted' });
    });
  });

  describe('DNS failures', () => {
    it('returns dns_failure when resolveHost errors', async () => {
      mockResolveHost.mockResolvedValue({ ok: false, reason: 'lookup_failed' });
      const result = await validateUrl('https://nonexistent.example.com');
      expect(result).toMatchObject({ ok: false, code: 'dns_failure' });
    });
  });

  describe('private IP detection', () => {
    it('rejects an RFC1918 IPv4 resolution', async () => {
      mockResolveHost.mockResolvedValue({ ok: true, addresses: ['10.0.0.1'] });
      const result = await validateUrl('https://internal.example.com/x');
      expect(result).toMatchObject({ ok: false, code: 'private_ip', address: '10.0.0.1' });
    });

    it('rejects IPv4-mapped IPv6 (SSRF bypass attempt)', async () => {
      mockResolveHost.mockResolvedValue({ ok: true, addresses: ['::ffff:10.0.0.1'] });
      const result = await validateUrl('https://internal.example.com/x');
      expect(result).toMatchObject({ ok: false, code: 'private_ip' });
    });

    it('rejects link-local IPv6', async () => {
      mockResolveHost.mockResolvedValue({ ok: true, addresses: ['fe80::1'] });
      const result = await validateUrl('https://linklocal.example.com');
      expect(result).toMatchObject({ ok: false, code: 'private_ip' });
    });

    it('rejects when any of multiple A records is private', async () => {
      // dual-homed: one public, one private — must fail closed.
      mockResolveHost.mockResolvedValue({
        ok: true,
        addresses: ['8.8.8.8', '10.0.0.1'],
      });
      const result = await validateUrl('https://dualhomed.example.com');
      expect(result).toMatchObject({ ok: false, code: 'private_ip', address: '10.0.0.1' });
    });
  });

  describe('happy path', () => {
    it('returns normalized URL and hostname for a valid public https URL', async () => {
      mockResolveHost.mockResolvedValue({ ok: true, addresses: ['208.80.154.224'] });
      const result = await validateUrl('https://en.wikipedia.org/wiki/Test');
      expect(result).toEqual({
        ok: true,
        normalizedUrl: 'https://en.wikipedia.org/wiki/Test',
        hostname: 'en.wikipedia.org',
      });
    });

    it('strips IPv6 literal brackets before validation', async () => {
      mockResolveHost.mockResolvedValue({ ok: true, addresses: ['2606:4700:4700::1111'] });
      const result = await validateUrl('https://[2606:4700:4700::1111]/');
      expect(result).toMatchObject({ ok: true, hostname: '2606:4700:4700::1111' });
    });
  });
});
