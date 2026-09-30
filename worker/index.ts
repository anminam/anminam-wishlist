interface Env {
  DB: D1Database;
  WISH_IMAGES: R2Bucket;
  ADMIN_TOKEN?: string;
}

type WishInput = {
  title?: string;
  url?: string;
  image_url?: string | null;
  price?: number | null;
  currency?: string | null;
  category?: string | null;
  reason?: string | null;
};

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };

function json(data: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { ...JSON_HEADERS, ...(init.headers || {}) },
  });
}

function unauthorized() {
  return json({ error: "관리자 인증이 필요합니다." }, { status: 401 });
}

function isAuthorized(request: Request, env: Env) {
  if (!env.ADMIN_TOKEN) return false;
  return request.headers.get("authorization") === `Bearer ${env.ADMIN_TOKEN}`;
}

function normalizeText(value: unknown, max = 1000) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function isSafePublicHttpUrl(raw: string) {
  try {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol)) return false;
    const h = url.hostname.toLowerCase();
    if (h === 'localhost' || h.endsWith('.local')) return false;
    if (/^(127\.|0\.|10\.|192\.168\.|169\.254\.)/.test(h)) return false;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return false;
    if (h === '::1' || h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80:')) return false;
    return true;
  } catch {
    return false;
  }
}

function decodeHtml(text: string) {
  const named: Record<string, string> = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ' };
  return text
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (_, entity: string) => {
      if (entity[0] === '#') {
        const hex = entity[1]?.toLowerCase() === 'x';
        const num = parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
        return Number.isFinite(num) ? String.fromCodePoint(num) : _;
      }
      return named[entity.toLowerCase()] ?? _;
    })
    .replace(/\s+/g, ' ')
    .trim();
}

function meta(html: string, key: string) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name|itemprop)=["']${escaped}["'][^>]+content=["']([^"']*)["'][^>]*>`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name|itemprop)=["']${escaped}["'][^>]*>`, 'i'),
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return decodeHtml(match[1]);
  }
  return '';
}

function htmlTitle(html: string) {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match?.[1] ? decodeHtml(match[1].replace(/<[^>]+>/g, '')) : '';
}

function walkJson(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = walkJson(item);
      if (found) return found;
    }
    return null;
  }
  const obj = value as Record<string, unknown>;
  const type = obj['@type'];
  if (type === 'Product' || (Array.isArray(type) && type.includes('Product'))) return obj;
  for (const child of Object.values(obj)) {
    const found = walkJson(child);
    if (found) return found;
  }
  return null;
}

