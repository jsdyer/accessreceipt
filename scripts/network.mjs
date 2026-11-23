import dns from 'node:dns/promises';
import net from 'node:net';
import http from 'node:http';
import ipaddr from 'ipaddr.js';

export function isPublicAddress(address) {
  try {
    let ip = ipaddr.parse(address);
    if (ip.kind() === 'ipv6' && ip.isIPv4MappedAddress()) ip = ip.toIPv4Address();
    return ip.range() === 'unicast';
  } catch { return false; }
}
export function validatePublicURL(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('Use a complete public HTTP or HTTPS URL.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || (url.port && !['80', '443'].includes(url.port))) throw new Error('Only public HTTP(S) pages on standard ports, without URL credentials, are supported.');
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!host || host === 'localhost' || host.endsWith('.localhost') || /\.(local|internal|lan|home|test|invalid)$/.test(host) || (!net.isIP(host) && !host.includes('.'))) throw new Error('Local and private hostnames cannot be scanned.');
  if (net.isIP(host) && !isPublicAddress(host)) throw new Error('Private, reserved and local addresses cannot be scanned.');
  if ([...url.searchParams.keys()].some(key => /^(access_token|api_key|apikey|token|password|secret|authorization|auth)$/i.test(key))) throw new Error('Remove credentials and access tokens from the page URL.');
  url.hash = '';
  return url;
}
export async function resolvePublic(hostname, lookup = dns.lookup) {
  const host = hostname.replace(/^\[|\]$/g, '');
  const addresses = net.isIP(host) ? [{address: host, family: net.isIP(host)}] : await lookup(host, {all: true, verbatim: true});
  if (!addresses.length || addresses.some(({address}) => !isPublicAddress(address))) throw new Error('The destination resolves to a private or reserved network.');
  return addresses[0];
}

// Every socket goes to the checked IP, not a second DNS lookup. This also covers
// browser redirects/subresources and prevents DNS rebinding into a private network.
export async function createPublicProxy() {
  const sockets = new Set();
  const server = http.createServer(async (request, response) => {
    try {
      if (!['GET', 'HEAD'].includes(request.method)) throw new Error('Only read requests are permitted.');
      const url = validatePublicURL(request.url);
      if (url.protocol !== 'http:') throw new Error('Use CONNECT for TLS.');
      const address = await resolvePublic(url.hostname);
      const headers = {...request.headers, host: url.host};
      delete headers['proxy-authorization']; delete headers['proxy-connection'];
      const upstream = http.request({host: address.address, port: Number(url.port) || 80,
        family: address.family, method: request.method, path: url.pathname + url.search, headers, timeout: 20000}, incoming => {
        response.writeHead(incoming.statusCode, incoming.headers); incoming.pipe(response);
      });
      upstream.on('timeout', () => upstream.destroy());
      upstream.on('error', () => { if (!response.headersSent) response.writeHead(502); response.end(); });
      request.pipe(upstream);
    } catch { response.writeHead(403); response.end('Destination blocked by public-page policy.'); }
  });
  server.on('connect', async (request, socket, head) => {
    try {
      const url = validatePublicURL(`https://${request.url}/`);
      if ((Number(url.port) || 443) !== 443) throw new Error('Only TLS port 443 is supported.');
      const address = await resolvePublic(url.hostname);
      const upstream = net.connect({host: address.address, family: address.family, port: 443});
      sockets.add(upstream);
      upstream.setTimeout(35000, () => upstream.destroy());
      upstream.on('close', () => sockets.delete(upstream));
      upstream.on('error', () => socket.destroy());
      socket.on('error', () => upstream.destroy());
      socket.on('close', () => upstream.destroy());
      upstream.once('connect', () => {
        socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        if (head.length) upstream.write(head);
        socket.pipe(upstream); upstream.pipe(socket);
      });
    } catch { socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); }
  });
  server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return {url: `http://127.0.0.1:${server.address().port}`, close: async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise(resolve => server.close(resolve));
  }};
}
