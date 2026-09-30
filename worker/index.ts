type AppEnv = Env & { ADMIN_TOKEN?: string };

type Visibility = "public" | "unlisted" | "private";
type WishStatus = "wanted" | "purchased" | "archived";

type WishInput = {
  title?: unknown;
  url?: unknown;
  image_url?: unknown;
  image_key?: unknown;
  price?: unknown;
  target_price?: unknown;
  currency?: unknown;
  category?: unknown;
  reason?: unknown;
  source?: unknown;
  status?: unknown;
  priority?: unknown;
  visibility?: unknown;
  collection_id?: unknown;
  track_price?: unknown;
  tags?: unknown;
};

type WishRow = {
  id: string;
  title: string;
  url: string;
  image_url: string | null;
  image_key: string | null;
  price: number | null;
  currency: string;
  category: string | null;
  reason: string | null;
  source: string | null;
  purchased: number;
  status: WishStatus;
  priority: number;
  target_price: number | null;
  purchased_at: string | null;
  visibility: Visibility;
  share_slug: string | null;
  collection_id: string | null;
  collection_name: string | null;
  collection_slug: string | null;
  track_price: number;
  last_price_checked_at: string | null;
  created_at: string;
  updated_at: string;
  tags?: string[];
  price_history?: Array<{ price: number; captured_at: string }>;
  reserved?: boolean;
  reservation?: { id: string; guest_name: string | null; message: string | null; expires_at: string } | null;
};

type PriceTrackRow = Pick<WishRow, "id" | "title" | "url" | "price" | "target_price" | "currency">;

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };
const MAX_JSON_BYTES = 2_000_000;
const MAX_HTML_BYTES = 1_500_000;
const MAX_IMAGE_BYTES = 8_000_000;
const IMAGE_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
};

function json(data: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { ...JSON_HEADERS, ...(init.headers || {}) },
  });
}

function unauthorized() {
  return json({ error: "관리자 인증이 필요합니다." }, { status: 401 });
}

function normalizeText(value: unknown, max = 1000) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function normalizeNullableText(value: unknown, max = 1000) {
  return normalizeText(value, max) || null;
}

function normalizeInteger(value: unknown, minimum = 0) {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum
    ? Math.round(value)
    : null;
}

function normalizeVisibility(value: unknown): Visibility {
  return value === "unlisted" || value === "private" ? value : "public";
}

function normalizeStatus(value: unknown): WishStatus {
  return value === "purchased" || value === "archived" ? value : "wanted";
}

function normalizePriority(value: unknown) {
  return value === 1 || value === 3 ? value : 2;
}

function normalizeTags(value: unknown) {
  const source = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
  return [...new Set(source.map((tag) => normalizeText(tag, 30).replace(/^#+/, "")).filter(Boolean))].slice(0, 12);
}

async function isAuthorized(request: Request, env: AppEnv) {
  if (!env.ADMIN_TOKEN) return false;
  const authorization = request.headers.get("authorization") || "";
  const provided = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  const encoder = new TextEncoder();
  const [providedHash, expectedHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(provided)),
    crypto.subtle.digest("SHA-256", encoder.encode(env.ADMIN_TOKEN)),
  ]);
  const workerSubtle = crypto.subtle as SubtleCrypto & {
    timingSafeEqual(a: ArrayBuffer, b: ArrayBuffer): boolean;
  };
  return workerSubtle.timingSafeEqual(providedHash, expectedHash);
}

function isSafePublicHttpUrl(raw: string) {
  try {
    const url = new URL(raw);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return false;
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (!host || host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) return false;
    if (host === "::" || host === "::1" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80:")) return false;
    const parts = host.split(".").map(Number);
    if (parts.length === 4 && parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)) {
      const [a, b] = parts;
      if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
      if (a === 169 && b === 254) return false;
      if (a === 172 && b >= 16 && b <= 31) return false;
      if (a === 192 && b === 168) return false;
      if (a === 100 && b >= 64 && b <= 127) return false;
      if (a === 198 && (b === 18 || b === 19)) return false;
    }
    return true;
  } catch {
    return false;
  }
}

async function safeFetch(rawUrl: string, init: RequestInit = {}, maxRedirects = 5) {
  let current = rawUrl;
  for (let redirect = 0; redirect <= maxRedirects; redirect += 1) {
    if (!isSafePublicHttpUrl(current)) throw new Error("unsafe_url");
    const response = await fetch(current, { ...init, redirect: "manual" });
    if (response.status < 300 || response.status >= 400) return response;
    const location = response.headers.get("location");
    if (!location || redirect === maxRedirects) return response;
    await response.body?.cancel();
    current = new URL(location, current).toString();
  }
  throw new Error("too_many_redirects");
}

async function readTextLimited(stream: ReadableStream<Uint8Array> | null, limit: number) {
  if (!stream) return "";
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    if (size + value.byteLength > limit) {
      await reader.cancel();
      throw new Error("payload_too_large");
    }
    chunks.push(value);
    size += value.byteLength;
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

async function readJson(request: Request, limit = 64_000): Promise<Record<string, unknown>> {
  const length = Number(request.headers.get("content-length") || 0);
  if (length > limit) throw new Error("payload_too_large");
  const text = await readTextLimited(request.body, limit);
  const value: unknown = text ? JSON.parse(text) : {};
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid_json");
  return value as Record<string, unknown>;
}

function limitStream(stream: ReadableStream<Uint8Array>, limit: number) {
  let size = 0;
  return stream.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      size += chunk.byteLength;
      if (size > limit) throw new Error("image_too_large");
      controller.enqueue(chunk);
    },
  }));
}

function decodeHtml(text: string) {
  const named: Record<string, string> = { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", nbsp: " " };
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity: string) => {
    if (entity[0] === "#") {
      const hex = entity[1]?.toLowerCase() === "x";
      const code = parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return named[entity.toLowerCase()] ?? match;
  }).replace(/\s+/g, " ").trim();
}

