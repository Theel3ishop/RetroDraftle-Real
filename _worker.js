const ALLOWED_YEAR = /^(200[0-9]|201[0-9]|202[0-5])$/;
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "default-src 'self'; script-src 'self' https://unpkg.com; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self' https://0.peerjs.com https://*.peerjs.com wss://0.peerjs.com wss://*.peerjs.com; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; upgrade-insecure-requests",
};

function withSecurityHeaders(response) {
  const headers = new Headers(response.headers);
  Object.entries(SECURITY_HEADERS).forEach(([name, value]) => headers.set(name, value));
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

async function archive(request, ctx) {
  const year = new URL(request.url).searchParams.get('year') || '';
  if (!ALLOWED_YEAR.test(year)) return Response.json({ error: 'Invalid season.' }, { status: 400 });
  const cacheKey = new Request(request.url, { method: 'GET' });
  const cached = await caches.default.match(cacheKey);
  if (cached) return withSecurityHeaders(cached);
  const upstreamUrl = `https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_${year}.csv`;
  const upstream = await fetch(upstreamUrl, { headers: { 'User-Agent': 'Retro-Draftle' } });
  if (!upstream.ok) return Response.json({ error: `Could not load the ${year} archive.` }, { status: upstream.status });
  const response = new Response(upstream.body, { headers: { 'Cache-Control': 'public, max-age=86400', 'Content-Type': 'text/csv; charset=utf-8' } });
  ctx.waitUntil(caches.default.put(cacheKey, response.clone()));
  return withSecurityHeaders(response);
}

export default {
  async fetch(request, env, ctx) {
    if (new URL(request.url).pathname === '/api/nflverse') return archive(request, ctx);
    return withSecurityHeaders(await env.ASSETS.fetch(request));
  },
};