function productJsonLd(html: string) {
  const scripts = [...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for (const script of scripts) {
    try {
      const parsed = JSON.parse(script[1].trim());
      const product = walkJson(parsed);
      if (product) return product;
    } catch { /* invalid JSON-LD */ }
  }
  return null;
}

function normalizeImage(value: unknown) {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  if (value && typeof value === 'object') {
    const url = (value as Record<string, unknown>).url;
    if (typeof url === 'string') return url;
  }
  return '';
}

function extractProductMetadata(html: string, pageUrl: string) {
  const product = productJsonLd(html);
  const offers = product?.offers;
  const offer = Array.isArray(offers) ? offers[0] : offers;
  const offerObj = offer && typeof offer === 'object' ? offer as Record<string, unknown> : null;
  const priceText = String(
    offerObj?.price ?? product?.price ?? meta(html, 'product:price:amount') ?? meta(html, 'price') ?? ''
  ).replace(/[^0-9.]/g, '');
  const price = priceText ? Number(priceText) : null;
  const title = String(product?.name ?? meta(html, 'og:title') ?? meta(html, 'twitter:title') ?? htmlTitle(html) ?? '');
  const image = normalizeImage(product?.image) || meta(html, 'og:image') || meta(html, 'twitter:image');
  const currency = String(offerObj?.priceCurrency ?? meta(html, 'product:price:currency') ?? 'KRW').toUpperCase();
  return {
    title: decodeHtml(title).slice(0, 300),
    image: image ? new URL(image, pageUrl).toString() : '',
    price: Number.isFinite(price) ? price : null,
    currency: currency.slice(0, 8) || 'KRW',
    source: new URL(pageUrl).hostname.replace(/^www\./, ''),
  };
}

async function fetchMetadata(request: Request, env: Env) {
  if (!isAuthorized(request, env)) return unauthorized();
  const body = await request.json().catch(() => ({})) as { url?: string };
  const rawUrl = normalizeText(body.url, 2048);
  if (!isSafePublicHttpUrl(rawUrl)) return json({ error: '유효한 공개 http/https URL을 입력해주세요.' }, { status: 400 });
  try {
    const response = await fetch(rawUrl, {
      redirect: 'follow',
      headers: {
        'user-agent': 'Mozilla/5.0 (compatible; AnminamWishlist/1.0; +https://workers.cloudflare.com)',
        'accept': 'text/html,application/xhtml+xml',
      },
    });
    if (!response.ok) return json({ error: `원본 사이트 응답 오류 (${response.status})` }, { status: 422 });
    const type = response.headers.get('content-type') || '';
    if (!type.includes('text/html')) return json({ error: 'HTML 상품 페이지가 아닙니다.' }, { status: 422 });
    const html = (await response.text()).slice(0, 1_500_000);
    return json(extractProductMetadata(html, response.url || rawUrl));
  } catch {
    return json({ error: '상품 페이지를 불러오지 못했습니다. 사이트가 자동 접근을 차단했을 수 있어요.' }, { status: 422 });
  }
}

function extensionFor(contentType: string, url: string) {
  if (contentType.includes('png')) return 'png';
  if (contentType.includes('webp')) return 'webp';
  if (contentType.includes('gif')) return 'gif';
  if (contentType.includes('avif')) return 'avif';
  if (contentType.includes('jpeg') || contentType.includes('jpg')) return 'jpg';
  const ext = new URL(url).pathname.split('.').pop()?.toLowerCase();
  return ext && /^[a-z0-9]{2,5}$/.test(ext) ? ext : 'img';
}

async function mirrorImage(imageUrl: string, id: string, env: Env) {
  if (!imageUrl || !isSafePublicHttpUrl(imageUrl)) return null;
  try {
    const response = await fetch(imageUrl, { redirect: 'follow' });
    if (!response.ok || !response.body) return null;
    const contentType = response.headers.get('content-type') || 'application/octet-stream';
    if (!contentType.startsWith('image/')) return null;
    const key = `wish-images/${id}.${extensionFor(contentType, response.url || imageUrl)}`;
    await env.WISH_IMAGES.put(key, response.body, { httpMetadata: { contentType } });
    return key;
  } catch {
    return null;
  }
}

async function listWishes(env: Env) {
  const result = await env.DB.prepare(`
    SELECT id, title, url, image_url, image_key, price, currency, category, reason, source, purchased, created_at, updated_at
    FROM wishes ORDER BY datetime(created_at) DESC
  `).all();
  return json({ wishes: result.results ?? [] });
}

async function createWish(request: Request, env: Env, ctx: ExecutionContext) {
  if (!isAuthorized(request, env)) return unauthorized();
  const input = await request.json().catch(() => ({})) as WishInput;
  const title = normalizeText(input.title, 300);
  const url = normalizeText(input.url, 2048);
  if (!title || !isSafePublicHttpUrl(url)) return json({ error: '상품명과 올바른 URL이 필요합니다.' }, { status: 400 });
  const id = crypto.randomUUID();
  const imageUrl = normalizeText(input.image_url, 2048) || null;
  const source = new URL(url).hostname.replace(/^www\./, '');
  const price = typeof input.price === 'number' && Number.isFinite(input.price) ? Math.round(input.price) : null;
  const currency = normalizeText(input.currency, 8) || 'KRW';
  const category = normalizeText(input.category, 100) || null;
  const reason = normalizeText(input.reason, 2000) || null;
  let imageKey: string | null = null;
  if (imageUrl) imageKey = await mirrorImage(imageUrl, id, env);

  await env.DB.prepare(`
    INSERT INTO wishes (id, title, url, image_url, image_key, price, currency, category, reason, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(id, title, url, imageUrl, imageKey, price, currency, category, reason, source).run();

  const wish = await env.DB.prepare('SELECT * FROM wishes WHERE id = ?').bind(id).first();
  return json({ wish }, { status: 201 });
}

async function deleteWish(request: Request, env: Env, id: string) {
  if (!isAuthorized(request, env)) return unauthorized();
  const row = await env.DB.prepare('SELECT image_key FROM wishes WHERE id = ?').bind(id).first<{ image_key?: string }>();
  await env.DB.prepare('DELETE FROM wishes WHERE id = ?').bind(id).run();
  if (row?.image_key) await env.WISH_IMAGES.delete(row.image_key);
  return json({ ok: true });
}

async function getImage(env: Env, key: string) {
  const object = await env.WISH_IMAGES.get(key);
  if (!object) return new Response('Not found', { status: 404 });
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);
  headers.set('cache-control', 'public, max-age=604800, immutable');
  return new Response(object.body, { headers });
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url);

    if (request.method === 'GET' && url.pathname === '/api/wishes') return listWishes(env);
    if (request.method === 'POST' && url.pathname === '/api/wishes') return createWish(request, env, ctx);
    if (request.method === 'POST' && url.pathname === '/api/metadata') return fetchMetadata(request, env);

    const deleteMatch = url.pathname.match(/^\/api\/wishes\/([^/]+)$/);
    if (request.method === 'DELETE' && deleteMatch) return deleteWish(request, env, decodeURIComponent(deleteMatch[1]));

    const imageMatch = url.pathname.match(/^\/api\/images\/(.+)$/);
    if (request.method === 'GET' && imageMatch) return getImage(env, decodeURIComponent(imageMatch[1]));

    return json({ error: 'Not found' }, { status: 404 });
  },
} satisfies ExportedHandler<Env>;