function meta(html: string, key: string) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name|itemprop)=["']${escaped}["'][^>]+content=["']([^"']*)["'][^>]*>`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name|itemprop)=["']${escaped}["'][^>]*>`, "i"),
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return decodeHtml(match[1]);
  }
  return "";
}

function htmlTitle(html: string) {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match?.[1] ? decodeHtml(match[1].replace(/<[^>]+>/g, "")) : "";
}

function looksLikeHtml(text: string) {
  return /^\uFEFF?\s*(?:<!doctype\s+html|<html\b|<head\b|<meta\b)/i.test(text.slice(0, 1024));
}

function sourceLabel(rawUrl: string) {
  const host = new URL(rawUrl).hostname.replace(/^www\./, "").toLowerCase();
  if (host.includes("kyobobook.co.kr")) return "교보문고";
  if (host.includes("musinsa")) return "무신사";
  return host;
}

function walkJson(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = walkJson(item);
      if (found) return found;
    }
    return null;
  }
  const object = value as Record<string, unknown>;
  const type = object["@type"];
  if (type === "Product" || (Array.isArray(type) && type.includes("Product"))) return object;
  for (const child of Object.values(object)) {
    const found = walkJson(child);
    if (found) return found;
  }
  return null;
}

function productJsonLd(html: string) {
  const scripts = [...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for (const script of scripts) {
    try {
      const product = walkJson(JSON.parse(script[1].trim()));
      if (product) return product;
    } catch {
      // Broken JSON-LD is common. Other metadata sources remain available.
    }
  }
  return null;
}

function normalizeImage(value: unknown) {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  if (value && typeof value === "object") {
    const url = (value as Record<string, unknown>).url;
    if (typeof url === "string") return url;
  }
  return "";
}

function extractProductMetadata(html: string, pageUrl: string) {
  const product = productJsonLd(html);
  const offers = product?.offers;
  const offer = Array.isArray(offers) ? offers[0] : offers;
  const offerObject = offer && typeof offer === "object" ? offer as Record<string, unknown> : null;
  const priceText = String(offerObject?.price ?? product?.price ?? meta(html, "product:price:amount") ?? meta(html, "price") ?? "")
    .replace(/[^0-9.]/g, "");
  const price = priceText ? Number(priceText) : null;
  const title = String(product?.name ?? meta(html, "og:title") ?? meta(html, "twitter:title") ?? htmlTitle(html));
  const rawImage = normalizeImage(product?.image) || meta(html, "og:image") || meta(html, "twitter:image");
  const image = rawImage ? new URL(rawImage, pageUrl).toString() : "";
  return {
    title: decodeHtml(title).slice(0, 300),
    image: isSafePublicHttpUrl(image) ? image : "",
    price: Number.isFinite(price) ? price : null,
    currency: String(offerObject?.priceCurrency ?? meta(html, "product:price:currency") ?? "KRW").toUpperCase().slice(0, 8),
    source: sourceLabel(pageUrl),
  };
}

async function metadataFromUrl(rawUrl: string) {
  const response = await safeFetch(rawUrl, {
    headers: {
      "user-agent": "Mozilla/5.0 (compatible; AnminamWishlist/1.0)",
      accept: "text/html,application/xhtml+xml",
      "accept-language": "ko-KR,ko;q=0.9,en;q=0.6",
    },
  });
  if (!response.ok) throw new Error(`origin_${response.status}`);
  const declaredLength = Number(response.headers.get("content-length") || 0);
  if (declaredLength > MAX_HTML_BYTES) throw new Error("payload_too_large");
  const html = await readTextLimited(response.body, MAX_HTML_BYTES);
  const type = response.headers.get("content-type") || "";
  if (!type.includes("text/html") && !looksLikeHtml(html)) throw new Error("not_html");
  return extractProductMetadata(html, response.url || rawUrl);
}

async function handleMetadata(request: Request, env: AppEnv) {
  if (!await isAuthorized(request, env)) return unauthorized();
  const body = await readJson(request);
  const rawUrl = normalizeText(body.url, 2048);
  if (!isSafePublicHttpUrl(rawUrl)) return json({ error: "유효한 공개 http/https URL을 입력해주세요." }, { status: 400 });
  try {
    return json(await metadataFromUrl(rawUrl));
  } catch (error) {
    const detail = error instanceof Error ? error.message : "unknown";
    console.warn(JSON.stringify({ message: "metadata_fetch_failed", detail, host: new URL(rawUrl).hostname }));
    return json({ error: "상품 정보를 자동으로 읽지 못했습니다. 상품명과 이미지를 직접 입력해주세요." }, { status: 422 });
  }
}

async function mirrorImage(imageUrl: string, id: string, env: AppEnv) {
  if (!imageUrl || !isSafePublicHttpUrl(imageUrl)) return null;
  const response = await safeFetch(imageUrl, { headers: { accept: "image/*" } });
  if (!response.ok || !response.body) return null;
  const contentType = (response.headers.get("content-type") || "").split(";")[0].toLowerCase();
  const extension = IMAGE_TYPES[contentType];
  const length = Number(response.headers.get("content-length") || 0);
  if (!extension || length > MAX_IMAGE_BYTES) {
    await response.body.cancel();
    return null;
  }
  const key = `wish-images/${id}.${extension}`;
  try {
    await env.WISH_IMAGES.put(key, limitStream(response.body, MAX_IMAGE_BYTES), {
      httpMetadata: { contentType, cacheControl: "public, max-age=604800" },
    });
    return key;
  } catch {
    await env.WISH_IMAGES.delete(key);
    return null;
  }
}

async function uploadImage(request: Request, env: AppEnv) {
  if (!await isAuthorized(request, env)) return unauthorized();
  const contentType = (request.headers.get("content-type") || "").split(";")[0].toLowerCase();
  const extension = IMAGE_TYPES[contentType];
  const length = Number(request.headers.get("content-length") || 0);
  if (!extension) return json({ error: "JPG, PNG, WebP, GIF, AVIF 이미지만 올릴 수 있습니다." }, { status: 415 });
  if (!request.body || length > MAX_IMAGE_BYTES) return json({ error: "이미지는 8MB 이하여야 합니다." }, { status: 413 });
  const key = `wish-uploads/${crypto.randomUUID()}.${extension}`;
  try {
    await env.WISH_IMAGES.put(key, limitStream(request.body, MAX_IMAGE_BYTES), {
      httpMetadata: { contentType, cacheControl: "public, max-age=604800" },
    });
    return json({ image_key: key, image_url: `/api/images/${key}` }, { status: 201 });
  } catch {
    await env.WISH_IMAGES.delete(key);
    return json({ error: "이미지는 8MB 이하여야 합니다." }, { status: 413 });
  }
}

const WISH_COLUMNS = `
  w.id, w.title, w.url, w.image_url, w.image_key, w.price, w.currency,
  w.category, w.reason, w.source, w.purchased, w.status, w.priority,
  w.target_price, w.purchased_at, w.visibility, w.share_slug, w.collection_id,
  w.track_price, w.last_price_checked_at, w.created_at, w.updated_at,
  c.name AS collection_name, c.slug AS collection_slug
`;

async function decorateWishes(env: AppEnv, wishes: WishRow[], admin: boolean) {
  if (!wishes.length) return wishes;
  const placeholders = wishes.map(() => "?").join(",");
  const ids = wishes.map((wish) => wish.id);
  const [tags, prices, reservations] = await Promise.all([
    env.DB.prepare(`SELECT wt.wish_id, t.name FROM wish_tags wt JOIN tags t ON t.id = wt.tag_id WHERE wt.wish_id IN (${placeholders}) ORDER BY t.name COLLATE NOCASE`).bind(...ids).all<{ wish_id: string; name: string }>(),
    env.DB.prepare(`SELECT wish_id, price, captured_at FROM price_history WHERE wish_id IN (${placeholders}) ORDER BY datetime(captured_at) ASC`).bind(...ids).all<{ wish_id: string; price: number; captured_at: string }>(),
    env.DB.prepare(`SELECT id, wish_id, guest_name, message, expires_at FROM reservations WHERE wish_id IN (${placeholders}) AND cancelled_at IS NULL AND datetime(expires_at) > datetime('now')`).bind(...ids).all<{ id: string; wish_id: string; guest_name: string | null; message: string | null; expires_at: string }>(),
  ]);
  const tagMap = new Map<string, string[]>();
  for (const row of tags.results) tagMap.set(row.wish_id, [...(tagMap.get(row.wish_id) || []), row.name]);
  const priceMap = new Map<string, Array<{ price: number; captured_at: string }>>();
  for (const row of prices.results) {
    const history = priceMap.get(row.wish_id) || [];
    history.push({ price: row.price, captured_at: row.captured_at });
    priceMap.set(row.wish_id, history.slice(-20));
  }
  const reservationMap = new Map(reservations.results.map((row) => [row.wish_id, row]));
  return wishes.map((wish) => {
    const reservation = reservationMap.get(wish.id);
    return {
      ...wish,
      tags: tagMap.get(wish.id) || [],
      price_history: priceMap.get(wish.id) || [],
      reserved: Boolean(reservation),
      reservation: admin && reservation ? { id: reservation.id, guest_name: reservation.guest_name, message: reservation.message, expires_at: reservation.expires_at } : null,
    };
  });
}

async function queryWishes(request: Request, env: AppEnv, options: { admin?: boolean; includeUnlisted?: boolean; collectionId?: string; shareSlug?: string } = {}) {
  const url = new URL(request.url);
  const admin = options.admin ?? await isAuthorized(request, env);
  const conditions: string[] = [];
  const bindings: Array<string | number> = [];
  if (!admin) conditions.push(options.includeUnlisted ? "w.visibility IN ('public', 'unlisted')" : "w.visibility = 'public'");
  if (options.collectionId) { conditions.push("w.collection_id = ?"); bindings.push(options.collectionId); }
  if (options.shareSlug) {
    conditions.push("w.share_slug = ?", "w.visibility IN ('public', 'unlisted')");
    bindings.push(options.shareSlug);
  }
  const q = normalizeText(url.searchParams.get("q"), 100);
  if (q) {
    conditions.push("(w.title LIKE ? ESCAPE '\\' OR w.reason LIKE ? ESCAPE '\\' OR w.category LIKE ? ESCAPE '\\')");
    const escaped = `%${q.replace(/[\\%_]/g, "\\$&")}%`;
    bindings.push(escaped, escaped, escaped);
  }
  const status = url.searchParams.get("status");
  if (status && ["wanted", "purchased", "archived"].includes(status)) { conditions.push("w.status = ?"); bindings.push(status); }
  for (const field of ["category", "source"] as const) {
    const value = normalizeText(url.searchParams.get(field), 100);
    if (value) { conditions.push(`w.${field} = ?`); bindings.push(value); }
  }
  const tag = normalizeText(url.searchParams.get("tag"), 30);
  if (tag) {
    conditions.push("EXISTS (SELECT 1 FROM wish_tags fwt JOIN tags ft ON ft.id = fwt.tag_id WHERE fwt.wish_id = w.id AND ft.name = ? COLLATE NOCASE)");
    bindings.push(tag);
  }
  const sortMap: Record<string, string> = {
    oldest: "datetime(w.created_at) ASC",
    price_asc: "w.price IS NULL, w.price ASC",
    price_desc: "w.price IS NULL, w.price DESC",
    priority: "w.priority ASC, datetime(w.created_at) DESC",
    updated: "datetime(w.updated_at) DESC",
  };
  const order = sortMap[url.searchParams.get("sort") || ""] || "datetime(w.created_at) DESC";
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const result = await env.DB.prepare(`SELECT ${WISH_COLUMNS} FROM wishes w LEFT JOIN collections c ON c.id = w.collection_id ${where} ORDER BY ${order} LIMIT 500`).bind(...bindings).all<WishRow>();
  return decorateWishes(env, result.results, admin);
}

async function listWishes(request: Request, env: AppEnv) {
  const admin = await isAuthorized(request, env);
  return json({ wishes: await queryWishes(request, env, { admin }), admin });
}

async function stableId(prefix: string, value: string) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value.toLocaleLowerCase("ko-KR"))));
  return `${prefix}_${Array.from(digest.slice(0, 12)).map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

async function replaceWishTags(env: AppEnv, wishId: string, tags: string[]) {
  const statements: D1PreparedStatement[] = [env.DB.prepare("DELETE FROM wish_tags WHERE wish_id = ?").bind(wishId)];
  for (const tag of tags) {
    const tagId = await stableId("tag", tag);
    statements.push(env.DB.prepare("INSERT OR IGNORE INTO tags (id, name) VALUES (?, ?)").bind(tagId, tag));
    statements.push(env.DB.prepare("INSERT OR IGNORE INTO wish_tags (wish_id, tag_id) VALUES (?, ?)").bind(wishId, tagId));
  }
  await env.DB.batch(statements);
}

function wishValues(input: WishInput) {
  return {
    title: normalizeText(input.title, 300),
    url: normalizeText(input.url, 2048),
    imageUrl: normalizeNullableText(input.image_url, 2048),
    imageKey: normalizeNullableText(input.image_key, 512),
    price: normalizeInteger(input.price),
    targetPrice: normalizeInteger(input.target_price),
    currency: normalizeText(input.currency, 8).toUpperCase() || "KRW",
    category: normalizeNullableText(input.category, 100),
    reason: normalizeNullableText(input.reason, 2000),
    source: normalizeText(input.source, 100),
    status: normalizeStatus(input.status),
    priority: normalizePriority(input.priority),
    visibility: normalizeVisibility(input.visibility),
    collectionId: normalizeNullableText(input.collection_id, 100),
    trackPrice: input.track_price === true || input.track_price === 1 ? 1 : 0,
    tags: normalizeTags(input.tags),
  };
}

async function createWish(request: Request, env: AppEnv, ctx: ExecutionContext) {
  if (!await isAuthorized(request, env)) return unauthorized();
  const values = wishValues(await readJson(request) as WishInput);
  if (!values.title || !isSafePublicHttpUrl(values.url)) return json({ error: "상품명과 올바른 URL이 필요합니다." }, { status: 400 });
  const duplicate = await env.DB.prepare("SELECT id FROM wishes WHERE url = ? LIMIT 1").bind(values.url).first();
  if (duplicate) return json({ error: "이미 저장된 상품 링크입니다.", existing_id: duplicate.id }, { status: 409 });
  const id = crypto.randomUUID();
  const shareSlug = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  await env.DB.prepare(`
    INSERT INTO wishes (
      id, title, url, image_url, image_key, price, currency, category, reason, source,
      purchased, status, priority, target_price, purchased_at, visibility, share_slug,
      collection_id, track_price
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    id, values.title, values.url, values.imageUrl, values.imageKey, values.price, values.currency,
    values.category, values.reason, values.source || sourceLabel(values.url), values.status === "purchased" ? 1 : 0,
    values.status, values.priority, values.targetPrice, values.status === "purchased" ? new Date().toISOString() : null,
    values.visibility, shareSlug, values.collectionId, values.trackPrice,
  ).run();
  await replaceWishTags(env, id, values.tags);
  if (values.imageUrl && !values.imageKey) {
    ctx.waitUntil((async () => {
      const key = await mirrorImage(values.imageUrl!, id, env);
      if (key) await env.DB.prepare("UPDATE wishes SET image_key = ? WHERE id = ?").bind(key, id).run();
    })());
  }
  const wishes = await queryWishes(request, env, { admin: true, shareSlug });
  return json({ wish: wishes[0] }, { status: 201 });
}

