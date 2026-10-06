import { type ChangeEvent, type FormEvent, useEffect, useMemo, useRef, useState } from "react";

type Status = "wanted" | "purchased" | "archived";
type Visibility = "public" | "unlisted" | "private";
type View = "grid" | "compact" | "list";

type Wish = {
  id: string;
  title: string;
  url: string;
  image_url: string | null;
  image_key: string | null;
  price: number | null;
  target_price: number | null;
  currency: string;
  category: string | null;
  reason: string | null;
  source: string | null;
  status: Status;
  priority: number;
  visibility: Visibility;
  share_slug: string | null;
  collection_id: string | null;
  collection_name: string | null;
  collection_slug: string | null;
  track_price: number;
  last_price_checked_at: string | null;
  last_price_check_status: "unknown" | "pending" | "success" | "unavailable" | "error";
  purchase_price: number | null;
  planned_month: string | null;
  review_after: string | null;
  purchased_at: string | null;
  created_at: string;
  updated_at: string;
  tags: string[];
  price_history: Array<{ price: number; captured_at: string }>;
  reserved: boolean;
  reservation: { id: string; guest_name: string | null; message: string | null; expires_at: string } | null;
};

type Collection = {
  id: string;
  name: string;
  description: string | null;
  slug: string;
  visibility: Visibility;
  wish_count: number;
};

type Notice = {
  id: string;
  type: "price_drop" | "target_reached" | "reservation";
  message: string;
  read_at: string | null;
  created_at: string;
};

type MonthlyBudget = { month: string; amount: number; updated_at: string };

type Draft = {
  url: string;
  title: string;
  image_url: string;
  image_key: string;
  price: string;
  purchase_price: string;
  target_price: string;
  currency: string;
  category: string;
  source: string;
  reason: string;
  status: Status;
  priority: number;
  visibility: Visibility;
  collection_id: string;
  tags: string;
  track_price: boolean;
  planned_month: string;
};

const emptyDraft: Draft = {
  url: "", title: "", image_url: "", image_key: "", price: "", purchase_price: "", target_price: "",
  currency: "KRW", category: "", source: "", reason: "", status: "wanted",
  priority: 2, visibility: "public", collection_id: "", tags: "", track_price: false, planned_month: "",
};

const statusLabels: Record<Status, string> = {
  wanted: "갖고 싶은 것",
  purchased: "구매 완료",
  archived: "보관함",
};

const priorityLabels: Record<number, string> = { 1: "꼭 갖고 싶음", 2: "관심 있음", 3: "나중에 생각" };

function apiHeaders(json = false) {
  const headers = new Headers();
  if (json) headers.set("Content-Type", "application/json");
  return headers;
}

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, { ...init, headers: init.headers || apiHeaders(Boolean(init.body)) });
  const data = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(data.error || "요청을 처리하지 못했습니다.");
  return data;
}

function formatPrice(price: number | null, currency = "KRW") {
  if (price == null) return "가격 미정";
  try {
    return new Intl.NumberFormat("ko-KR", {
      style: "currency", currency: currency || "KRW", maximumFractionDigits: currency === "KRW" ? 0 : 2,
    }).format(price);
  } catch {
    return `${price.toLocaleString()} ${currency}`;
  }
}

function parsePrice(value: string) {
  const parsed = Number(value.replace(/[^0-9.]/g, ""));
  return value.trim() && Number.isFinite(parsed) ? parsed : null;
}

function recommendCategory(url: string, title: string, source: string) {
  const bookDomains = ["kyobobook.co.kr", "yes24.com", "aladin.co.kr", "ridibooks.com", "book.interpark.com", "book.naver.com", "books.google.com", "millie.co.kr"];
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (bookDomains.some((domain) => host === domain || host.endsWith(`.${domain}`))) return "책";
  } catch { /* 상품 링크를 입력하기 전에는 제목·판매처로만 판단합니다. */ }
  const details = `${title} ${source}`;
  if (/(도서|전자책|\be-?book\b|\bbook\b|isbn|책(?:$|\s|[(:【]))/i.test(details)) return "책";
  return "";
}

function currentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function purchaseMonth(value: string | null) {
  if (!value) return "";
  const timestamp = new Date(value.endsWith("Z") ? value : `${value.replace(" ", "T")}Z`);
  return Number.isNaN(timestamp.getTime()) ? value.slice(0, 7) : `${timestamp.getFullYear()}-${String(timestamp.getMonth() + 1).padStart(2, "0")}`;
}

function priceCheckLabel(wish: Wish) {
  if (!wish.last_price_checked_at) return "아직 확인 전";
  if (wish.last_price_check_status === "error") return "확인 오류";
  if (wish.last_price_check_status === "unavailable") return "가격 정보 없음";
  if (wish.last_price_check_status === "unknown") return "이전 확인 상태 미기록";
  if (wish.last_price_check_status === "pending") return "확인 대기";
  return "정상 확인";
}

function wishImage(wish: Wish) {
  return wish.image_key ? `/api/images/${wish.image_key}` : wish.image_url || "";
}

function PriceSparkline({ history, onClick }: { history: Wish["price_history"]; onClick: () => void }) {
  if (!history.length) return null;
  const values = history.map((point) => point.price);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const points = values.map((value, index) => `${(index / Math.max(values.length - 1, 1)) * 100},${30 - ((value - min) / range) * 26}`).join(" ");
  const fell = values.length > 1 && values.at(-1)! < values[0];
  return (
    <button className={`sparkline ${fell ? "fell" : ""}`} title={`가격 기록 ${history.length}개 · 눌러서 자세히 보기`} onClick={onClick}>
      {values.length > 1 && <svg viewBox="0 0 100 32" role="img" aria-label="가격 변화 그래프"><polyline points={points} /></svg>}
      <span>{fell ? "가격 하락" : `가격 기록 ${history.length}개 · 자세히`}</span>
    </button>
  );
}

