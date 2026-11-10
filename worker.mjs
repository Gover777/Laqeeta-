/**
 * Cloudflare Worker for Laqeeta - Reverse Proxy to Render Django Backend
 */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Determine target Render origin domain from env or default fallback
    const renderOrigin = env?.RENDER_BACKEND_URL || 'https://laqeeta.onrender.com';
    const targetUrl = new URL(url.pathname + url.search, renderOrigin);

    // Clone and customize headers sent to Render backend
    const headers = new Headers(request.headers);

    // Pass CF connecting client IP
    const cfConnectingIp = request.headers.get('CF-Connecting-IP');
    if (cfConnectingIp) {
      headers.set('X-Forwarded-For', cfConnectingIp);
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
      headers: headers,
      redirect: 'manual',
    };

    // Forward request body for non-GET/HEAD requests
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      fetchOptions.body = request.body;
    }

    try {
      const response = await fetch(targetUrl.toString(), fetchOptions);
      return response;
    } catch (error) {
      return new Response(`Worker Proxy Error: ${error.message}`, {
        status: 502,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      });
    }
  },
};