async function updateWish(request: Request, env: AppEnv, id: string) {
  if (!await isAuthorized(request, env)) return unauthorized();
  const values = wishValues(await readJson(request) as WishInput);
  if (!values.title || !isSafePublicHttpUrl(values.url)) return json({ error: "상품명과 올바른 URL이 필요합니다." }, { status: 400 });
  const existing = await env.DB.prepare("SELECT image_url, image_key, purchased_at FROM wishes WHERE id = ?")
    .bind(id).first<{ image_url: string | null; image_key: string | null; purchased_at: string | null }>();
  if (!existing) return json({ error: "위시를 찾을 수 없습니다." }, { status: 404 });
  const duplicate = await env.DB.prepare("SELECT id FROM wishes WHERE url = ? AND id != ? LIMIT 1").bind(values.url, id).first();
  if (duplicate) return json({ error: "같은 링크로 저장된 다른 위시가 있습니다." }, { status: 409 });
  let imageKey = values.imageKey;
  if (!imageKey && values.imageUrl && values.imageUrl !== existing.image_url) imageKey = await mirrorImage(values.imageUrl, id, env);
  if (!values.imageUrl && !values.imageKey) imageKey = null;
  const purchasedAt = values.status === "purchased" ? existing.purchased_at || new Date().toISOString() : null;
  await env.DB.prepare(`
    UPDATE wishes SET
      title = ?, url = ?, image_url = ?, image_key = ?, price = ?, currency = ?, category = ?,
      reason = ?, source = ?, purchased = ?, status = ?, priority = ?, target_price = ?,
      purchased_at = ?, visibility = ?, collection_id = ?, track_price = ?, updated_at = datetime('now')
    WHERE id = ?
  `).bind(
    values.title, values.url, values.imageUrl, imageKey, values.price, values.currency, values.category,
    values.reason, values.source || sourceLabel(values.url), values.status === "purchased" ? 1 : 0,
    values.status, values.priority, values.targetPrice, purchasedAt, values.visibility,
    values.collectionId, values.trackPrice, id,
  ).run();
  await replaceWishTags(env, id, values.tags);
  if (existing.image_key && existing.image_key !== imageKey) await env.WISH_IMAGES.delete(existing.image_key);
  const wish = await env.DB.prepare("SELECT share_slug FROM wishes WHERE id = ?").bind(id).first<{ share_slug: string }>();
  const wishes = wish ? await queryWishes(request, env, { admin: true, shareSlug: wish.share_slug }) : [];
  return json({ wish: wishes[0] });
}

