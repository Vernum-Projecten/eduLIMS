// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Which IP addresses an identity-provider fetch may reach (#46, ADR 0015; ASVS V1.3.6 SSRF).
// IPv6 forms that carry an IPv4 address (IPv4-mapped, NAT64 64:ff9b::/96, 6to4 2002::/16) are
// judged by that IPv4 address, so `[::ffff:7f00:1]` is loopback like `127.0.0.1`.
// Relative imports: the host CLI loads this in plain Node.
import { BlockList, isIP } from "node:net";

/** IPv4 ranges that are not publicly routable (RFC 6890 special-purpose, multicast, reserved). */
const IPV4: readonly (readonly [string, number])[] = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 3],
];

/** IPv6 ranges that are not publicly routable or that tunnel to an address eduLIMS cannot see. */
const IPV6: readonly (readonly [string, number])[] = [
  // Unspecified, loopback and the deprecated IPv4-compatible form.
  ["::", 96],
  ["64:ff9b:1::", 48],
  ["100::", 64],
  // Teredo hides its IPv4 address; documentation addresses never route.
  ["2001::", 32],
  ["2001:db8::", 32],
  ["fc00::", 7],
  ["fe80::", 10],
  ["fec0::", 10],
  ["ff00::", 8],
];

const v4 = new BlockList();
for (const [network, prefix] of IPV4) v4.addSubnet(network, prefix, "ipv4");
const v6 = new BlockList();
for (const [network, prefix] of IPV6) v6.addSubnet(network, prefix, "ipv6");

/** Returns the eight 16-bit groups of a valid IPv6 address, a dotted IPv4 tail included. */
function ipv6Groups(address: string): number[] | null {
  let text = (address.toLowerCase().split("%")[0] ?? "").trim();
  const tail = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(text);
  if (tail) {
    const [a, b, c, d] = tail.slice(1).map(Number);
    if (a === undefined || b === undefined || c === undefined || d === undefined) return null;
    text = `${text.slice(0, tail.index)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const rest = halves[1] ? halves[1].split(":") : [];
  const groups =
    halves.length === 2
      ? [...head, ...Array<string>(8 - head.length - rest.length).fill("0"), ...rest]
      : head;
  if (groups.length !== 8) return null;
  const numbers = groups.map((group) => Number.parseInt(group, 16));
  return numbers.every((n) => Number.isInteger(n) && n >= 0 && n <= 0xffff) ? numbers : null;
}

function ipv4Of(high: number, low: number): string {
  return `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`;
}

/** Returns the IPv4 address an IPv4-mapped, NAT64 or 6to4 address carries, else `null`. */
export function embeddedIpv4(address: string): string | null {
  const g = ipv6Groups(address);
  if (!g) return null;
  const [g0, g1, g2, g3, g4, g5, g6, g7] = g;
  if (g6 === undefined || g7 === undefined) return null;
  const zeroTo = (end: number) => g.slice(0, end).every((n) => n === 0);
  if (zeroTo(5) && g5 === 0xffff) return ipv4Of(g6, g7);
  if (g0 === 0x64 && g1 === 0xff9b && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0) {
    return ipv4Of(g6, g7);
  }
  if (g0 === 0x2002 && g1 !== undefined && g2 !== undefined) return ipv4Of(g1, g2);
  return null;
}

/**
 * Returns whether an IP address is not publicly routable: loopback, RFC 1918, link-local,
 * unique-local, multicast, the special-purpose ranges, or a tunnel form that carries one. A
 * value that is not an IP address counts as private.
 */
export function isPrivateAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) return v4.check(address, "ipv4");
  if (version !== 6) return true;
  const embedded = embeddedIpv4(address);
  if (embedded !== null) return v4.check(embedded, "ipv4");
  if (ipv6Groups(address) === null) return true;
  return v6.check(address.split("%")[0] ?? address, "ipv6");
}
