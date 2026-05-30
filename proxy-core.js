const axios = require('axios');
const cheerio = require('cheerio');
const express = require('express');
const urlJoin = require('url-join');

function resolveUrl(path, baseUrl) {
  if (!path || !baseUrl) return path || baseUrl;

  try {
    const normalizedBase = new URL(baseUrl).href;
    if (/^https?:\/\//.test(path)) {
      return path;
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

function rewriteUrls(content, targetDomain, proxyPath, rewriteEnabled = true) {
  if (!rewriteEnabled) return content;

  const targetBase = targetDomain;
  let rewritten = content;

  rewritten = rewritten.replace(/href=["']([^"']+)["']/gi, (match, urlPart) => {
    const trimmed = urlPart.trim();
    if (!shouldProxyAssetUrl(trimmed, targetBase)) return match;
    const absoluteUrl = resolveUrl(trimmed, targetBase);
    const proxyUrl = `${proxyPath}?target=${encodeURIComponent(absoluteUrl)}`;
    return match.replace(urlPart, proxyUrl);
  });

  rewritten = rewritten.replace(/src=["']([^"']+)["']/gi, (match, urlPart) => {
    const trimmed = urlPart.trim();
    if (!shouldProxyAssetUrl(trimmed, targetBase)) return match;
    const absoluteUrl = resolveUrl(trimmed, targetBase);
    const proxyUrl = `${proxyPath}?target=${encodeURIComponent(absoluteUrl)}`;
    return match.replace(urlPart, proxyUrl);
  });

  rewritten = rewritten.replace(/url\(\s*(['"]?)([^"')]+)\1\s*\)/gi, (match, quote, urlPart) => {
    const trimmed = urlPart.trim();
    if (!shouldProxyAssetUrl(trimmed, targetBase)) return match;
    const absoluteUrl = resolveUrl(trimmed, targetBase);
    const proxyUrl = `${proxyPath}?target=${encodeURIComponent(absoluteUrl)}`;
    const useQuote = quote || "'";
    return `url(${useQuote}${proxyUrl}${useQuote})`;
  });

  rewritten = rewritten.replace(/@import\s+url\(\s*(['"]?)([^"')]+)\1\s*\)/gi, (match, quote, urlPart) => {
    const trimmed = urlPart.trim();
    if (!shouldProxyAssetUrl(trimmed, targetBase)) return match;
    const absoluteUrl = resolveUrl(trimmed, targetBase);
    const proxyUrl = `${proxyPath}?target=${encodeURIComponent(absoluteUrl)}`;
    const useQuote = quote || "'";
    return `@import url(${useQuote}${proxyUrl}${useQuote})`;
  });

  rewritten = rewritten.replace(/@import\s+(['"])([^"']+)\1/gi, (match, quote, urlPart) => {
    const trimmed = urlPart.trim();
    if (!shouldProxyAssetUrl(trimmed, targetBase)) return match;
    const absoluteUrl = resolveUrl(trimmed, targetBase);
    const proxyUrl = `${proxyPath}?target=${encodeURIComponent(absoluteUrl)}`;
    return `@import url(${quote}${proxyUrl}${quote})`;
  });

  return rewritten;
}

function processHtmlContent(content, targetDomain, proxyPath) {
  const $ = cheerio.load(content, { decodeEntities: false });
  const headElement = $('head');

  let charsetMeta = $('meta[charset]');
  if (!charsetMeta.length) {
    charsetMeta = $('meta[http-equiv="Content-Type"]');
  }
  if (charsetMeta.length) {
    charsetMeta.remove();
  }
  headElement.prepend('<meta charset="UTF-8">');

  let viewportMeta = $('meta[name="viewport"]');
  if (!viewportMeta.length) {
    headElement.prepend('<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">');
  } else {
    const currentViewport = viewportMeta.attr('content') || '';
    if (!currentViewport.includes('width=device-width')) {
      viewportMeta.attr('content', 'width=device-width, initial-scale=1.0, viewport-fit=cover');
    }
  }

  let uaCompatMeta = $('meta[http-equiv="X-UA-Compatible"]');
  if (uaCompatMeta.length) {
    uaCompatMeta.attr('content', 'IE=edge');
  } else {
    headElement.prepend('<meta http-equiv="X-UA-Compatible" content="IE=edge">');
  }

  let referrerMeta = $('meta[name="referrer"]');
  if (referrerMeta.length) {
    referrerMeta.attr('content', 'no-referrer');
  } else {
    headElement.prepend('<meta name="referrer" content="no-referrer">');
  }

  let cspMeta = $('meta[http-equiv="Content-Security-Policy"]');
  if (cspMeta.length) {
    cspMeta.remove();
    headElement.prepend('<meta http-equiv="Content-Security-Policy" content="default-src * \'unsafe-inline\' \'unsafe-eval\'; script-src * \'unsafe-inline\' \'unsafe-eval\'; style-src * \'unsafe-inline\'; img-src * data:; font-src * data:; connect-src *;">');
  }

  $('meta[http-equiv="X-Frame-Options"]').remove();
  $('meta[http-equiv="X-Content-Type-Options"]').remove();

  let colorSchemeMeta = $('meta[name="color-scheme"]');
  if (!colorSchemeMeta.length) {
    headElement.prepend('<meta name="color-scheme" content="light dark">');
  }

  if (!$('meta[name="theme-color"]').length) {
    headElement.prepend('<meta name="theme-color" content="#ffffff">');
  }

  $('meta[name="proxy-target"]').remove();
  headElement.prepend(`<meta name="proxy-target" content="${new URL(targetDomain).hostname}">`);
  headElement.prepend(`<meta name="proxy-timestamp" content="${new Date().toISOString()}">`);
  $('meta[name="proxy-base"]').remove();
  headElement.prepend(`<meta name="proxy-base" content="${new URL(targetDomain).origin}">`);

  $('[href]').each((i, el) => {
    const href = $(el).attr('href');
    if (shouldProxyAssetUrl(href, targetDomain)) {
      const absoluteUrl = resolveUrl(href, targetDomain);
      $(el).attr('href', `${proxyPath}?target=${encodeURIComponent(absoluteUrl)}`);
    }
  });

  $('form[action]').each((i, el) => {
    const action = $(el).attr('action');
    if (shouldProxyAssetUrl(action, targetDomain)) {
      const absoluteUrl = resolveUrl(action, targetDomain);
      $(el).attr('action', `${proxyPath}?target=${encodeURIComponent(absoluteUrl)}`);
    }
  });

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

  const baseTag = $('base');
  if (baseTag.length) {
    baseTag.remove();
  }

  const proxyBaseHref = `${proxyPath}?target=${encodeURIComponent(new URL(targetDomain).origin + '/')}`;
  headElement.prepend(`<base href="${proxyBaseHref}">`);

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

  headElement.append(`<script>${proxyScript}</script>`);

  return $.html();
}

function createProxyHandler({ proxyPath = '/api/proxy', rewriteUrlsEnabled = true, modifyCSP = true, maxRedirects = 5, timeout = 30000 } = {}) {
  return async function proxyHandler(req, res) {
    try {
      const targetDomain = req.query.target;

      if (!targetDomain) {
        return res.status(400).json({
          error: 'Missing target domain',
          example: `${proxyPath}?target=https://example.com/page`,
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

      if (!['http:', 'https:'].includes(targetUrl.protocol)) {
        return res.status(400).json({
          error: 'Unsupported protocol',
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
        timeout,
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
        if (response.status >= 300 && response.status < 400 && response.headers.location && redirectCount < maxRedirects) {
          let nextUrl;
          try {
            nextUrl = new URL(response.headers.location, urlObject).toString();
          } catch {
            throw Object.assign(new Error('Invalid redirect location'), { status: 400 });
          }

          const nextUrlObject = new URL(nextUrl);
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
      const modifiedHeaders = modifyHeaders(responseHeaders, req.headers.origin, { modifyCSP });

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
        content = processHtmlContent(content, finalUrl, proxyPath);
        res.status(response.status).send(content);
      } else if (contentType.includes('text/css') || contentType.includes('application/x-css')) {
        content = rewriteUrls(content, finalUrl, proxyPath, rewriteUrlsEnabled);
        res.status(response.status).send(content);
      } else if (contentType.includes('application/javascript') || contentType.includes('text/javascript')) {
        content = rewriteUrls(content, finalUrl, proxyPath, rewriteUrlsEnabled);
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
  };
}

function createProxyRouter(options = {}) {
  const router = express.Router();
  const path = options.proxyPath || '/api/proxy';
  router.all(path, createProxyHandler(options));
  return router;
}

module.exports = {
  createProxyHandler,
  createProxyRouter,
};
