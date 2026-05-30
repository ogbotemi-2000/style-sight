const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const urlJoin = require('url-join');
const path = require('path');
const url = require('url');
const dns = require('dns');
const net = require('net');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

const ALLOWED_DOMAINS = process.env.ALLOWED_DOMAINS
  ? process.env.ALLOWED_DOMAINS.split(',').map((domain) => domain.trim()).filter(Boolean)
  : ['*'];

const CONFIG = {
  allowedDomains: ALLOWED_DOMAINS,
  modifyCSP: process.env.MODIFY_CSP !== 'false',
  modifyXFrameOptions: process.env.MODIFY_X_FRAME_OPTIONS !== 'false',
  rewriteUrls: process.env.REWRITE_URLS !== 'false',
  logRequests: process.env.LOG_REQUESTS !== 'false',
};

const AUTH_REQUIRED = process.env.AUTH_REQUIRED === 'true';
const PROXY_API_KEYS = process.env.PROXY_API_KEYS
  ? process.env.PROXY_API_KEYS.split(',').map((key) => key.trim()).filter(Boolean)
  : [];

const RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000;
const RATE_LIMIT_MAX = Number(process.env.RATE_LIMIT_MAX) || 100;
const MAX_REDIRECTS = Number(process.env.MAX_REDIRECTS) || 5;
const PROXY_PATH = '/api/proxy';
const ALLOWLIST_ALL = CONFIG.allowedDomains.includes('*');

app.set('trust proxy', true);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.json({ limit: '50mb' }));

// Serve static files
app.use(express.static(path.join(__dirname,'./')));


// Request logger
app.use((req, res, next) => {
  if (CONFIG.logRequests) {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  }
  next();
});

const proxyLimiter = rateLimit({
  windowMs: RATE_LIMIT_WINDOW_MS,
  max: RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => res.status(429).json({ error: 'Rate limit exceeded' }),
});

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