async function updateWishStatus(request: Request, env: AppEnv, id: string) {
  if (!await isAuthorized(request, env)) return unauthorized();
  const status = normalizeStatus((await readJson(request)).status);
  await env.DB.prepare(`
    UPDATE wishes SET status = ?, purchased = ?, purchased_at = CASE WHEN ? = 'purchased' THEN COALESCE(purchased_at, datetime('now')) ELSE NULL END, updated_at = datetime('now')
    WHERE id = ?
  `).bind(status, status === "purchased" ? 1 : 0, status, id).run();
  return json({ ok: true, status });
}

async function deleteWish(request: Request, env: AppEnv, id: string) {
  if (!await isAuthorized(request, env)) return unauthorized();
  const row = await env.DB.prepare("SELECT image_key FROM wishes WHERE id = ?").bind(id).first<{ image_key: string | null }>();
  if (!row) return json({ error: "위시를 찾을 수 없습니다." }, { status: 404 });
  await env.DB.prepare("DELETE FROM wishes WHERE id = ?").bind(id).run();
  await env.DB.prepare("DELETE FROM tags WHERE NOT EXISTS (SELECT 1 FROM wish_tags WHERE wish_tags.tag_id = tags.id)").run();
  if (row.image_key) await env.WISH_IMAGES.delete(row.image_key);
  return json({ ok: true });
}

