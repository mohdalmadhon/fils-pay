/**
 * Where a webhook may be delivered. Merchants choose the URL, so without a
 * check the API would POST (and show the response of) any address it can
 * reach: loopback, the private network, the cloud metadata service.
 *
 * `isBlockedAddress` classifies one resolved IP. `guardedLookup` is a
 * drop-in `lookup` for node:http(s) that resolves the host and refuses the
 * connection if any resolved address is blocked; because the check runs on
 * the address actually connected to, a DNS answer that changes between
 * validation and delivery (DNS rebinding) is still caught.
 */
import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { BlockList, isIP } from "node:net";

const blocked = new BlockList();
// IPv4
blocked.addSubnet("0.0.0.0", 8, "ipv4"); // "this network"
blocked.addSubnet("10.0.0.0", 8, "ipv4"); // RFC 1918
blocked.addSubnet("100.64.0.0", 10, "ipv4"); // carrier-grade NAT
blocked.addSubnet("127.0.0.0", 8, "ipv4"); // loopback
blocked.addSubnet("169.254.0.0", 16, "ipv4"); // link-local, cloud metadata
blocked.addSubnet("172.16.0.0", 12, "ipv4"); // RFC 1918
blocked.addSubnet("192.0.0.0", 24, "ipv4"); // IETF protocol assignments
blocked.addSubnet("192.0.2.0", 24, "ipv4"); // TEST-NET-1
blocked.addSubnet("192.168.0.0", 16, "ipv4"); // RFC 1918
blocked.addSubnet("198.18.0.0", 15, "ipv4"); // benchmarking
blocked.addSubnet("198.51.100.0", 24, "ipv4"); // TEST-NET-2
blocked.addSubnet("203.0.113.0", 24, "ipv4"); // TEST-NET-3
blocked.addSubnet("224.0.0.0", 4, "ipv4"); // multicast
blocked.addSubnet("240.0.0.0", 4, "ipv4"); // reserved, broadcast
// IPv6
blocked.addAddress("::", "ipv6"); // unspecified
blocked.addAddress("::1", "ipv6"); // loopback
blocked.addSubnet("64:ff9b::", 96, "ipv6"); // NAT64 (embeds IPv4)
blocked.addSubnet("100::", 64, "ipv6"); // discard
blocked.addSubnet("2001:db8::", 32, "ipv6"); // documentation
blocked.addSubnet("fc00::", 7, "ipv6"); // unique local
blocked.addSubnet("fe80::", 10, "ipv6"); // link-local
blocked.addSubnet("ff00::", 8, "ipv6"); // multicast

/** True if `ip` is loopback, private, link-local, metadata, reserved or
 *  otherwise not a public unicast address. Non-IP input counts as blocked. */
export function isBlockedAddress(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) return blocked.check(ip, "ipv4");
  if (family === 6) {
    const lower = ip.toLowerCase();
    // IPv4-mapped (::ffff:a.b.c.d): judge the embedded IPv4 address.
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
    if (mapped) return blocked.check(mapped[1]!, "ipv4");
    return blocked.check(lower, "ipv6");
  }
  return true;
}

export class BlockedDestinationError extends Error {
  readonly code = "EBLOCKEDDESTINATION";
  constructor(host: string, address: string) {
    super(`webhook destination ${host} (${address}) is not allowed: private, loopback or reserved address`);
  }
}

type LookupCallback = (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void;

/** `lookup` option for http.request/https.request. Resolves every address
 *  for the host and fails the connection if any of them is blocked. */
export function guardedLookup(
  hostname: string,
  options: { all?: boolean; family?: number | string },
  callback: LookupCallback,
): void {
  dnsLookup(hostname, { all: true, family: (options.family as 0 | 4 | 6 | undefined) ?? 0 }, (err, addresses) => {
    if (err) {
      callback(err, options.all ? [] : "", 0);
      return;
    }
    const bad = addresses.find((a) => isBlockedAddress(a.address));
    if (bad) {
      callback(new BlockedDestinationError(hostname, bad.address), options.all ? [] : "", 0);
      return;
    }
    if (options.all) {
      callback(null, addresses);
    } else {
      const first = addresses[0]!;
      callback(null, first.address, first.family);
    }
  });
}

/** Save-time check of a URL's host: an IP literal in a blocked range, or a
 *  name that is obviously local, is refused up front so the merchant gets a
 *  clear 400. Names are re-checked against DNS on every delivery by
 *  guardedLookup; this is only the early, cheap part. */
export function isObviouslyLocalHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (isIP(host)) return isBlockedAddress(host);
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    !host.includes(".")
  );
}
