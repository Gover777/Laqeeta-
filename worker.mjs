/**
 * Cloudflare Worker for Laqeeta - Hardened Reverse Proxy to Render Django Backend
 */

const BLOCKED_PATH_PATTERNS = [
  /^\/\.env/i,
  /^\/\.git/i,
  /\.(sql|sqlite|sqlite3|bak|backup|swp|log|pem|key|ini)$/i,
  /^\/(render\.yaml|run_server\.py|firebase-applet-config\.json|package\.json|bun\.lock)$/i,
];

const SECURITY_HEADERS = {
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy':
    "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'",
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // 1. Enforce HTTPS redirect at the edge
    if (url.protocol === 'http:') {
      url.protocol = 'https:';
      return Response.redirect(url.toString(), 301);
    }

    // 2. Block direct access to exposed config, backup, VCS, or database paths
    if (BLOCKED_PATH_PATTERNS.some((pattern) => pattern.test(url.pathname))) {
      return new Response('Not Found', {
        status: 404,
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          ...SECURITY_HEADERS,
        },
      });
    }

    // Determine target Render origin domain from env or default fallback
    const renderOrigin = env?.RENDER_BACKEND_URL || 'https://laqeeta.onrender.com';
    const targetUrl = new URL(url.pathname + url.search, renderOrigin);

    // 3. Clone headers and strip spoofable client/proxy headers
    const headers = new Headers(request.headers);
    headers.delete('X-Forwarded-For');
    headers.delete('X-Laqeeta-Client-IP');
    headers.delete('X-Laqeeta-Proxy-Key');

    // Pass authenticated CF connecting IP to Django EdgeProxyMiddleware
    const cfConnectingIp = request.headers.get('CF-Connecting-IP');
    if (cfConnectingIp) {
      headers.set('X-Forwarded-For', cfConnectingIp);
      headers.set('X-Laqeeta-Client-IP', cfConnectingIp);
    }

    // Attach shared Edge Proxy Secret from Worker secret env
    if (env?.EDGE_PROXY_SECRET) {
      headers.set('X-Laqeeta-Proxy-Key', env.EDGE_PROXY_SECRET);
    }

    // Custom Browser Headers & Forwarded Context
    headers.set(
      'User-Agent',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );
    headers.set(
      'Accept',
      'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8'
    );
    headers.set('Accept-Language', 'ar,en-US;q=0.9,en;q=0.8');
    headers.set('Referer', 'https://laqeeta.eu.org/');
    headers.set('Origin', 'https://laqeeta.eu.org');
    headers.set('X-Forwarded-Proto', 'https');
    headers.set('X-Forwarded-Host', url.hostname);

    // Fetch options with manual redirect handling to avoid loops
    const fetchOptions = {
      method: request.method,
      headers,
      redirect: 'manual',
    };

    // Forward request body for non-GET/HEAD requests
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      fetchOptions.body = request.body;
    }

    try {
      const originResponse = await fetch(targetUrl.toString(), fetchOptions);
      const responseHeaders = new Headers(originResponse.headers);

      // Remove any wildcard CORS header and enforce strict security headers
      if (responseHeaders.get('Access-Control-Allow-Origin') === '*') {
        responseHeaders.delete('Access-Control-Allow-Origin');
      }
      for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
        if (!responseHeaders.has(key)) {
          responseHeaders.set(key, value);
        }
      }

      return new Response(originResponse.body, {
        status: originResponse.status,
        statusText: originResponse.statusText,
        headers: responseHeaders,
      });
    } catch (error) {
      return new Response('Service temporarily unavailable.', {
        status: 502,
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          ...SECURITY_HEADERS,
        },
      });
    }
  },
};
