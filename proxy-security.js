const dns = require('dns');
const net = require('net');

function getApiKeyFromRequest(req) {
  const authorization = req.headers.authorization;
  if (authorization && typeof authorization === 'string' && authorization.startsWith('Bearer ')) {
    return authorization.substring(7).trim();
  }
  if (req.headers['x-api-key']) {
    return req.headers['x-api-key'];
  }
  return null;
}

function createAuthMiddleware({ authRequired, apiKeys = [] } = {}) {
  return function authenticateProxyRequest(req, res, next) {
    if (!authRequired) {
      return next();
    }

    const apiKey = getApiKeyFromRequest(req);
    if (!apiKey || !apiKeys.includes(apiKey)) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    return next();
  };
}

function isDomainAllowed(targetDomain, allowedDomains = ['*']) {
  const allowAll = allowedDomains.includes('*');
  if (allowAll) return true;

  try {
    const hostname = new URL(targetDomain).hostname;
    return allowedDomains.some((allowed) => {
      if (!allowed) return false;
      return hostname === allowed || hostname.endsWith(`.${allowed}`);
    });
  } catch {
    return false;
  }
}

function isPrivateIp(address) {
  if (!net.isIP(address)) return false;

  if (net.isIPv4(address)) {
    const parts = address.split('.').map(Number);
    if (parts[0] === 10) return true;
    if (parts[0] === 127) return true;
    if (parts[0] === 169 && parts[1] === 254) return true;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    if (parts[0] === 192 && parts[1] === 168) return true;
    if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) return true;
    return false;
  }

  const normalized = address.toLowerCase();
  if (normalized === '::1') return true;
  if (normalized.startsWith('fe80:')) return true;
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
  if (normalized.startsWith('::ffff:127.')) return true;
  return false;
}

async function lookupHostAddresses(hostname) {
  try {
    return await dns.promises.lookup(hostname, { all: true, verbatim: true });
  } catch {
    return [];
  }
}

async function isHostPrivate(hostname) {
  if (!hostname) return true;
  const normalized = hostname.toLowerCase();
  if (normalized === 'localhost' || normalized === 'ip6-localhost') return true;
  if (net.isIP(normalized)) {
    return isPrivateIp(normalized);
  }

  const addresses = await lookupHostAddresses(normalized);
  return addresses.some((entry) => isPrivateIp(entry.address));
}

async function isTargetBlocked(targetUrl) {
  if (!['http:', 'https:'].includes(targetUrl.protocol)) {
    return { blocked: true, reason: 'Unsupported protocol' };
  }

  if (await isHostPrivate(targetUrl.hostname)) {
    return { blocked: true, reason: 'Target resolves to a private or reserved address' };
  }

  return { blocked: false };
}

function modifyHeaders(headers, requestOrigin, { modifyCSP = true } = {}) {
  const modifiedHeaders = { ...headers };

  delete modifiedHeaders['content-security-policy'];
  delete modifiedHeaders['content-security-policy-report-only'];
  delete modifiedHeaders['x-frame-options'];
  delete modifiedHeaders['x-content-type-options'];
  delete modifiedHeaders['referrer-policy'];
  delete modifiedHeaders['strict-transport-security'];

  const allowedOrigin = requestOrigin && requestOrigin !== 'null' ? requestOrigin : '*';
  modifiedHeaders['access-control-allow-origin'] = allowedOrigin;
  modifiedHeaders['access-control-allow-methods'] = 'GET, POST, PUT, DELETE, OPTIONS, HEAD, PATCH';
  modifiedHeaders['access-control-allow-headers'] = 'Content-Type, Authorization, Accept, Accept-Language, Content-Language';
  modifiedHeaders['access-control-expose-headers'] = '*';
  modifiedHeaders['access-control-max-age'] = '86400';

  if (allowedOrigin !== '*') {
    modifiedHeaders['access-control-allow-credentials'] = 'true';
  } else {
    delete modifiedHeaders['access-control-allow-credentials'];
  }

  const existingVary = modifiedHeaders['vary'];
  const varyValues = existingVary ? existingVary.split(',').map((value) => value.trim()) : [];
  if (!varyValues.includes('Origin')) varyValues.push('Origin');
  modifiedHeaders['vary'] = varyValues.filter(Boolean).join(', ');

  if (modifyCSP) {
    modifiedHeaders['content-security-policy'] = "default-src * 'unsafe-inline' 'unsafe-eval'; script-src * 'unsafe-inline' 'unsafe-eval'; style-src * 'unsafe-inline'; img-src * data: *; font-src * data: *; connect-src *;";
  }

  return modifiedHeaders;
}

module.exports = {
  createAuthMiddleware,
  getApiKeyFromRequest,
  isDomainAllowed,
  isPrivateIp,
  lookupHostAddresses,
  isHostPrivate,
  isTargetBlocked,
  modifyHeaders,
};