function slugify(value: string) {
  const base = value.normalize("NFKD").toLowerCase().replace(/[^a-z0-9가-힣]+/g, "-").replace(/^-|-$/g, "").slice(0, 42) || "collection";
  return `${base}-${crypto.randomUUID().slice(0, 5)}`;
}

async function listCollections(request: Request, env: AppEnv) {
  const admin = await isAuthorized(request, env);
  const where = admin ? "" : "WHERE c.visibility = 'public'";
  const result = await env.DB.prepare(`
    SELECT c.*, COUNT(w.id) AS wish_count
    FROM collections c LEFT JOIN wishes w ON w.collection_id = c.id
    ${where} GROUP BY c.id ORDER BY datetime(c.created_at) DESC
  `).all();
  return json({ collections: result.results, admin });
}

async function createCollection(request: Request, env: AppEnv) {
  if (!await isAuthorized(request, env)) return unauthorized();
  const body = await readJson(request);
  const name = normalizeText(body.name, 100);
  if (!name) return json({ error: "컬렉션 이름을 입력해주세요." }, { status: 400 });
  const collection = {
    id: crypto.randomUUID(),
    name,
    description: normalizeNullableText(body.description, 500),
    slug: slugify(normalizeText(body.slug, 80) || name),
    visibility: normalizeVisibility(body.visibility),
  };
  await env.DB.prepare("INSERT INTO collections (id, name, description, slug, visibility) VALUES (?, ?, ?, ?, ?)")
    .bind(collection.id, collection.name, collection.description, collection.slug, collection.visibility).run();
  return json({ collection: { ...collection, wish_count: 0 } }, { status: 201 });
}

async function updateCollection(request: Request, env: AppEnv, id: string) {
  if (!await isAuthorized(request, env)) return unauthorized();
  const body = await readJson(request);
  const name = normalizeText(body.name, 100);
  if (!name) return json({ error: "컬렉션 이름을 입력해주세요." }, { status: 400 });
  await env.DB.prepare("UPDATE collections SET name = ?, description = ?, visibility = ?, updated_at = datetime('now') WHERE id = ?")
    .bind(name, normalizeNullableText(body.description, 500), normalizeVisibility(body.visibility), id).run();
  return json({ ok: true });
}

async function deleteCollection(request: Request, env: AppEnv, id: string) {
  if (!await isAuthorized(request, env)) return unauthorized();
  await env.DB.batch([
    env.DB.prepare("UPDATE wishes SET collection_id = NULL WHERE collection_id = ?").bind(id),
    env.DB.prepare("DELETE FROM collections WHERE id = ?").bind(id),
  ]);
  return json({ ok: true });
}

async function sharedCollection(request: Request, env: AppEnv, slug: string) {
  const collection = await env.DB.prepare("SELECT * FROM collections WHERE slug = ? AND visibility IN ('public', 'unlisted')")
    .bind(slug).first<{ id: string; name: string; description: string | null; slug: string; visibility: Visibility }>();
  if (!collection) return json({ error: "공유 컬렉션을 찾을 수 없습니다." }, { status: 404 });
  const wishes = await queryWishes(request, env, { admin: false, includeUnlisted: true, collectionId: collection.id });
  return json({ collection, wishes });
}

async function sharedWish(request: Request, env: AppEnv, slug: string) {
  const wishes = await queryWishes(request, env, { admin: false, includeUnlisted: true, shareSlug: slug });
  if (!wishes[0]) return json({ error: "공유 위시를 찾을 수 없습니다." }, { status: 404 });
  return json({ wish: wishes[0] });
}