function PriceHistory({ wish }: { wish: Wish }) {
  const history = wish.price_history;
  const values = history.map((point) => point.price);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const points = values.map((value, index) => `${(index / Math.max(values.length - 1, 1)) * 100},${90 - ((value - min) / (max - min || 1)) * 78}`).join(" ");
  return <div className="price-history">
    <p className="muted">{wish.title}</p>
    {history.length > 1 ? <div className="history-chart"><svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="날짜별 가격 변화 그래프"><polyline points={points} /></svg><div><span>최저 {formatPrice(min, wish.currency)}</span><span>최고 {formatPrice(max, wish.currency)}</span></div></div> : <p className="history-single">저장된 가격 기록이 {history.length}개 있습니다.</p>}
    <div className="history-list">{[...history].reverse().map((point) => <div key={`${point.captured_at}-${point.price}`}><time>{new Date(`${point.captured_at.replace(" ", "T")}Z`).toLocaleString("ko-KR", { year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" })}</time><strong>{formatPrice(point.price, wish.currency)}</strong></div>)}</div>
  </div>;
}

function Modal({ title, onClose, children, wide = false }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  useEffect(() => {
    const close = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose]);
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className={`modal ${wide ? "wide" : ""}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head"><h2>{title}</h2><button className="icon-button" onClick={onClose} aria-label="닫기">×</button></div>
        {children}
      </section>
    </div>
  );
}

function App() {
  const [allWishes, setAllWishes] = useState<Wish[]>([]);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [notifications, setNotifications] = useState<Notice[]>([]);
  const [monthlyBudgets, setMonthlyBudgets] = useState<MonthlyBudget[]>([]);
  const [admin, setAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState<Status>("wanted");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [selectedCollection, setSelectedCollection] = useState("");
  const [sort, setSort] = useState("newest");
  const [view, setView] = useState<View>(() => (localStorage.getItem("wishlist-view") as View) || "grid");
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [categoryEdited, setCategoryEdited] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showEditor, setShowEditor] = useState(false);
  const [showCollections, setShowCollections] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showBudget, setShowBudget] = useState(false);
  const [showOverview, setShowOverview] = useState(false);
  const [budgetMonth, setBudgetMonth] = useState(currentMonth);
  const [budgetAmount, setBudgetAmount] = useState("");
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [reserveWish, setReserveWish] = useState<Wish | null>(null);
  const [priceDetailWish, setPriceDetailWish] = useState<Wish | null>(null);
  const [saving, setSaving] = useState(false);
  const [fetchingMeta, setFetchingMeta] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [sharedTitle, setSharedTitle] = useState("");
  const [sharedDescription, setSharedDescription] = useState("");
  const importRef = useRef<HTMLInputElement>(null);
  const shareTargetHandled = useRef(false);

  const sharedMode = Boolean(sharedTitle);

  async function loadData() {
    setLoading(true);
    setMessage("");
    const params = new URLSearchParams(window.location.search);
    try {
      if (params.get("collection")) {
        const data = await api<{ collection: Collection; wishes: Wish[] }>(`/api/share/collections/${encodeURIComponent(params.get("collection")!)}`);
        setAllWishes(data.wishes);
        setSharedTitle(data.collection.name);
        setSharedDescription(data.collection.description || "");
        setAdmin(false);
      } else if (params.get("wish")) {
        const data = await api<{ wish: Wish }>(`/api/share/wishes/${encodeURIComponent(params.get("wish")!)}`);
        setAllWishes([data.wish]);
        setSharedTitle("공유된 위시");
        setSharedDescription("마음에 남은 한 가지를 공유했어요.");
        setAdmin(false);
      } else {
        const [wishData, collectionData] = await Promise.all([
          api<{ wishes: Wish[]; admin: boolean }>("/api/wishes", { headers: apiHeaders() }),
          api<{ collections: Collection[] }>("/api/collections", { headers: apiHeaders() }),
        ]);
        setAllWishes(wishData.wishes);
        setCollections(collectionData.collections);
        setAdmin(wishData.admin);
        if (window.location.pathname.startsWith("/admin") && !wishData.admin) {
          setMessage("관리자 로그인을 사용할 수 없습니다. Cloudflare Access 설정을 확인해주세요.");
        }
        setSharedTitle("");
        if (wishData.admin) {
          const [noticeData, budgetData] = await Promise.all([
            api<{ notifications: Notice[] }>("/api/notifications", { headers: apiHeaders() }),
            api<{ budgets: MonthlyBudget[] }>("/api/admin/budgets", { headers: apiHeaders() }),
          ]);
          setNotifications(noticeData.notifications);
          setMonthlyBudgets(budgetData.budgets);
        } else {
          setNotifications([]);
          setMonthlyBudgets([]);
        }
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "목록을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadData(); }, []);

  useEffect(() => {
    if (loading || !admin || shareTargetHandled.current) return;
    const params = new URLSearchParams(window.location.search);
    if (!params.has("share-target")) return;
    shareTargetHandled.current = true;
    const sharedText = params.get("text") || "";
    const sharedUrl = params.get("url") || sharedText.match(/https?:\/\/\S+/)?.[0] || "";
    const sharedTitle = params.get("title") || sharedText.replace(sharedUrl, "").trim();
    window.history.replaceState({}, "", window.location.pathname);
    setEditingId(null);
    setCategoryEdited(false);
    setDraft({ ...emptyDraft, url: sharedUrl, title: sharedTitle.slice(0, 300) });
    setShowEditor(true);
    setMessage(sharedUrl ? "공유한 링크를 확인하고 상품 정보를 가져와 저장해주세요." : "공유한 내용을 확인한 뒤 상품 링크를 입력해주세요.");
  }, [admin, loading]);

  const categories = useMemo(() => [...new Set(allWishes.map((wish) => wish.category).filter((value): value is string => Boolean(value)))].sort(), [allWishes]);
  const suggestedCategory = recommendCategory(draft.url, draft.title, draft.source);

  const wishes = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("ko-KR");
    const filtered = allWishes.filter((wish) => {
      if (!sharedMode && wish.status !== status) return false;
      if (category && wish.category !== category) return false;
      if (selectedCollection && wish.collection_id !== selectedCollection) return false;
      if (normalized && ![wish.title, wish.reason, wish.category, wish.source, wish.tags.join(" ")].some((value) => value?.toLocaleLowerCase("ko-KR").includes(normalized))) return false;
      return true;
    });
    return [...filtered].sort((a, b) => {
      if (sort === "oldest") return a.created_at.localeCompare(b.created_at);
      if (sort === "price_asc") return (a.price ?? Number.MAX_SAFE_INTEGER) - (b.price ?? Number.MAX_SAFE_INTEGER);
      if (sort === "price_desc") return (b.price ?? -1) - (a.price ?? -1);
      if (sort === "priority") return a.priority - b.priority || b.created_at.localeCompare(a.created_at);
      return b.created_at.localeCompare(a.created_at);
    });
  }, [allWishes, category, query, selectedCollection, sharedMode, sort, status]);

  const stats = useMemo(() => ({
    wanted: allWishes.filter((wish) => wish.status === "wanted").length,
    purchased: allWishes.filter((wish) => wish.status === "purchased").length,
    archived: allWishes.filter((wish) => wish.status === "archived").length,
    total: allWishes.filter((wish) => wish.status === "wanted").reduce((sum, wish) => sum + (wish.price || 0), 0),
  }), [allWishes]);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const reviewWishes = allWishes.filter((wish) => {
    if (wish.status !== "wanted") return false;
    if (wish.review_after) return new Date(`${wish.review_after}T00:00:00`).getTime() <= today.getTime();
    const created = new Date(`${wish.created_at.replace(" ", "T")}Z`);
    return today.getTime() - created.getTime() >= 90 * 24 * 60 * 60 * 1000;
  }).sort((a, b) => a.created_at.localeCompare(b.created_at));
  const priceIssueWishes = allWishes.filter((wish) => wish.status === "wanted" && wish.track_price === 1 && ["error", "unavailable"].includes(wish.last_price_check_status));
  const thisMonthPlans = allWishes.filter((wish) => wish.status === "wanted" && wish.planned_month === currentMonth());
  const plannedSpend = thisMonthPlans.reduce((sum, wish) => sum + (wish.price ?? 0), 0);

  const monthlySpend = useMemo(() => allWishes
    .filter((wish) => wish.status === "purchased" && purchaseMonth(wish.purchased_at) === currentMonth())
    .reduce((sum, wish) => sum + (wish.purchase_price ?? wish.price ?? 0), 0), [allWishes]);
  const activeBudget = monthlyBudgets.find((item) => item.month === currentMonth())?.amount ?? 0;
  const hasActiveBudget = monthlyBudgets.some((item) => item.month === currentMonth());
  const selectedMonthSpend = allWishes
    .filter((wish) => wish.status === "purchased" && purchaseMonth(wish.purchased_at) === budgetMonth)
    .reduce((sum, wish) => sum + (wish.purchase_price ?? wish.price ?? 0), 0);
  const selectedMonthPlan = allWishes
    .filter((wish) => wish.status === "wanted" && wish.planned_month === budgetMonth)
    .reduce((sum, wish) => sum + (wish.price ?? 0), 0);
  const selectedMonthBudget = monthlyBudgets.find((item) => item.month === budgetMonth);
  const comparedWishes = compareIds.map((id) => allWishes.find((wish) => wish.id === id)).filter((wish): wish is Wish => Boolean(wish));

  useEffect(() => {
    const budget = monthlyBudgets.find((item) => item.month === budgetMonth);
    setBudgetAmount(budget ? String(budget.amount) : "");
  }, [budgetMonth, monthlyBudgets]);

  function openNewWish() {
    if (!admin) { window.location.assign("/admin"); return; }
    setEditingId(null);
    setCategoryEdited(false);
    setDraft(emptyDraft);
    setShowEditor(true);
  }

  function editWish(wish: Wish) {
    setEditingId(wish.id);
    setCategoryEdited(true);
    setDraft({
      url: wish.url, title: wish.title, image_url: wish.image_url || "", image_key: wish.image_key || "",
      price: wish.price == null ? "" : String(wish.price), purchase_price: wish.purchase_price == null ? "" : String(wish.purchase_price), target_price: wish.target_price == null ? "" : String(wish.target_price),
      currency: wish.currency || "KRW", category: wish.category || "", source: wish.source || "", reason: wish.reason || "",
      status: wish.status, priority: wish.priority, visibility: wish.visibility, collection_id: wish.collection_id || "",
      tags: wish.tags.join(", "), track_price: Boolean(wish.track_price), planned_month: wish.planned_month || "",
    });
    setShowEditor(true);
  }

  async function fetchMetadata() {
    if (!draft.url.trim()) return;
    setFetchingMeta(true);
    try {
      const data = await api<{ title?: string; image?: string; price?: number | null; currency?: string; source?: string }>("/api/metadata", {
        method: "POST", headers: apiHeaders(true), body: JSON.stringify({ url: draft.url.trim() }),
      });
      setDraft((current) => {
        const title = data.title || current.title;
        const source = data.source || current.source;
        return { ...current, title, image_url: data.image || current.image_url, image_key: "", price: data.price == null ? current.price : String(data.price), currency: data.currency || current.currency, source, category: categoryEdited ? current.category : recommendCategory(current.url, title, source) };
      });
      setMessage("가져온 정보를 확인한 뒤 저장해주세요.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "상품 정보를 불러오지 못했습니다.");
    } finally { setFetchingMeta(false); }
  }

  async function uploadImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const response = await fetch("/api/uploads/image", { method: "PUT", headers: new Headers({ ...Object.fromEntries(apiHeaders()), "Content-Type": file.type }), body: file });
      const data = await response.json() as { image_key?: string; image_url?: string; error?: string };
      if (!response.ok || !data.image_key) throw new Error(data.error || "이미지를 올리지 못했습니다.");
      setDraft((current) => ({ ...current, image_key: data.image_key!, image_url: data.image_url || "" }));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "이미지를 올리지 못했습니다.");
    } finally { setUploading(false); }
  }

  async function saveWish(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      await api(editingId ? `/api/wishes/${encodeURIComponent(editingId)}` : "/api/wishes", {
        method: editingId ? "PUT" : "POST", headers: apiHeaders(true),
        body: JSON.stringify({ ...draft, price: parsePrice(draft.price), purchase_price: parsePrice(draft.purchase_price), target_price: parsePrice(draft.target_price), track_price: draft.track_price ? 1 : 0, tags: draft.tags.split(",") }),
      });
      setShowEditor(false); setDraft(emptyDraft); setEditingId(null);
      setMessage(editingId ? "위시를 수정했습니다." : "새 위시를 저장했습니다.");
      await loadData();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "저장하지 못했습니다.");
    } finally { setSaving(false); }
  }

  async function changeStatus(wish: Wish, nextStatus: Status) {
    let purchasePrice: number | null = null;
    if (nextStatus === "purchased") {
      const entered = window.prompt("실제로 결제한 금액을 입력해주세요.", String(wish.purchase_price ?? wish.price ?? ""));
      if (entered === null) return;
      purchasePrice = parsePrice(entered);
      if (purchasePrice === null) { setMessage("구매 금액은 0 이상의 숫자로 입력해주세요."); return; }
    }
    await api(`/api/wishes/${encodeURIComponent(wish.id)}/status`, { method: "PATCH", headers: apiHeaders(true), body: JSON.stringify({ status: nextStatus, ...(purchasePrice === null ? {} : { purchase_price: purchasePrice }) }) });
    setMessage(nextStatus === "purchased" ? "구매 완료로 옮겼습니다." : nextStatus === "archived" ? "보관함으로 옮겼습니다." : "위시로 되돌렸습니다.");
    await loadData();
  }

  async function removeWish(wish: Wish) {
    if (!window.confirm(`‘${wish.title}’을 완전히 삭제할까요?`)) return;
    await api(`/api/wishes/${encodeURIComponent(wish.id)}`, { method: "DELETE", headers: apiHeaders() });
    setMessage("위시를 삭제했습니다.");
    await loadData();
  }

  async function checkPrice(wish: Wish) {
    setMessage("현재 가격을 확인하고 있습니다.");
    const result = await api<{ price: number | null }>(`/api/wishes/${wish.id}/check-price`, { method: "POST", headers: apiHeaders() });
    setMessage(result.price == null ? "이번에는 가격을 읽지 못했습니다." : `현재 가격은 ${formatPrice(result.price, wish.currency)}입니다.`);
    await loadData();
  }

  async function rescheduleReview(wish: Wish, days: number) {
    try {
      await api(`/api/wishes/${encodeURIComponent(wish.id)}/review`, { method: "PATCH", headers: apiHeaders(true), body: JSON.stringify({ days }) });
      setMessage(days === 30 ? "한 달 뒤 다시 살펴보도록 미뤘습니다." : "90일 뒤 다시 살펴보도록 했습니다.");
      await loadData();
    } catch (error) { setMessage(error instanceof Error ? error.message : "다시 살펴볼 날짜를 저장하지 못했습니다."); }
  }

  function toggleCompare(wish: Wish) {
    setCompareIds((current) => current.includes(wish.id)
      ? current.filter((id) => id !== wish.id)
      : current.length >= 4 ? current : [...current, wish.id]);
    if (!compareIds.includes(wish.id) && compareIds.length >= 4) setMessage("한 번에 최대 4개까지 비교할 수 있어요.");
  }

  async function saveBudget(event: FormEvent) {
    event.preventDefault();
    const amount = parsePrice(budgetAmount);
    if (amount === null) { setMessage("월 예산을 0 이상의 숫자로 입력해주세요."); return; }
    try {
      await api("/api/admin/budgets", { method: "PUT", headers: apiHeaders(true), body: JSON.stringify({ month: budgetMonth, amount }) });
      setShowBudget(false);
      await loadData();
      setMessage(`${budgetMonth.replace("-", "년 ")}월 예산을 저장했습니다.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "예산을 저장하지 못했습니다."); }
  }

  async function reserve(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!reserveWish) return;
    const form = new FormData(event.currentTarget);
    try {
      const data = await api<{ reservation: { id: string; token: string } }>(`/api/wishes/${reserveWish.id}/reservations`, {
        method: "POST", headers: apiHeaders(true), body: JSON.stringify({ guest_name: form.get("name"), message: form.get("message") }),
      });
      localStorage.setItem(`wishlist-reservation-${reserveWish.id}`, JSON.stringify(data.reservation));
      setReserveWish(null); setMessage("선물 준비 표시를 남겼습니다. 30일 동안 유지돼요.");
      await loadData();
    } catch (error) { setMessage(error instanceof Error ? error.message : "예약하지 못했습니다."); }
  }

  async function cancelReservation(wish: Wish) {
    const saved = localStorage.getItem(`wishlist-reservation-${wish.id}`);
    if (!saved) return;
    const reservation = JSON.parse(saved) as { id: string; token: string };
    await fetch(`/api/reservations/${reservation.id}`, { method: "DELETE", headers: { "X-Reservation-Token": reservation.token } });
    localStorage.removeItem(`wishlist-reservation-${wish.id}`);
    setMessage("선물 준비 표시를 취소했습니다.");
    await loadData();
  }

  function share(path: string) {
    const url = new URL(window.location.origin);
    const [key, value] = path.split("=");
    url.searchParams.set(key, value);
    void navigator.clipboard.writeText(url.toString());
    setMessage("공유 링크를 복사했습니다.");
  }

  async function downloadBackup(format: "json" | "csv") {
    const response = await fetch(`/api/export${format === "csv" ? "?format=csv" : ""}`, { headers: apiHeaders() });
    if (!response.ok) { setMessage("백업을 만들지 못했습니다."); return; }
    const blob = await response.blob();
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = format === "csv" ? "anminam-wishes.csv" : "anminam-wishlist-backup.json";
    link.click(); URL.revokeObjectURL(link.href);
  }

  async function importBackup(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file || !window.confirm("백업 내용을 현재 목록에 합칠까요? 같은 ID의 항목은 백업 내용으로 바뀝니다.")) return;
    try {
      const response = await fetch("/api/import", { method: "POST", headers: apiHeaders(true), body: await file.text() });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || "가져오지 못했습니다.");
      setMessage("백업을 가져왔습니다."); await loadData();
    } catch (error) { setMessage(error instanceof Error ? error.message : "가져오지 못했습니다."); }
    event.target.value = "";
  }

  const unread = notifications.filter((notice) => !notice.read_at).length;

  return (
    <main className={sharedMode ? "shared-mode" : ""}>
      <header className="topbar">
        <a className="wordmark" href="/" aria-label="안미남의 위시리스트 홈"><span>안미남의 위시리스트</span></a>
        <nav className="top-actions" aria-label="주요 작업">
          {!sharedMode && <button className="overview-toggle" aria-expanded={showOverview} aria-controls="overview-panel" onClick={() => setShowOverview((open) => !open)}>{showOverview ? "요약 닫기" : "요약"}</button>}
          {admin && <button className="quiet" onClick={() => setShowNotifications(true)}>알림{unread > 0 && <b>{unread}</b>}</button>}
          {admin && <button className="quiet" onClick={() => setShowCollections(true)}>컬렉션</button>}
          {!sharedMode && <button className="quiet" onClick={() => window.location.assign(admin ? "/cdn-cgi/access/logout" : "/admin")}>{admin ? "관리 종료" : "관리자"}</button>}
          {!sharedMode && <button className="primary" onClick={openNewWish}>위시 추가</button>}
        </nav>
      </header>

      {!sharedMode && <section className="overview-panel" id="overview-panel" aria-label="위시 요약과 정리" hidden={!showOverview}>
      <section className="hero">
        <div className="hero-ledger" aria-label="위시 요약">
          <div><strong>{String(stats.wanted).padStart(2, "0")}</strong><span>기다리는 위시</span></div>
          <div><strong>{String(stats.purchased).padStart(2, "0")}</strong><span>구매한 것</span></div>
          <div className="total"><strong>{formatPrice(stats.total)}</strong><span>현재 위시 합계</span></div>
          {admin && <div className="budget-summary"><div><strong>{formatPrice(monthlySpend)}</strong><span>이번 달 구매 지출{hasActiveBudget ? ` · 예산 ${formatPrice(activeBudget)}` : ""}</span></div><button className="quiet" onClick={() => setShowBudget(true)}>예산·구매 기록</button></div>}
        </div>
      </section>

      {admin && <section className="review-dashboard" aria-label="위시 정리">
        <div className="dashboard-heading"><div><h2>살펴볼 목록</h2><p>잊고 있던 위시와 구매 계획을 정리해요.</p></div><span>{reviewWishes.length + priceIssueWishes.length}개 확인 필요</span></div>
        <div className="dashboard-grid">
          <section className="dashboard-column">
            <div className="dashboard-column-head"><h3>다시 생각해볼 위시</h3><b>{reviewWishes.length}</b></div>
            {reviewWishes.length ? reviewWishes.slice(0, 4).map((wish) => <article className="dashboard-row" key={wish.id}>
              <a href={wish.url} target="_blank" rel="noreferrer">{wish.title}</a><small>{new Date(`${wish.created_at.replace(" ", "T")}Z`).toLocaleDateString("ko-KR")}에 추가</small>
              <div><button onClick={() => void rescheduleReview(wish, 30)}>한 달 미루기</button><button onClick={() => void rescheduleReview(wish, 90)}>계속 원함</button><button className="danger" onClick={() => void changeStatus(wish, "archived")}>보관</button></div>
            </article>) : <p className="dashboard-empty">지금 다시 살펴볼 위시가 없어요.</p>}
          </section>
          <section className="dashboard-column">
            <div className="dashboard-column-head"><h3>이번 달 구매 계획</h3><b>{thisMonthPlans.length}</b></div>
            <div className="plan-summary"><strong>{formatPrice(plannedSpend)}</strong><span>현재 가격 기준 · {currentMonth().replace("-", "년 ")}월</span></div>
            {thisMonthPlans.slice(0, 3).map((wish) => <div className="dashboard-plain-row" key={wish.id}><span>{wish.title}</span><strong>{formatPrice(wish.price, wish.currency)}</strong></div>)}
            {!thisMonthPlans.length && <p className="dashboard-empty">위시를 수정해 구매 예정 월을 정해보세요.</p>}
          </section>
          <section className="dashboard-column">
            <div className="dashboard-column-head"><h3>가격 확인이 필요한 위시</h3><b>{priceIssueWishes.length}</b></div>
            {priceIssueWishes.length ? priceIssueWishes.slice(0, 4).map((wish) => <article className="dashboard-row" key={wish.id}>
              <a href={wish.url} target="_blank" rel="noreferrer">{wish.title}</a><small>{priceCheckLabel(wish)}</small><div><button onClick={() => void checkPrice(wish)}>다시 확인</button><button onClick={() => editWish(wish)}>정보 수정</button></div>
            </article>) : <p className="dashboard-empty">가격 확인 오류가 없어요.</p>}
          </section>
        </div>
      </section>}
      </section>}

      {message && <div className="notice" role="status"><span>{message}</span><button onClick={() => setMessage("")} aria-label="알림 닫기">×</button></div>}

      <div className="archive-layout">
        {!sharedMode && <aside className="index-rail">
          <div className="rail-group"><h2>상태</h2>{(["wanted", "purchased", "archived"] as Status[]).map((item) => <button key={item} className={status === item ? "active" : ""} onClick={() => setStatus(item)}><span>{statusLabels[item]}</span><b>{stats[item]}</b></button>)}</div>
          <div className="rail-group collections"><h2>컬렉션</h2><button className={!selectedCollection ? "active" : ""} onClick={() => setSelectedCollection("")}><span>전체</span></button>{collections.map((collection) => <button key={collection.id} className={selectedCollection === collection.id ? "active" : ""} onClick={() => setSelectedCollection(collection.id)}><span>{collection.name}</span><b>{collection.wish_count}</b></button>)}</div>
          {admin && <div className="rail-tools"><button onClick={() => void downloadBackup("json")}>JSON 백업</button><button onClick={() => void downloadBackup("csv")}>CSV 내보내기</button><button onClick={() => importRef.current?.click()}>백업 가져오기</button><input ref={importRef} hidden type="file" accept="application/json" onChange={importBackup} /></div>}
        </aside>}

        <section className="collection-panel">
          <div className="filterbar">
            <label className="search"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="이름, 메모, 태그 검색" aria-label="위시 검색" /></label>
            <select value={category} onChange={(event) => setCategory(event.target.value)} aria-label="카테고리"><option value="">모든 카테고리</option>{categories.map((item) => <option key={item}>{item}</option>)}</select>
            <select value={sort} onChange={(event) => setSort(event.target.value)} aria-label="정렬"><option value="newest">최근 등록순</option><option value="oldest">오래된순</option><option value="priority">우선순위순</option><option value="price_asc">낮은 가격순</option><option value="price_desc">높은 가격순</option></select>
            <div className="view-switch" aria-label="보기 방식">{(["grid", "compact", "list"] as View[]).map((item) => <button key={item} className={view === item ? "active" : ""} onClick={() => { setView(item); localStorage.setItem("wishlist-view", item); }} aria-label={`${item} 보기`}>{item === "grid" ? "▦" : item === "compact" ? "▥" : "☷"}</button>)}</div>
          </div>

          <div className="collection-title"><div><h2>{sharedMode ? sharedTitle : statusLabels[status]}</h2><p>{wishes.length}개의 기록</p>{sharedMode && sharedDescription && <p className="shared-description">{sharedDescription}</p>}</div>{admin && selectedCollection && <button className="quiet" onClick={() => { const collection = collections.find((item) => item.id === selectedCollection); if (collection) share(`collection=${collection.slug}`); }}>컬렉션 링크 복사</button>}</div>
          {sharedMode && <aside className="gift-note"><strong>선물로 준비하고 싶다면</strong><span>상품의 ‘선물 준비하기’를 눌러 알려주세요. 준비 표시는 30일 동안 유지되며, 같은 선물을 겹쳐 고르는 일을 줄여줍니다.</span></aside>}

          {comparedWishes.length > 0 && !sharedMode && <section className="compare-panel" aria-label="위시 비교">
            <div className="compare-heading"><div><strong>나란히 비교</strong><span>{comparedWishes.length}/4개 선택</span></div><button className="quiet" onClick={() => setCompareIds([])}>비우기</button></div>
            <div className="compare-scroll"><table><thead><tr><th>비교 항목</th>{comparedWishes.map((wish) => <th key={wish.id}><span>{wish.title}</span><button className="quiet" onClick={() => toggleCompare(wish)} aria-label={`${wish.title} 비교에서 빼기`}>빼기</button></th>)}</tr></thead><tbody>
              <tr><th>현재 가격</th>{comparedWishes.map((wish) => <td key={wish.id}>{formatPrice(wish.price, wish.currency)}</td>)}</tr>
              <tr><th>목표 가격</th>{comparedWishes.map((wish) => <td key={wish.id}>{wish.target_price == null ? "—" : formatPrice(wish.target_price, wish.currency)}</td>)}</tr>
              <tr><th>카테고리</th>{comparedWishes.map((wish) => <td key={wish.id}>{wish.category || "—"}</td>)}</tr>
              <tr><th>우선순위</th>{comparedWishes.map((wish) => <td key={wish.id}>{priorityLabels[wish.priority]}</td>)}</tr>
              <tr><th>가격 확인</th>{comparedWishes.map((wish) => <td key={wish.id}>{priceCheckLabel(wish)}{wish.last_price_checked_at && <small>{new Date(`${wish.last_price_checked_at.replace(" ", "T")}Z`).toLocaleDateString("ko-KR")}</small>}</td>)}</tr>
              <tr><th>기록한 이유</th>{comparedWishes.map((wish) => <td key={wish.id}>{wish.reason || "—"}</td>)}</tr>
              <tr><th>상품</th>{comparedWishes.map((wish) => <td key={wish.id}><a href={wish.url} target="_blank" rel="noreferrer">판매 페이지 열기 ↗</a></td>)}</tr>
            </tbody></table></div>
          </section>}

          {loading ? <div className="empty">목록을 정리하고 있습니다.</div> : wishes.length === 0 ? <div className="empty"><h3>조건에 맞는 위시가 없습니다.</h3><p>필터를 지우거나 새로운 위시를 기록해보세요.</p>{admin && <button className="primary" onClick={openNewWish}>위시 추가</button>}</div> : (
            <div className={`wish-list ${view}`}>
              {wishes.map((wish) => {
                const ownReservation = localStorage.getItem(`wishlist-reservation-${wish.id}`);
                return <article className={`wish-card priority-${wish.priority}`} key={wish.id}>
                  <a className="image-wrap" href={wish.url} target="_blank" rel="noreferrer">{wishImage(wish) ? <img src={wishImage(wish)} alt="" loading="lazy" /> : <span>이미지 없음</span>}{wish.reserved && <em>선물 준비 중</em>}</a>
                  <div className="wish-body">
                    <div className="card-labels"><span>{wish.collection_name || wish.category || "위시"}</span><span>{priorityLabels[wish.priority]}</span></div>
                    <a className="wish-title" href={wish.url} target="_blank" rel="noreferrer">{wish.title}</a>
                    <div className="price-line"><strong>{formatPrice(wish.price, wish.currency)}</strong>{wish.target_price != null && <small>목표 {formatPrice(wish.target_price, wish.currency)}</small>}{admin && wish.status === "purchased" && wish.purchase_price != null && <small>실결제 {formatPrice(wish.purchase_price, wish.currency)}</small>}</div>
                    <PriceSparkline history={wish.price_history} onClick={() => setPriceDetailWish(wish)} />
                    {wish.status === "wanted" && wish.planned_month && <p className="planned-label">구매 예정 {wish.planned_month.replace("-", "년 ")}월</p>}
                    {admin && wish.track_price === 1 && <p className={`price-status ${wish.last_price_check_status}`}>{priceCheckLabel(wish)}{wish.last_price_checked_at && <time>{new Date(`${wish.last_price_checked_at.replace(" ", "T")}Z`).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</time>}</p>}
                    {wish.reason && <p className="reason">{wish.reason}</p>}
                    {wish.tags.length > 0 && <div className="tags">{wish.tags.map((tag) => <span key={tag}>#{tag}</span>)}</div>}
                    {admin && wish.reservation && <div className="reservation-note"><b>{wish.reservation.guest_name || "익명"}</b>님이 준비 중{wish.reservation.message && <span> — {wish.reservation.message}</span>}</div>}
                    <div className="card-footer"><span>{wish.source || new URL(wish.url).hostname}</span><div className="card-actions">
                      {!admin && wish.status === "wanted" && !wish.reserved && <button onClick={() => setReserveWish(wish)}>선물 준비하기</button>}
                      {!admin && ownReservation && <button onClick={() => void cancelReservation(wish)}>예약 취소</button>}
                      <button aria-pressed={compareIds.includes(wish.id)} onClick={() => toggleCompare(wish)}>{compareIds.includes(wish.id) ? "비교 중" : "비교 담기"}</button>
                      {admin && <><button onClick={() => editWish(wish)}>수정</button>{wish.track_price === 1 && <button onClick={() => void checkPrice(wish)}>가격 확인</button>}<button onClick={() => share(`wish=${wish.share_slug}`)}>공유</button>{wish.status === "wanted" ? <><button onClick={() => void changeStatus(wish, "purchased")}>구매 완료</button><button onClick={() => void changeStatus(wish, "archived")}>보관</button></> : <>{wish.status === "purchased" && <button onClick={async () => { const entered = window.prompt("실제 결제 금액을 수정해주세요.", String(wish.purchase_price ?? wish.price ?? "")); if (entered === null) return; const amount = parsePrice(entered); if (amount === null) { setMessage("구매 금액은 0 이상의 숫자로 입력해주세요."); return; } await api(`/api/wishes/${encodeURIComponent(wish.id)}/status`, { method: "PATCH", headers: apiHeaders(true), body: JSON.stringify({ status: "purchased", purchase_price: amount }) }); setMessage("실결제 금액을 수정했습니다."); await loadData(); }}>금액 수정</button>}<button onClick={() => void changeStatus(wish, "wanted")}>위시로 이동</button></>}<button className="danger" onClick={() => void removeWish(wish)}>삭제</button></>}
                    </div></div>
                  </div>
                </article>;
              })}
            </div>
          )}
        </section>
      </div>


      {showEditor && <Modal title={editingId ? "위시 수정" : "새 위시 기록"} onClose={() => setShowEditor(false)} wide><form className="editor-form" onSubmit={saveWish}>
        <div className="url-fetch"><label>상품 링크<input type="url" value={draft.url} onChange={(event) => { const url = event.target.value; setDraft((current) => ({ ...current, url, category: categoryEdited ? current.category : recommendCategory(url, current.title, current.source) })); }} required placeholder="https://" /></label><button type="button" onClick={() => void fetchMetadata()} disabled={fetchingMeta || !draft.url}>{fetchingMeta ? "읽는 중" : "정보 가져오기"}</button></div>
        <div className="editor-grid">
          <div className="image-editor"><div className="image-preview">{draft.image_url ? <img src={draft.image_key ? `/api/images/${draft.image_key}` : draft.image_url} alt="상품 미리보기" /> : <span>상품 이미지</span>}</div><label className="upload-button">{uploading ? "업로드 중" : "이미지 직접 올리기"}<input type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/avif" onChange={uploadImage} disabled={uploading} /></label><label>이미지 URL<input value={draft.image_url} onChange={(event) => setDraft({ ...draft, image_url: event.target.value, image_key: "" })} /></label></div>
          <div className="fields"><label>상품명<input value={draft.title} onChange={(event) => { const title = event.target.value; setDraft((current) => ({ ...current, title, category: categoryEdited ? current.category : recommendCategory(current.url, title, current.source) })); }} required /></label><div className="field-pair"><label>현재 가격<input inputMode="numeric" value={draft.price} onChange={(event) => setDraft({ ...draft, price: event.target.value })} /></label><label>목표 가격<input inputMode="numeric" value={draft.target_price} onChange={(event) => setDraft({ ...draft, target_price: event.target.value })} /></label></div>{draft.status === "purchased" && <label>실제 결제 금액<input inputMode="numeric" value={draft.purchase_price} onChange={(event) => setDraft({ ...draft, purchase_price: event.target.value })} placeholder="비워두면 현재 가격을 사용" /></label>}<div className="field-pair"><label>카테고리<input value={draft.category} onChange={(event) => { setCategoryEdited(true); setDraft({ ...draft, category: event.target.value }); }} placeholder="책, 패션, 장비" />{suggestedCategory && <span className="category-suggestion">{draft.category === suggestedCategory ? `자동 추천: ${suggestedCategory}` : <>추천: {suggestedCategory} <button type="button" onClick={() => { setCategoryEdited(true); setDraft({ ...draft, category: suggestedCategory }); }}>적용</button></>}</span>}</label><label>판매처<input value={draft.source} onChange={(event) => { const source = event.target.value; setDraft((current) => ({ ...current, source, category: categoryEdited ? current.category : recommendCategory(current.url, current.title, source) })); }} /></label></div><label>구매 예정 월<input type="month" value={draft.planned_month} onChange={(event) => setDraft({ ...draft, planned_month: event.target.value })} /><small>선택하면 정리 화면에 월별 계획으로 보여요.</small></label><label>태그<input value={draft.tags} onChange={(event) => setDraft({ ...draft, tags: event.target.value })} placeholder="업무용, 올해구매, 선물후보" /><small>쉼표로 구분합니다.</small></label><label>갖고 싶은 이유와 확인할 점<textarea rows={4} value={draft.reason} onChange={(event) => setDraft({ ...draft, reason: event.target.value })} /></label></div>
        </div>
        <div className="option-grid"><label>상태<select value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value as Status })}><option value="wanted">갖고 싶음</option><option value="purchased">구매 완료</option><option value="archived">보관</option></select></label><label>우선순위<select value={draft.priority} onChange={(event) => setDraft({ ...draft, priority: Number(event.target.value) })}><option value="1">꼭 갖고 싶음</option><option value="2">관심 있음</option><option value="3">나중에 생각</option></select></label><label>공개 범위<select value={draft.visibility} onChange={(event) => setDraft({ ...draft, visibility: event.target.value as Visibility })}><option value="public">공개</option><option value="unlisted">링크 공개</option><option value="private">비공개</option></select></label><label>컬렉션<select value={draft.collection_id} onChange={(event) => setDraft({ ...draft, collection_id: event.target.value })}><option value="">선택 안 함</option>{collections.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label></div>
        <label className="check-row"><input type="checkbox" checked={draft.track_price} onChange={(event) => setDraft({ ...draft, track_price: event.target.checked })} /><span>매일 가격을 확인하고 가격 하락을 알립니다.</span></label>
        <div className="modal-actions"><button type="button" className="quiet" onClick={() => setShowEditor(false)}>취소</button><button className="primary" type="submit" disabled={saving}>{saving ? "저장 중" : "저장"}</button></div>
      </form></Modal>}

      {showCollections && <CollectionManager collections={collections} onClose={() => setShowCollections(false)} onChanged={loadData} onMessage={setMessage} onShare={(slug) => share(`collection=${slug}`)} />}

      {priceDetailWish && <Modal title="가격 기록" onClose={() => setPriceDetailWish(null)}><PriceHistory wish={priceDetailWish} /></Modal>}

      {showNotifications && <Modal title="새로운 소식" onClose={() => setShowNotifications(false)}><div className="notification-list">{notifications.length === 0 ? <p className="muted">아직 알림이 없습니다.</p> : notifications.map((notice) => <article className={notice.read_at ? "read" : ""} key={notice.id}><span>{notice.type === "reservation" ? "선물" : notice.type === "price_drop" ? "가격 하락" : "목표 가격"}</span><p>{notice.message}</p><time>{new Date(`${notice.created_at}Z`).toLocaleDateString("ko-KR")}</time></article>)}</div>{unread > 0 && <button className="primary full" onClick={async () => { await api("/api/notifications/read-all", { method: "POST", headers: apiHeaders() }); await loadData(); }}>모두 읽음으로 표시</button>}</Modal>}

      {showBudget && <Modal title="월 예산·구매 기록" onClose={() => setShowBudget(false)}><form className="stack-form" onSubmit={saveBudget}><p>구매 완료로 바꾸면 실제 결제 금액에 반영됩니다. 예정 월을 적어둔 위시도 함께 확인할 수 있어요.</p><label>기록할 월<input type="month" value={budgetMonth} onChange={(event) => setBudgetMonth(event.target.value)} required /></label><label>월 예산<input inputMode="numeric" value={budgetAmount} onChange={(event) => setBudgetAmount(event.target.value)} placeholder="예산 미설정" /><small>0원을 입력하면 예산을 0원으로 설정합니다.</small></label><div className="budget-report"><div><span>구매 지출</span><strong>{formatPrice(selectedMonthSpend)}</strong></div><div><span>구매 예정액 · 현재 가격 기준</span><strong>{formatPrice(selectedMonthPlan)}</strong></div>{selectedMonthBudget && <small>{selectedMonthBudget.amount > 0 ? `예산 ${formatPrice(selectedMonthBudget.amount)} · 지출 ${Math.round((selectedMonthSpend / selectedMonthBudget.amount) * 100)}% · 예정 포함 ${Math.round(((selectedMonthSpend + selectedMonthPlan) / selectedMonthBudget.amount) * 100)}%` : "예산을 0원으로 설정했습니다."}</small>}</div><button className="primary" type="submit">예산 저장</button></form></Modal>}

      {reserveWish && <Modal title="선물 준비하기" onClose={() => setReserveWish(null)}><form className="stack-form" onSubmit={reserve}><p>다른 사람이 같은 선물을 준비하지 않도록 30일 동안 표시합니다. 위시 주인에게 이름과 메시지가 보일 수 있어요.</p><label>이름 또는 별명<input name="name" maxLength={60} placeholder="선택 입력" /></label><label>짧은 메시지<textarea name="message" maxLength={300} rows={3} placeholder="선택 입력" /></label><button className="primary" type="submit">준비 중으로 표시</button></form></Modal>}
    </main>
  );
}

function CollectionManager({ collections, onClose, onChanged, onMessage, onShare }: { collections: Collection[]; onClose: () => void; onChanged: () => Promise<void>; onMessage: (value: string) => void; onShare: (slug: string) => void }) {
  const [editing, setEditing] = useState<Collection | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const body = { name: form.get("name"), description: form.get("description"), visibility: form.get("visibility") };
    try {
      await api(editing ? `/api/collections/${editing.id}` : "/api/collections", { method: editing ? "PUT" : "POST", headers: apiHeaders(true), body: JSON.stringify(body) });
      onMessage(editing ? "컬렉션을 수정했습니다." : "컬렉션을 만들었습니다."); setEditing(null); event.currentTarget.reset(); await onChanged();
    } catch (error) { onMessage(error instanceof Error ? error.message : "저장하지 못했습니다."); }
  }
  async function remove(collection: Collection) {
    if (!window.confirm(`‘${collection.name}’ 컬렉션을 삭제할까요? 안의 위시는 삭제되지 않습니다.`)) return;
    await api(`/api/collections/${collection.id}`, { method: "DELETE", headers: apiHeaders() });
    onMessage("컬렉션을 삭제했습니다."); await onChanged();
  }
  return <Modal title="컬렉션 관리" onClose={onClose} wide><div className="collection-manager"><form className="stack-form" onSubmit={submit}><h3>{editing ? "컬렉션 수정" : "새 컬렉션"}</h3><label>이름<input name="name" key={editing?.id || "new"} defaultValue={editing?.name || ""} required /></label><label>설명<textarea name="description" key={`${editing?.id || "new"}-description`} defaultValue={editing?.description || ""} rows={3} /></label><label>공개 범위<select name="visibility" key={`${editing?.id || "new"}-visibility`} defaultValue={editing?.visibility || "public"}><option value="public">공개</option><option value="unlisted">링크 공개</option><option value="private">비공개</option></select></label><div className="inline-actions">{editing && <button type="button" className="quiet" onClick={() => setEditing(null)}>취소</button>}<button className="primary" type="submit">{editing ? "수정" : "만들기"}</button></div></form><div className="manager-list">{collections.map((collection) => <article key={collection.id}><div><h3>{collection.name}</h3><p>{collection.description || "설명 없음"}</p><small>{collection.wish_count}개 · {collection.visibility === "public" ? "공개" : collection.visibility === "unlisted" ? "링크 공개" : "비공개"}</small></div><div><button onClick={() => setEditing(collection)}>수정</button>{collection.visibility !== "private" && <button onClick={() => onShare(collection.slug)}>공유</button>}<button className="danger" onClick={() => void remove(collection)}>삭제</button></div></article>)}</div></div></Modal>;
}

export default App;
