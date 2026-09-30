import { FormEvent, useEffect, useMemo, useState } from "react";

type Wish = {
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
  created_at: string;
  updated_at: string;
};

type Metadata = {
  title?: string;
  image?: string;
  price?: number | null;
  currency?: string;
  source?: string;
};

type Draft = {
  url: string;
  title: string;
  image_url: string;
  price: string;
  currency: string;
  category: string;
  reason: string;
};

const emptyDraft: Draft = {
  url: "",
  title: "",
  image_url: "",
  price: "",
  currency: "KRW",
  category: "",
  reason: "",
};

function formatPrice(price: number | null, currency: string) {
  if (price == null) return "";
  try {
    return new Intl.NumberFormat("ko-KR", {
      style: "currency",
      currency: currency || "KRW",
      maximumFractionDigits: currency === "KRW" ? 0 : 2,
    }).format(price);
  } catch {
    return `${price.toLocaleString()} ${currency || ""}`.trim();
  }
}

function authHeaders() {
  const token = sessionStorage.getItem("wishlist-admin-token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function App() {
  const [wishes, setWishes] = useState<Wish[]>([]);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [view, setView] = useState<"grid" | "compact" | "list">("grid");
  const [loading, setLoading] = useState(true);
  const [fetchingMeta, setFetchingMeta] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [showForm, setShowForm] = useState(false);

  const count = wishes.length;
  const hasToken = useMemo(() => Boolean(sessionStorage.getItem("wishlist-admin-token")), [showForm, saving]);

  async function loadWishes() {
    setLoading(true);
    try {
      const res = await fetch("/api/wishes");
      if (!res.ok) throw new Error("목록을 불러오지 못했습니다.");
      const data = await res.json() as { wishes: Wish[] };
      setWishes(data.wishes ?? []);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadWishes();
  }, []);

  function ensureAdminToken() {
    let token = sessionStorage.getItem("wishlist-admin-token");
    if (!token) {
      token = window.prompt("관리자 토큰을 입력해주세요. (이 탭을 닫으면 사라집니다)")?.trim() || "";
      if (token) sessionStorage.setItem("wishlist-admin-token", token);
    }
    return token;
  }

  async function fetchMetadata() {
    if (!draft.url.trim()) return;
    if (!ensureAdminToken()) {
      setMessage("등록하려면 관리자 토큰이 필요합니다.");
      return;
    }
    setFetchingMeta(true);
    setMessage("");
    try {
      const res = await fetch("/api/metadata", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ url: draft.url.trim() }),
      });
      const data = await res.json() as Metadata & { error?: string };
      if (!res.ok) throw new Error(data.error || "상품 정보를 불러오지 못했습니다.");
      setDraft((prev) => ({
        ...prev,
        title: data.title || prev.title,
        image_url: data.image || prev.image_url,
        price: data.price != null ? String(data.price) : prev.price,
        currency: data.currency || prev.currency,
      }));
      setMessage("가져온 정보를 확인한 뒤 저장해주세요.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "메타데이터 조회 실패");
    } finally {
      setFetchingMeta(false);
    }
  }

  async function addWish(event: FormEvent) {
    event.preventDefault();
    if (!ensureAdminToken()) return;
    setSaving(true);
    setMessage("");
    try {
      const res = await fetch("/api/wishes", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          ...draft,
          price: draft.price ? Number(String(draft.price).replace(/[^0-9.]/g, "")) : null,
        }),
      });
      const data = await res.json() as { wish?: Wish; error?: string };
      if (!res.ok) throw new Error(data.error || "저장하지 못했습니다.");
      setDraft(emptyDraft);
      setShowForm(false);
      setMessage("위시에 저장했습니다.");
      await loadWishes();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "저장 실패");
    } finally {
      setSaving(false);
    }
  }

  async function removeWish(id: string) {
    if (!ensureAdminToken()) return;
    if (!window.confirm("이 위시를 삭제할까요?")) return;
    const res = await fetch(`/api/wishes/${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: { ...authHeaders() },
    });
    if (res.ok) {
      setWishes((prev) => prev.filter((wish) => wish.id !== id));
    } else {
      const data = await res.json() as { error?: string };
      setMessage(data.error || "삭제하지 못했습니다.");
    }
  }

  return (
    <main>
      <header className="topbar">
        <div className="brandline">ANMINAM / PERSONAL</div>
        <div className="top-actions">
          <span>{hasToken ? "ADMIN ON" : "READ ONLY"}</span>
          <button className="ghost" onClick={() => setShowForm((v) => !v)}>위시 추가</button>
        </div>
      </header>

      <section className="hero">
        <p className="eyebrow">안미남 위시리스트</p>
        <h1>마음에 남은 것들을<br />천천히 모으는 곳.</h1>
        <p className="hero-copy">갖고 싶은 물건과 그 이유를 한곳에 기록합니다. 링크를 넣으면 상품명·가격·이미지를 먼저 불러오고, 필요한 부분만 고쳐 저장할 수 있어요.</p>
        <div className="count-block"><strong>{String(count).padStart(2, "0")}</strong><span>내가 저장한 위시</span></div>
      </section>

      {showForm && (
        <section className="editor">
          <form onSubmit={addWish}>
            <div className="url-row">
              <input
                aria-label="상품 URL"
                placeholder="교보문고, 무신사 등 상품 URL을 붙여넣으세요"
                value={draft.url}
                onChange={(e) => setDraft({ ...draft, url: e.target.value })}
                required
              />
              <button type="button" onClick={fetchMetadata} disabled={fetchingMeta || !draft.url}>
                {fetchingMeta ? "불러오는 중" : "정보 불러오기"}
              </button>
            </div>
            <div className="form-grid">
              <label>상품명<input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} required /></label>
              <label>가격<input inputMode="numeric" value={draft.price} onChange={(e) => setDraft({ ...draft, price: e.target.value })} /></label>
              <label>카테고리<input placeholder="책, 패션, 장비..." value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })} /></label>
              <label>이미지 URL<input value={draft.image_url} onChange={(e) => setDraft({ ...draft, image_url: e.target.value })} /></label>
              <label className="wide">갖고 싶은 이유<textarea value={draft.reason} onChange={(e) => setDraft({ ...draft, reason: e.target.value })} rows={3} /></label>
            </div>
            {draft.image_url && <img className="preview" src={draft.image_url} alt="상품 미리보기" />}
            <div className="form-actions">
              <button type="button" className="ghost" onClick={() => { setShowForm(false); setDraft(emptyDraft); }}>취소</button>
              <button type="submit" disabled={saving}>{saving ? "저장 중" : "위시에 저장"}</button>
            </div>
          </form>
        </section>
      )}

      {message && <div className="notice" role="status">{message}</div>}

      <section className="collection">
        <div className="collection-head">
          <div><p className="eyebrow">WISH LIST · 2026</p><h2>YOUR COLLECTION</h2><span>저장한 목록 {count}개</span></div>
          <div className="view-switch" aria-label="보기 방식">
            <button className={view === "grid" ? "active" : ""} onClick={() => setView("grid")}>카드</button>
            <button className={view === "compact" ? "active" : ""} onClick={() => setView("compact")}>컴팩트</button>
            <button className={view === "list" ? "active" : ""} onClick={() => setView("list")}>리스트</button>
          </div>
        </div>

        {loading ? (
          <div className="empty">목록을 불러오는 중...</div>
        ) : wishes.length === 0 ? (
          <div className="empty">
            <h3>아직 담아둔 위시가 없어요</h3>
            <p>갖고 싶은 물건을 추가하면 이곳에 차곡차곡 모입니다.</p>
            <button onClick={() => setShowForm(true)}>첫 위시 추가하기</button>
          </div>
        ) : (
          <div className={`wish-list ${view}`}>
            {wishes.map((wish) => {
              const image = wish.image_key ? `/api/images/${wish.image_key}` : wish.image_url || "";
              return (
                <article className="wish-card" key={wish.id}>
                  <a className="image-wrap" href={wish.url} target="_blank" rel="noreferrer">
                    {image ? <img src={image} alt="" loading="lazy" /> : <div className="placeholder">NO IMAGE</div>}
                  </a>
                  <div className="wish-body">
                    <div className="meta-row"><span>{wish.category || "WISH"}</span><span>{wish.source || ""}</span></div>
                    <a className="wish-title" href={wish.url} target="_blank" rel="noreferrer">{wish.title}</a>
                    {wish.price != null && <div className="price">{formatPrice(wish.price, wish.currency)}</div>}
                    {wish.reason && <p className="reason">{wish.reason}</p>}
                    <div className="card-bottom">
                      <time>{new Date(wish.created_at + (wish.created_at.endsWith("Z") ? "" : "Z")).toLocaleDateString("ko-KR")}</time>
                      <button className="text-button" onClick={() => removeWish(wish.id)}>삭제</button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}

export default App;
