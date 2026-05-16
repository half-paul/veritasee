import ipaddr from 'ipaddr.js';

// Returns true when `address` is not a publicly-routable unicast IP.
// Covers RFC1918, loopback, link-local, multicast, broadcast, carrier-grade
// NAT, reserved, and all IPv6 equivalents (ULA `fc00::/7`, link-local
// `fe80::/10`, loopback `::1`, multicast `ff00::/8`). IPv4-mapped IPv6
// addresses (`::ffff:a.b.c.d`) are unwrapped before classification so they
// cannot be used to slip a private IPv4 past an IPv6 check. Unparseable
// input is treated as private (fail-closed).
export function isPrivateAddress(address: string): boolean {
  let addr: ipaddr.IPv4 | ipaddr.IPv6;
  try {
    addr = ipaddr.parse(address);
  } catch {
    return true;
  }
  if (addr.kind() === 'ipv6' && (addr as ipaddr.IPv6).isIPv4MappedAddress()) {
    addr = (addr as ipaddr.IPv6).toIPv4Address();
  }
  return addr.range() !== 'unicast';
}
