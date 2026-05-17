import { describe, expect, it } from 'vitest';
import { isPrivateAddress } from './privateIp';

describe('isPrivateAddress (IPv4)', () => {
  it.each([
    ['10.0.0.1', 'RFC1918 10/8'],
    ['172.16.0.1', 'RFC1918 172.16/12'],
    ['172.31.255.255', 'RFC1918 172.16/12 upper bound'],
    ['192.168.1.1', 'RFC1918 192.168/16'],
    ['127.0.0.1', 'loopback'],
    ['169.254.169.254', 'AWS metadata / link-local'],
    ['0.0.0.0', 'unspecified / non-routable'],
    ['100.64.0.1', 'CGNAT 100.64/10'],
    ['224.0.0.1', 'multicast'],
    ['255.255.255.255', 'broadcast'],
  ])('classifies %s as private (%s)', (addr) => {
    expect(isPrivateAddress(addr)).toBe(true);
  });

  it.each([
    ['8.8.8.8', 'Google DNS'],
    ['1.1.1.1', 'Cloudflare DNS'],
    ['208.80.154.224', 'en.wikipedia.org canonical'],
    ['151.101.1.69', 'Fastly'],
  ])('classifies %s as public (%s)', (addr) => {
    expect(isPrivateAddress(addr)).toBe(false);
  });
});

describe('isPrivateAddress (IPv6)', () => {
  it.each([
    ['::1', 'loopback'],
    ['fe80::1', 'link-local'],
    ['fc00::1', 'ULA fc00::/7'],
    ['fd00::1', 'ULA fd00::/8'],
    ['ff02::1', 'multicast'],
  ])('classifies %s as private (%s)', (addr) => {
    expect(isPrivateAddress(addr)).toBe(true);
  });

  it('classifies 2606:4700:4700::1111 (public Cloudflare IPv6) as public', () => {
    expect(isPrivateAddress('2606:4700:4700::1111')).toBe(false);
  });
});

describe('isPrivateAddress (IPv4-mapped IPv6 SSRF bypass)', () => {
  // SSRF defense: if a private IPv4 is dressed as an IPv4-mapped IPv6
  // (`::ffff:a.b.c.d`), it must still be classified as private. Without
  // unwrapping, ipaddr.js would treat the IPv6 form as a unicast IPv6
  // address and the proxy could be tricked into hitting 10/8 over IPv6.
  it.each([
    '::ffff:10.0.0.1',
    '::ffff:127.0.0.1',
    '::ffff:169.254.169.254',
    '::ffff:192.168.1.1',
  ])('rejects IPv4-mapped IPv6 %s', (addr) => {
    expect(isPrivateAddress(addr)).toBe(true);
  });

  it('allows a public IPv4 dressed as IPv4-mapped IPv6', () => {
    expect(isPrivateAddress('::ffff:8.8.8.8')).toBe(false);
  });
});

describe('isPrivateAddress (fail-closed on garbage input)', () => {
  // Unparseable input is treated as private so a typo or missing DNS record
  // can never silently widen the firewall.
  it.each(['not-an-ip', '', '999.999.999.999', '::g'])(
    'treats unparseable %j as private',
    (addr) => {
      expect(isPrivateAddress(addr)).toBe(true);
    },
  );
});