function randomToken() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hashToken(value: string) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return Array.from(digest).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function createReservation(request: Request, env: AppEnv, wishId: string) {
  const body = await readJson(request);
  const wish = await env.DB.prepare("SELECT id, title FROM wishes WHERE id = ? AND status = 'wanted' AND visibility IN ('public', 'unlisted')")
    .bind(wishId).first<{ id: string; title: string }>();
  if (!wish) return json({ error: "예약할 수 있는 위시가 아닙니다." }, { status: 404 });
  await env.DB.prepare("UPDATE reservations SET cancelled_at = datetime('now') WHERE wish_id = ? AND cancelled_at IS NULL AND datetime(expires_at) <= datetime('now')").bind(wishId).run();
  const active = await env.DB.prepare("SELECT id FROM reservations WHERE wish_id = ? AND cancelled_at IS NULL").bind(wishId).first();
  if (active) return json({ error: "이미 누군가 준비 중인 위시입니다." }, { status: 409 });
  const token = randomToken();
  const id = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO reservations (id, wish_id, guest_token_hash, guest_name, message, expires_at) VALUES (?, ?, ?, ?, ?, datetime('now', '+30 days'))")
      .bind(id, wishId, await hashToken(token), normalizeNullableText(body.guest_name, 60), normalizeNullableText(body.message, 300)),
    env.DB.prepare("INSERT INTO notifications (id, wish_id, type, message) VALUES (?, ?, 'reservation', ?)")
      .bind(crypto.randomUUID(), wishId, `‘${wish.title}’을 누군가 선물로 준비하고 있어요.`),
  ]);
  return json({ reservation: { id, token, expires_in_days: 30 } }, { status: 201 });
}

async function cancelReservation(request: Request, env: AppEnv, id: string) {
  const token = normalizeText(request.headers.get("x-reservation-token"), 200);
  if (!token) return unauthorized();
  const result = await env.DB.prepare("UPDATE reservations SET cancelled_at = datetime('now') WHERE id = ? AND guest_token_hash = ? AND cancelled_at IS NULL")
    .bind(id, await hashToken(token)).run();
  if (!result.meta.changes) return json({ error: "예약을 취소할 권한이 없습니다." }, { status: 403 });
  return json({ ok: true });
}

async function listNotifications(request: Request, env: AppEnv) {
  if (!await isAuthorized(request, env)) return unauthorized();
  const result = await env.DB.prepare(`
    SELECT n.*, w.title AS wish_title FROM notifications n
    LEFT JOIN wishes w ON w.id = n.wish_id
    ORDER BY n.read_at IS NULL DESC, datetime(n.created_at) DESC LIMIT 100
  `).all();
  return json({ notifications: result.results });
}

async function readNotifications(request: Request, env: AppEnv) {
  if (!await isAuthorized(request, env)) return unauthorized();
  await env.DB.prepare("UPDATE notifications SET read_at = datetime('now') WHERE read_at IS NULL").run();
  return json({ ok: true });
}

async function checkWishPrice(env: AppEnv, wish: PriceTrackRow) {
  try {
    const metadata = await metadataFromUrl(wish.url);
    if (metadata.price == null) {
      await env.DB.prepare("UPDATE wishes SET last_price_checked_at = datetime('now') WHERE id = ?").bind(wish.id).run();
      return { id: wish.id, changed: false, price: null };
    }
    const price = Math.round(metadata.price);
    const statements: D1PreparedStatement[] = [
      env.DB.prepare("INSERT INTO price_history (id, wish_id, price, currency) VALUES (?, ?, ?, ?)")
        .bind(crypto.randomUUID(), wish.id, price, metadata.currency || wish.currency),
      env.DB.prepare("UPDATE wishes SET price = ?, currency = ?, last_price_checked_at = datetime('now'), updated_at = datetime('now') WHERE id = ?")
        .bind(price, metadata.currency || wish.currency, wish.id),
    ];
    if (wish.price != null && price < wish.price) {
      statements.push(env.DB.prepare("INSERT OR IGNORE INTO notifications (id, wish_id, type, message, value) VALUES (?, ?, 'price_drop', ?, ?)")
        .bind(crypto.randomUUID(), wish.id, `‘${wish.title}’ 가격이 ${wish.price.toLocaleString()}원에서 ${price.toLocaleString()}원으로 내려갔어요.`, price));
    }
    if (wish.target_price != null && price <= wish.target_price) {
      statements.push(env.DB.prepare("INSERT OR IGNORE INTO notifications (id, wish_id, type, message, value) VALUES (?, ?, 'target_reached', ?, ?)")
        .bind(crypto.randomUUID(), wish.id, `‘${wish.title}’이 목표 가격 ${wish.target_price.toLocaleString()}원 이하가 됐어요.`, price));
    }
    await env.DB.batch(statements);
    return { id: wish.id, changed: wish.price !== price, price };
  } catch (error) {
    await env.DB.prepare("UPDATE wishes SET last_price_checked_at = datetime('now') WHERE id = ?").bind(wish.id).run();
    console.warn(JSON.stringify({ message: "price_check_failed", wishId: wish.id, error: error instanceof Error ? error.message : "unknown" }));
    return { id: wish.id, changed: false, price: null };
  }
}

async function manualPriceCheck(request: Request, env: AppEnv, id: string) {
  if (!await isAuthorized(request, env)) return unauthorized();
  const wish = await env.DB.prepare("SELECT id, title, url, price, target_price, currency FROM wishes WHERE id = ?")
    .bind(id).first<PriceTrackRow>();
  if (!wish) return json({ error: "위시를 찾을 수 없습니다." }, { status: 404 });
  return json(await checkWishPrice(env, wish));
}

async function runScheduledPriceChecks(env: AppEnv) {
  await env.DB.prepare("UPDATE reservations SET cancelled_at = datetime('now') WHERE cancelled_at IS NULL AND datetime(expires_at) <= datetime('now')").run();
  const result = await env.DB.prepare(`
    SELECT id, title, url, price, target_price, currency FROM wishes
    WHERE track_price = 1 AND status = 'wanted'
    ORDER BY last_price_checked_at IS NOT NULL, datetime(last_price_checked_at) ASC LIMIT 12
  `).all<PriceTrackRow>();
  const checked = await Promise.all(result.results.map((wish) => checkWishPrice(env, wish)));
  console.log(JSON.stringify({ message: "scheduled_price_check_complete", count: checked.length }));
}