function authenticateProxyRequest(req, res, next) {
  if (!AUTH_REQUIRED) {
    return next();
  }

  const apiKey = getApiKeyFromRequest(req);
  if (!apiKey || !PROXY_API_KEYS.includes(apiKey)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  return next();
}

app.use(PROXY_PATH, authenticateProxyRequest, proxyLimiter);

// Helper function to check if domain is allowed
function isDomainAllowed(targetDomain) {
  if (ALLOWLIST_ALL) return true;
  try {
    const hostname = new URL(targetDomain).hostname;
    return CONFIG.allowedDomains.some((allowed) => {
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

// Helper function to rewrite URLs in content
function rewriteUrls(content, targetDomain, proxyPath) {
  if (!CONFIG.rewriteUrls) return content;

  const targetBase = targetDomain;
  let rewritten = content;

  // Rewrite HTML href/src attributes
  rewritten = rewritten.replace(/href=["']([^"']+)["']/gi, (match, urlPart) => {
    const trimmed = urlPart.trim();
    if (!shouldProxyAssetUrl(trimmed, targetBase)) return match;
    const absoluteUrl = resolveUrl(trimmed, targetBase);
    const proxyUrl = `${proxyPath}?target=${encodeURIComponent(absoluteUrl)}`;
    console.log('::CSS::', trimmed, match);
    return match.replace(urlPart, proxyUrl);
  });

  rewritten = rewritten.replace(/src=["']([^"']+)["']/gi, (match, urlPart) => {
    const trimmed = urlPart.trim();
    if (!shouldProxyAssetUrl(trimmed, targetBase)) return match;
    const absoluteUrl = resolveUrl(trimmed, targetBase);
    const proxyUrl = `${proxyPath}?target=${encodeURIComponent(absoluteUrl)}`;
    return match.replace(urlPart, proxyUrl);
  });

  // Rewrite CSS url() references, including font-face src values
  rewritten = rewritten.replace(/url\(\s*(["']?)([^"')]+)\1\s*\)/gi, (match, quote, urlPart) => {
    const trimmed = urlPart.trim();
    if (!shouldProxyAssetUrl(trimmed, targetBase)) return match;
    const absoluteUrl = resolveUrl(trimmed, targetBase);
    const proxyUrl = `${proxyPath}?target=${encodeURIComponent(absoluteUrl)}`;
    const useQuote = quote || "'";
    return `url(${useQuote}${proxyUrl}${useQuote})`;
  });

  // Rewrite @import statements that use url()
  rewritten = rewritten.replace(/@import\s+url\(\s*(["']?)([^"')]+)\1\s*\)/gi, (match, quote, urlPart) => {
    const trimmed = urlPart.trim();
    if (!shouldProxyAssetUrl(trimmed, targetBase)) return match;
    const absoluteUrl = resolveUrl(trimmed, targetBase);
    const proxyUrl = `${proxyPath}?target=${encodeURIComponent(absoluteUrl)}`;
    const useQuote = quote || "'";
    return `@import url(${useQuote}${proxyUrl}${useQuote})`;
  });

  // Rewrite bare @import strings
  rewritten = rewritten.replace(/@import\s+(["'])([^"']+)\1/gi, (match, quote, urlPart) => {
    const trimmed = urlPart.trim();
    if (!shouldProxyAssetUrl(trimmed, targetBase)) return match;
    const absoluteUrl = resolveUrl(trimmed, targetBase);
    const proxyUrl = `${proxyPath}?target=${encodeURIComponent(absoluteUrl)}`;
    return `@import url(${quote}${proxyUrl}${quote})`;
  });

  return rewritten;
}

// Helper function to resolve relative URLs
function resolveUrl(path, baseUrl) {
  if (!path || !baseUrl) return path || baseUrl;

  try {
    const normalizedBase = new URL(baseUrl).href;
    if (/^https?:\/\//.test(path)) {
      return path; // Already absolute
    }
    if (/^\/\//.test(path)) {
      return new URL(path, 'https:').href;
    }
    return new URL(path, normalizedBase).href;
  } catch {
    try {
      return urlJoin(baseUrl, path);
    } catch {
      return baseUrl;
    }
  }
}

function isRelativeUrl(value) {
  return typeof value === 'string' && value.length > 0 && !/^(?:[a-zA-Z][a-zA-Z\d+\-.]*:|\/\/)/.test(value);
}

function isAbsoluteUrl(value) {
  return typeof value === 'string' && /^(?:[a-zA-Z][a-zA-Z\d+\-.]*:|\/\/)/.test(value);
}

function hasSameHost(value, baseUrl) {
  if (!value || !baseUrl) return false;
  try {
    const target = new URL(value, baseUrl);
    const base = new URL(baseUrl);
    return target.hostname === base.hostname;
  } catch {
    return false;
  }
}

function shouldProxyAssetUrl(value, targetDomain) {
  if (!value || !targetDomain) return false;
  return isRelativeUrl(value) || hasSameHost(value, targetDomain);
}

function isSameOriginUrl(value, baseUrl) {
  try {
    const targetUrl = new URL(value, baseUrl);
    const base = new URL(baseUrl);
    return targetUrl.origin === base.origin;
  } catch {
    return false;
  }
}

// Helper function to modify response headers
function modifyHeaders(headers, requestOrigin) {
  const modifiedHeaders = { ...headers };

  // Remove original security headers that would interfere with proxy rendering
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

  if (CONFIG.modifyCSP) {
    modifiedHeaders['content-security-policy'] = "default-src * 'unsafe-inline' 'unsafe-eval'; script-src * 'unsafe-inline' 'unsafe-eval'; style-src * 'unsafe-inline'; img-src * data: *; font-src * data: *; connect-src *;";
  }

  return modifiedHeaders;
}

// Helper function to process HTML content
function processHtmlContent(content, targetDomain, proxyPath) {
  const $ = cheerio.load(content, { decodeEntities: false });
  const headElement = $('head');

  // =========================================================================
  // META TAG MANAGEMENT - Essential for cross-domain proxying
  // =========================================================================

  // 1. Ensure charset is set to UTF-8
  let charsetMeta = $('meta[charset]');
  if (!charsetMeta.length) {
    charsetMeta = $('meta[http-equiv="Content-Type"]');
  }
  if (charsetMeta.length) {
    charsetMeta.remove(); // Remove existing charset
  }
  headElement.prepend('<meta charset="UTF-8">');

  // 2. Ensure viewport meta tag exists (critical for responsive design)
  let viewportMeta = $('meta[name="viewport"]');
  if (!viewportMeta.length) {
    headElement.prepend('<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">');
  } else {
    // Update existing viewport to ensure proper settings
    const currentViewport = viewportMeta.attr('content') || '';
    if (!currentViewport.includes('width=device-width')) {
      viewportMeta.attr('content', 'width=device-width, initial-scale=1.0, viewport-fit=cover');
    }
  }

  // 3. Add X-UA-Compatible for IE compatibility
  let uaCompatMeta = $('meta[http-equiv="X-UA-Compatible"]');
  if (uaCompatMeta.length) {
    uaCompatMeta.attr('content', 'IE=edge');
  } else {
    headElement.prepend('<meta http-equiv="X-UA-Compatible" content="IE=edge">');
  }

  // 4. Update or add referrer-policy meta tag for safer cross-domain access
  let referrerMeta = $('meta[name="referrer"]');
  if (referrerMeta.length) {
    referrerMeta.attr('content', 'no-referrer');
  } else {
    headElement.prepend('<meta name="referrer" content="no-referrer">');
  }

  // 5. Remove or relax CSP meta tag (if present)
  let cspMeta = $('meta[http-equiv="Content-Security-Policy"]');
  if (cspMeta.length) {
    cspMeta.remove();
    // Inject permissive CSP as meta tag
    headElement.prepend('<meta http-equiv="Content-Security-Policy" content="default-src * \'unsafe-inline\' \'unsafe-eval\'; script-src * \'unsafe-inline\' \'unsafe-eval\'; style-src * \'unsafe-inline\'; img-src * data:; font-src * data:; connect-src *;">');
  }

  // 6. Add origin-trial meta tags if not present (for testing features)
  if (!$('meta[http-equiv="origin-trial"]').length) {
    // This can be useful for feature testing across domains
  }

  // 7. Remove X-Frame-Options if present as meta tag (though usually HTTP header)
  $('meta[http-equiv="X-Frame-Options"]').remove();

  // 8. Remove X-Content-Type-Options if present as meta tag
  $('meta[http-equiv="X-Content-Type-Options"]').remove();

  // 9. Ensure color-scheme supports light and dark
  let colorSchemeMeta = $('meta[name="color-scheme"]');
  if (!colorSchemeMeta.length) {
    headElement.prepend('<meta name="color-scheme" content="light dark">');
  }

  // 10. Add theme-color for consistency
  if (!$('meta[name="theme-color"]').length) {
    headElement.prepend('<meta name="theme-color" content="#ffffff">');
  }

  // 11. Add proxy metadata (for debugging/identification)
  $('meta[name="proxy-target"]').remove(); // Remove any existing
  headElement.prepend(`<meta name="proxy-target" content="${new URL(targetDomain).hostname}">`);
  headElement.prepend(`<meta name="proxy-timestamp" content="${new Date().toISOString()}">`);
  // Add proxy base (full origin) to help injected scripts resolve relative URLs
  $('meta[name="proxy-base"]').remove();
  headElement.prepend(`<meta name="proxy-base" content="${new URL(targetDomain).origin}">`);

  // =========================================================================
  // URL REWRITING
  // =========================================================================

  // Rewrite all href attributes (links, anchors, form actions) to route through proxy
  $('[href]').each((i, el) => {
    const href = $(el).attr('href');
    if (shouldProxyAssetUrl(href, targetDomain)) {
      const absoluteUrl = resolveUrl(href, targetDomain);
      $(el).attr('href', `${proxyPath}?target=${encodeURIComponent(absoluteUrl)}`);
    }
  });

  // Also proxy form actions
  $('form[action]').each((i, el) => {
    const action = $(el).attr('action');
    if (shouldProxyAssetUrl(action, targetDomain)) {
      const absoluteUrl = resolveUrl(action, targetDomain);
      $(el).attr('action', `${proxyPath}?target=${encodeURIComponent(absoluteUrl)}`);
    }
  });

  // Handle src and srcset: images should resolve to full original URLs (no proxying),
  // while other resources (scripts, iframes) should be routed through proxy.
  $('[src]').each((i, el) => {
    const src = $(el).attr('src');
    if (!src) return;
    const tag = (el.tagName || '').toLowerCase();

    if (shouldProxyAssetUrl(src, targetDomain)) {
      const absoluteUrl = resolveUrl(src, targetDomain);
      if (tag === 'img' || tag === 'picture' || tag === 'source') {
        $(el).attr('src', absoluteUrl);
      } else {
        $(el).attr('src', `${proxyPath}?target=${encodeURIComponent(absoluteUrl)}`);
      }
    }
  });

  // Rewrite srcset attributes (commonly for responsive images) to absolute URLs
  $('[srcset]').each((i, el) => {
    const srcset = $(el).attr('srcset');
    if (!srcset) return;
    const entries = srcset.split(',').map(s => s.trim()).filter(Boolean);
    const rewritten = entries.map(entry => {
      const parts = entry.split(/\s+/);
      const urlPart = parts[0];
      const descriptor = parts.slice(1).join(' ');
      if (shouldProxyAssetUrl(urlPart, targetDomain)) {
        const abs = resolveUrl(urlPart, targetDomain);
        return descriptor ? `${abs} ${descriptor}` : abs;
      }
      return entry;
    }).join(', ');
    $(el).attr('srcset', rewritten);
  });

  // =========================================================================
  // BASE TAG MANAGEMENT
  // =========================================================================

  // Rewrite base tag
  const baseTag = $('base');
  if (baseTag.length) {
    baseTag.remove(); // Remove base tag to avoid conflicts
  }

  // Inject base tag pointing to the proxy endpoint so relative links resolve through proxy
  // Example: /proxy?target=https://example.com/
  const proxyBaseHref = `${proxyPath}?target=${encodeURIComponent(new URL(targetDomain).origin + '/')}`;
  headElement.prepend(`<base href="${proxyBaseHref}">`);

  // =========================================================================
  // INJECT FETCH / XHR PROXY SCRIPT
  // =========================================================================

  // Script will rewrite outbound fetch/XHR requests to route through the proxy
  const proxyScript = `
    (function(){
      try {
        const PROXY_PATH = '${proxyPath}';
        const proxyBaseMeta = document.querySelector('meta[name="proxy-base"]');
        const TARGET_BASE = proxyBaseMeta ? proxyBaseMeta.content : window.location.origin;

        const isLocalProxyUrl = function(u){
          try { return u.indexOf(PROXY_PATH + '?target=') === 0 || u.indexOf(window.location.origin + PROXY_PATH + '?target=') === 0; } catch(e){return false}
        };

        const toAbsolute = function(u){
          try {
            if (/^\/\//.test(u)) return window.location.protocol + u;
            if (/^https?:\/\//i.test(u)) return u;
            return new URL(u, TARGET_BASE).href;
          } catch(e){ return u }
        };

        const isSameTargetHostUrl = function(u){
          try {
            const absolute = new URL(u, TARGET_BASE);
            const targetOrigin = new URL(TARGET_BASE);
            return absolute.hostname === targetOrigin.hostname;
          } catch (e) {
            return false;
          }
        };

        const shouldProxyUrl = function(u){
          if (!u) return false;
          if (/^(data:|blob:|about:|javascript:|mailto:)/i.test(u)) return false;
          if (isLocalProxyUrl(u)) return false;
          if (isRelativeUrl(u)) return true;
          return isSameTargetHostUrl(u);
        };

        const isRelativeUrl = function(value) {
          return typeof value === 'string' && value.length > 0 && !/^(?:[a-zA-Z][a-zA-Z\d+\-.]*:|\/\/)/.test(value);
        };

        // Override fetch
        const _fetch = window.fetch.bind(window);
        window.fetch = function(input, init){
          try {
            let url = input;
            let isRequestObj = false;
            if (typeof input === 'object' && input && input.url) {
              isRequestObj = true;
              url = input.url;
            }

            if (!shouldProxyUrl(url)) {
              return _fetch(input, init);
            }

            const absolute = toAbsolute(url);
            const proxied = PROXY_PATH + '?target=' + encodeURIComponent(absolute);

            if (isRequestObj) {
              try {
                const newReq = new Request(proxied, input);
                return _fetch(newReq, init);
              } catch(e){
                return _fetch(proxied, init);
              }
            }

            return _fetch(proxied, init);
          } catch(e){
            return _fetch(input, init);
          }
        };

        // Override XMLHttpRequest
        (function(){
          const XHR = window.XMLHttpRequest;
          function ProxyXHR(){
            const xhr = new XHR();
            const open = xhr.open;
            xhr.open = function(method, url){
              try {
                if (shouldProxyUrl(url)) {
                  url = PROXY_PATH + '?target=' + encodeURIComponent(toAbsolute(url));
                }
              } catch(e){}
              return open.apply(this, arguments);
            };
            return xhr;
          }
          ProxyXHR.UNSENT = XHR.UNSENT;
          ProxyXHR.OPENED = XHR.OPENED;
          ProxyXHR.HEADERS_RECEIVED = XHR.HEADERS_RECEIVED;
          ProxyXHR.LOADING = XHR.LOADING;
          ProxyXHR.DONE = XHR.DONE;
          window.XMLHttpRequest = ProxyXHR;
        })();

      } catch(e) {
        console.warn('Proxy injection failed', e);
      }
    })();
  `;

  // Inject the proxy script into the head
  headElement.append(`<script>${proxyScript}</script>`);

  return $.html();
}

// Proxy endpoint (accept all methods to support fetch/XHR proxying)
app.all(PROXY_PATH, async (req, res) => {
  try {
    const targetDomain = req.query.target;

    if (!targetDomain) {
      return res.status(400).json({
        error: 'Missing target domain',
        example: `${PROXY_PATH}?target=https://example.com/page`,
      });
    }

    let targetUrl;
    try {
      targetUrl = new URL(targetDomain);
    } catch {
      return res.status(400).json({
        error: 'Invalid URL format',
        url: targetDomain,
      });
    }

    if (!isDomainAllowed(targetUrl.toString())) {
      return res.status(403).json({
        error: 'Domain not allowed',
        domain: targetUrl.hostname,
      });
    }

    const blockedCheck = await isTargetBlocked(targetUrl);
    if (blockedCheck.blocked) {
      return res.status(403).json({
        error: blockedCheck.reason,
        target: targetUrl.toString(),
      });
    }

    const forwardHeaders = { ...req.headers };
    delete forwardHeaders.host;
    delete forwardHeaders.cookie;
    delete forwardHeaders.connection;
    delete forwardHeaders['content-length'];
    delete forwardHeaders['accept-encoding'];
    delete forwardHeaders['upgrade-insecure-requests'];
    delete forwardHeaders['proxy-authorization'];
    delete forwardHeaders['x-forwarded-proto'];
    forwardHeaders['user-agent'] = forwardHeaders['user-agent'] ||
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

    const COOKIE_PREFIX = '__proxy__';
    let targetHost = targetUrl.hostname;
    let prefix = `${COOKIE_PREFIX}${targetHost}__`;

    const incomingCookieHeader = req.headers.cookie || '';
    const incomingCookies = {};
    incomingCookieHeader.split(/;\s*/).forEach((pair) => {
      if (!pair) return;
      const idx = pair.indexOf('=');
      if (idx < 0) return;
      const name = pair.substring(0, idx);
      const val = pair.substring(idx + 1);
      incomingCookies[name] = val;
    });

    const targetCookiePairs = [];
    Object.keys(incomingCookies).forEach((name) => {
      if (name.startsWith(prefix)) {
        const origName = name.substring(prefix.length);
        targetCookiePairs.push(`${origName}=${incomingCookies[name]}`);
      }
    });
    if (targetCookiePairs.length) {
      forwardHeaders.cookie = targetCookiePairs.join('; ');
    }

    const axiosOptions = {
      method: req.method,
      headers: forwardHeaders,
      timeout: 30000,
      validateStatus: () => true,
      responseType: 'arraybuffer',
      maxRedirects: 0,
      url: targetUrl.toString(),
    };

    if (req.method !== 'GET' && req.method !== 'HEAD' && req.body) {
      axiosOptions.data = req.body;
    }

    async function fetchTarget(urlObject, options, redirectCount = 0) {
      const response = await axios({ ...options, url: urlObject.toString() });
      if (response.status >= 300 && response.status < 400 && response.headers.location && redirectCount < MAX_REDIRECTS) {
        let nextUrl;
        try {
          nextUrl = new URL(response.headers.location, urlObject).toString();
        } catch {
          throw Object.assign(new Error('Invalid redirect location'), { status: 400 });
        }

        const nextUrlObject = new URL(nextUrl);
        const redirectBlocked = await isTargetBlocked(nextUrlObject);
        if (redirectBlocked.blocked) {
          throw Object.assign(new Error(redirectBlocked.reason), { status: 403 });
        }
        if (!isDomainAllowed(nextUrlObject.toString())) {
          throw Object.assign(new Error('Redirect target not allowed'), { status: 403 });
        }

        return fetchTarget(nextUrlObject, options, redirectCount + 1);
      }

      return { response, finalUrl: urlObject.toString() };
    }

    const { response, finalUrl } = await fetchTarget(targetUrl, axiosOptions);
    const finalTargetUrl = new URL(finalUrl);
    targetHost = finalTargetUrl.hostname;
    prefix = `${COOKIE_PREFIX}${targetHost}__`;

    const setCookieHeaders = response.headers['set-cookie'];
    if (setCookieHeaders && Array.isArray(setCookieHeaders)) {
      setCookieHeaders.forEach((raw) => {
        try {
          const parts = raw.split(';').map((p) => p.trim());
          const nameVal = parts[0] || '';
          const eq = nameVal.indexOf('=');
          if (eq <= 0) return;
          const origName = nameVal.substring(0, eq);
          const origVal = nameVal.substring(eq + 1);

          const proxiedName = `${prefix}${origName}`;
          const attrs = [];
          parts.slice(1).forEach((attr) => {
            const a = attr.split('=')[0].toLowerCase();
            if (a === 'domain' || a === 'secure') return;
            if (['expires', 'max-age', 'samesite', 'httponly', 'path'].includes(a)) {
              attrs.push(attr);
            }
          });
          if (!attrs.some((a) => /^path=/i.test(a))) attrs.push('Path=/');
          const finalCookie = `${proxiedName}=${origVal}; ${attrs.join('; ')}`;
          res.append('Set-Cookie', finalCookie);
        } catch {
          // ignore cookie parsing errors
        }
      });
    }

    const responseHeaders = { ...response.headers };
    delete responseHeaders['set-cookie'];
    const modifiedHeaders = modifyHeaders(responseHeaders, req.headers.origin);

    Object.entries(modifiedHeaders).forEach(([key, value]) => {
      try {
        res.setHeader(key, value);
      } catch (e) {
        // Skip headers that can't be set
      }
    });

    const contentType = (response.headers['content-type'] || '').toLowerCase();
    let content = response.data;
    const isText = /^(text\/|application\/(javascript|json|xml|x-javascript))/i.test(contentType);
    if (isText && Buffer.isBuffer(content)) {
      try {
        content = content.toString('utf8');
      } catch {
        content = content.toString();
      }
    }

    if (contentType.includes('text/html')) {
      content = processHtmlContent(content, finalUrl, PROXY_PATH);
      res.status(response.status).send(content);
    } else if (contentType.includes('text/css') || contentType.includes('application/x-css')) {
      content = rewriteUrls(content, finalUrl, PROXY_PATH);
      res.status(response.status).send(content);
    } else if (contentType.includes('application/javascript') || contentType.includes('text/javascript')) {
      content = rewriteUrls(content, finalUrl, PROXY_PATH);
      res.status(response.status).send(content);
    } else {
      res.status(response.status).send(response.data);
    }
  } catch (error) {
    console.error('Proxy error:', error && error.message ? error.message : error);
    const statusCode = error && error.status ? error.status : 500;
    res.status(statusCode).json({
      error: 'Proxy request failed',
      message: error && error.message ? error.message : 'Unknown error',
    });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Root endpoint with usage info
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Style Proxy Server</title>
      <style>
        body { font-family: Arial, sans-serif; max-width: 900px; margin: 40px auto; }
        code { background: #f4f4f4; padding: 2px 6px; border-radius: 3px; }
        pre { background: #f4f4f4; padding: 15px; border-radius: 5px; overflow-x: auto; }
        h2 { color: #333; }
        .endpoint { margin: 20px 0; }
      </style>
    </head>
    <body>
      <h1>🔄 Style Proxy Server</h1>
      <p>A Node.js proxy for cross-domain style inspection with header modification and URL rewriting.</p>

      <h2>Usage</h2>
      <div class="endpoint">
        <h3>Proxy Request</h3>
        <p>Make a GET request with the <code>target</code> parameter:</p>
        <pre>GET /proxy?target=https://example.com/page</pre>
        <p><strong>Example:</strong></p>
        <pre>curl "http://localhost:3000/proxy?target=https://example.com"</pre>
      </div>

      <div class="endpoint">
        <h3>Health Check</h3>
        <pre>GET /health</pre>
      </div>

      <h2>Features</h2>
      <ul>
        <li>✅ CORS header modification for cross-domain requests</li>
        <li>✅ Content Security Policy (CSP) relaxation</li>
        <li>✅ X-Frame-Options removal for iframe embedding</li>
        <li>✅ Automatic URL rewriting in HTML, CSS, and JavaScript</li>
        <li>✅ Support for relative and absolute URLs</li>
        <li>✅ Request timeout protection (30s default)</li>
        <li>✅ Domain whitelist support (configure via ALLOWED_DOMAINS env var)</li>
      </ul>

      <h2>Configuration</h2>
      <p>Set environment variables to customize behavior:</p>
      <pre>
ALLOWED_DOMAINS=example.com,example.org  # Comma-separated list or '*' for all
PORT=3000                                 # Default: 3000
NODE_ENV=production                       # Default: development
      </pre>

      <h2>Browser Usage</h2>
      <p>To browse a website through the proxy:</p>
      <pre>
// In browser console, navigate to proxy with target:
window.location = 'http://localhost:3000/proxy?target=' + encodeURIComponent('https://example.com')
      </pre>

      <h2>Security Note</h2>
      <p>⚠️ This proxy is designed for local style inspection only unless deployed with secure configuration.</p>
      <p>For production use, enable \`AUTH_REQUIRED=true\`, configure \`PROXY_API_KEYS\`, and restrict \`ALLOWED_DOMAINS\`.</p>
    </body>
    </html>
  `);
});

// Start server
app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════╗
║   🔄 Style Proxy Server Started              ║
╚══════════════════════════════════════════════╝

📍 Server running at: http://localhost:${PORT}
🔗 Usage: http://localhost:${PORT}/proxy?target=https://example.com

Configuration:
  - Allowed Domains: ${CONFIG.allowedDomains.join(', ')}
  - Modify CSP: ${CONFIG.modifyCSP}
  - Modify X-Frame-Options: ${CONFIG.modifyXFrameOptions}
  - Rewrite URLs: ${CONFIG.rewriteUrls}
  - Request Logging: ${CONFIG.logRequests}

📖 Visit http://localhost:${PORT} for more information
  `);
});
