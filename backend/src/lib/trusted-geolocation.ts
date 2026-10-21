import { isIP } from 'node:net';

export type TrustedGeoCountry = {
  countryCode: string | null;
  source: 'trusted-proxy' | 'unknown';
};

function normalizedIp(value: string | undefined): string | undefined {
  const candidate = value?.trim().toLowerCase();
  if (!candidate) return undefined;
  if (isIP(candidate) === 4) return candidate;
  if (isIP(candidate) === 6) {
    const mappedV4 = candidate.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
    return mappedV4 && isIP(mappedV4) === 4 ? mappedV4 : candidate;
  }
  return undefined;
}

/**
 * Candidate geolocation boundary. It deliberately returns no client IP and
 * never trusts forwarded headers unless the immediate peer is allowlisted.
 */
export function trustedGeoCountry(input: {
  remoteAddress?: string;
  trustedProxyAddresses?: readonly string[];
  cfConnectingIp?: string;
  cfIpCountry?: string;
}): TrustedGeoCountry {
  const peer = normalizedIp(input.remoteAddress);
  const trustedPeers = new Set((input.trustedProxyAddresses ?? []).map(normalizedIp).filter((ip): ip is string => Boolean(ip)));
  if (!peer || !trustedPeers.has(peer)) return { countryCode: null, source: 'unknown' };

  if (!normalizedIp(input.cfConnectingIp)) return { countryCode: null, source: 'unknown' };
  const country = input.cfIpCountry?.trim().toUpperCase();
  if (!country || !/^[A-Z]{2}$/.test(country) || ['XX', 'ZZ'].includes(country)) {
    return { countryCode: null, source: 'unknown' };
  }
  return { countryCode: country, source: 'trusted-proxy' };
}