async function exportData(request: Request, env: AppEnv) {
  if (!await isAuthorized(request, env)) return unauthorized();
  const tables = ["collections", "wishes", "tags", "wish_tags", "reservations", "price_history", "notifications"] as const;
  const entries = await Promise.all(tables.map(async (table) => [table, (await env.DB.prepare(`SELECT * FROM ${table}`).all()).results] as const));
  const backup = { version: 1, exported_at: new Date().toISOString(), ...Object.fromEntries(entries) };
  if (new URL(request.url).searchParams.get("format") === "csv") {
    const wishes = await queryWishes(request, env, { admin: true });
    const headers = ["title", "url", "price", "target_price", "currency", "category", "source", "status", "priority", "tags", "reason"];
    const escape = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`;
    const csv = [headers.join(","), ...wishes.map((wish) => headers.map((key) => escape(key === "tags" ? wish.tags?.join("|") : wish[key as keyof WishRow])).join(","))].join("\n");
    return new Response(`\uFEFF${csv}`, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": "attachment; filename=anminam-wishes.csv" } });
  }
  return new Response(JSON.stringify(backup, null, 2), { headers: { ...JSON_HEADERS, "content-disposition": "attachment; filename=anminam-wishlist-backup.json" } });
}

function asRows(value: unknown, limit = 2000) {
  return Array.isArray(value) ? value.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object" && !Array.isArray(row)).slice(0, limit) : [];
}

async function importData(request: Request, env: AppEnv) {
  if (!await isAuthorized(request, env)) return unauthorized();
  const backup = await readJson(request, MAX_JSON_BYTES);
  if (backup.version !== 1) return json({ error: "지원하지 않는 백업 형식입니다." }, { status: 400 });
  const statements: D1PreparedStatement[] = [];
  for (const row of asRows(backup.collections, 200)) {
    const id = normalizeText(row.id, 100);
    const name = normalizeText(row.name, 100);
    const slug = normalizeText(row.slug, 100);
    if (!id || !name || !slug) continue;
    statements.push(env.DB.prepare("INSERT OR REPLACE INTO collections (id, name, description, slug, visibility, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind(id, name, normalizeNullableText(row.description, 500), slug, normalizeVisibility(row.visibility), normalizeText(row.created_at, 40) || new Date().toISOString(), normalizeText(row.updated_at, 40) || new Date().toISOString()));
  }
  for (const row of asRows(backup.wishes, 1000)) {
    const title = normalizeText(row.title, 300);
    const url = normalizeText(row.url, 2048);
    const id = normalizeText(row.id, 100);
    if (!id || !title || !isSafePublicHttpUrl(url)) continue;
    statements.push(env.DB.prepare(`
      INSERT OR REPLACE INTO wishes (
        id, title, url, image_url, image_key, price, currency, category, reason, source, purchased,
        created_at, updated_at, status, priority, target_price, purchased_at, visibility, share_slug,
        collection_id, track_price, last_price_checked_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      id, title, url, normalizeNullableText(row.image_url, 2048), normalizeNullableText(row.image_key, 512), normalizeInteger(row.price),
      normalizeText(row.currency, 8) || "KRW", normalizeNullableText(row.category, 100), normalizeNullableText(row.reason, 2000),
      normalizeNullableText(row.source, 100), normalizeStatus(row.status) === "purchased" ? 1 : 0, normalizeText(row.created_at, 40) || new Date().toISOString(),
      normalizeText(row.updated_at, 40) || new Date().toISOString(), normalizeStatus(row.status), normalizePriority(row.priority), normalizeInteger(row.target_price),
      normalizeNullableText(row.purchased_at, 40), normalizeVisibility(row.visibility), normalizeText(row.share_slug, 100) || crypto.randomUUID().slice(0, 16),
      normalizeNullableText(row.collection_id, 100), row.track_price === 1 ? 1 : 0, normalizeNullableText(row.last_price_checked_at, 40),
    ));
  }
  for (const row of asRows(backup.tags)) {
    const id = normalizeText(row.id, 100);
    const name = normalizeText(row.name, 30);
    if (id && name) statements.push(env.DB.prepare("INSERT OR REPLACE INTO tags (id, name, created_at) VALUES (?, ?, ?)")
      .bind(id, name, normalizeText(row.created_at, 40) || new Date().toISOString()));
  }
  for (const row of asRows(backup.wish_tags)) {
    const wishId = normalizeText(row.wish_id, 100);
    const tagId = normalizeText(row.tag_id, 100);
    if (wishId && tagId) statements.push(env.DB.prepare("INSERT OR IGNORE INTO wish_tags (wish_id, tag_id) VALUES (?, ?)").bind(wishId, tagId));
  }
  for (const row of asRows(backup.price_history, 5000)) {
    const id = normalizeText(row.id, 100);
    const wishId = normalizeText(row.wish_id, 100);
    const price = normalizeInteger(row.price);
    if (id && wishId && price != null) statements.push(env.DB.prepare("INSERT OR IGNORE INTO price_history (id, wish_id, price, currency, captured_at) VALUES (?, ?, ?, ?, ?)")
      .bind(id, wishId, price, normalizeText(row.currency, 8) || "KRW", normalizeText(row.captured_at, 40) || new Date().toISOString()));
  }
  for (const row of asRows(backup.reservations, 2000)) {
    const id = normalizeText(row.id, 100);
    const wishId = normalizeText(row.wish_id, 100);
    const tokenHash = normalizeText(row.guest_token_hash, 128);
    if (id && wishId && tokenHash) statements.push(env.DB.prepare(`
      INSERT OR IGNORE INTO reservations (id, wish_id, guest_token_hash, guest_name, message, expires_at, cancelled_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(id, wishId, tokenHash, normalizeNullableText(row.guest_name, 60), normalizeNullableText(row.message, 300), normalizeText(row.expires_at, 40), normalizeNullableText(row.cancelled_at, 40), normalizeText(row.created_at, 40) || new Date().toISOString()));
  }
  for (const row of asRows(backup.notifications, 5000)) {
    const id = normalizeText(row.id, 100);
    const type = normalizeText(row.type, 30);
    const message = normalizeText(row.message, 1000);
    if (id && ["price_drop", "target_reached", "reservation"].includes(type) && message) statements.push(env.DB.prepare(`
      INSERT OR IGNORE INTO notifications (id, wish_id, type, message, value, read_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(id, normalizeNullableText(row.wish_id, 100), type, message, normalizeInteger(row.value), normalizeNullableText(row.read_at, 40), normalizeText(row.created_at, 40) || new Date().toISOString()));
  }
  if (!statements.length) return json({ error: "가져올 데이터가 없습니다." }, { status: 400 });
  for (let index = 0; index < statements.length; index += 100) await env.DB.batch(statements.slice(index, index + 100));
  return json({ ok: true, imported_statements: statements.length });
}

async function getImage(env: AppEnv, key: string) {
  if (!key.startsWith("wish-images/") && !key.startsWith("wish-uploads/")) return new Response("Not found", { status: 404 });
  const object = await env.WISH_IMAGES.get(key);
  if (!object) return new Response("Not found", { status: 404 });
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("cache-control", "public, max-age=604800, immutable");
  headers.set("x-content-type-options", "nosniff");
  return new Response(object.body, { headers });
}

async function handleRequest(request: Request, env: AppEnv, ctx: ExecutionContext) {
  const url = new URL(request.url);
  const path = url.pathname;
  if (request.method === "GET" && path === "/api/admin/session") return json({ admin: await isAuthorized(request, env) });
  if (request.method === "GET" && path === "/api/wishes") return listWishes(request, env);
  if (request.method === "POST" && path === "/api/wishes") return createWish(request, env, ctx);
  if (request.method === "POST" && path === "/api/metadata") return handleMetadata(request, env);
  if (request.method === "PUT" && path === "/api/uploads/image") return uploadImage(request, env);
  if (request.method === "GET" && path === "/api/collections") return listCollections(request, env);
  if (request.method === "POST" && path === "/api/collections") return createCollection(request, env);
  if (request.method === "GET" && path === "/api/notifications") return listNotifications(request, env);
  if (request.method === "POST" && path === "/api/notifications/read-all") return readNotifications(request, env);
  if (request.method === "GET" && path === "/api/export") return exportData(request, env);
  if (request.method === "POST" && path === "/api/import") return importData(request, env);

  const sharedCollectionMatch = path.match(/^\/api\/share\/collections\/([^/]+)$/);
  if (request.method === "GET" && sharedCollectionMatch) return sharedCollection(request, env, decodeURIComponent(sharedCollectionMatch[1]));
  const sharedWishMatch = path.match(/^\/api\/share\/wishes\/([^/]+)$/);
  if (request.method === "GET" && sharedWishMatch) return sharedWish(request, env, decodeURIComponent(sharedWishMatch[1]));
  const collectionMatch = path.match(/^\/api\/collections\/([^/]+)$/);
  if (request.method === "PUT" && collectionMatch) return updateCollection(request, env, decodeURIComponent(collectionMatch[1]));
  if (request.method === "DELETE" && collectionMatch) return deleteCollection(request, env, decodeURIComponent(collectionMatch[1]));
  const statusMatch = path.match(/^\/api\/wishes\/([^/]+)\/status$/);
  if (request.method === "PATCH" && statusMatch) return updateWishStatus(request, env, decodeURIComponent(statusMatch[1]));
  const priceMatch = path.match(/^\/api\/wishes\/([^/]+)\/check-price$/);
  if (request.method === "POST" && priceMatch) return manualPriceCheck(request, env, decodeURIComponent(priceMatch[1]));
  const reservationMatch = path.match(/^\/api\/wishes\/([^/]+)\/reservations$/);
  if (request.method === "POST" && reservationMatch) return createReservation(request, env, decodeURIComponent(reservationMatch[1]));
  const cancelReservationMatch = path.match(/^\/api\/reservations\/([^/]+)$/);
  if (request.method === "DELETE" && cancelReservationMatch) return cancelReservation(request, env, decodeURIComponent(cancelReservationMatch[1]));
  const wishMatch = path.match(/^\/api\/wishes\/([^/]+)$/);
  if (request.method === "PUT" && wishMatch) return updateWish(request, env, decodeURIComponent(wishMatch[1]));
  if (request.method === "DELETE" && wishMatch) return deleteWish(request, env, decodeURIComponent(wishMatch[1]));
  const imageMatch = path.match(/^\/api\/images\/(.+)$/);
  if (request.method === "GET" && imageMatch) return getImage(env, decodeURIComponent(imageMatch[1]));
  return json({ error: "Not found" }, { status: 404 });
}

export default {
  async fetch(request: Request, env: AppEnv, ctx: ExecutionContext): Promise<Response> {
    try {
      return await handleRequest(request, env, ctx);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "unknown";
      const status = detail === "payload_too_large" ? 413 : detail === "invalid_json" || error instanceof SyntaxError ? 400 : 500;
      console.error(JSON.stringify({ message: "request_failed", detail, path: new URL(request.url).pathname }));
      return json({ error: status === 500 ? "요청을 처리하지 못했습니다." : "요청 데이터 형식이 올바르지 않습니다." }, { status });
    }
  },
  async scheduled(_controller: ScheduledController, env: AppEnv): Promise<void> {
    await runScheduledPriceChecks(env);
  },
} satisfies ExportedHandler<AppEnv>;
