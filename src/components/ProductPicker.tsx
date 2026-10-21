import { useEffect, useRef, useState } from "react";

export type ProductCandidate = { url: string; title: string; image?: string; price?: number | null; currency?: string; source?: string };
type Props = { initialInput: string; onConfirm: (product: ProductCandidate) => void };

export function ProductPicker({ initialInput, onConfirm }: Props) {
  const [input, setInput] = useState(initialInput);
  const [searchTerm, setSearchTerm] = useState("");
  const [selected, setSelected] = useState<ProductCandidate | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const naverUrl = (term: string) => `https://search.shopping.naver.com/search/all?query=${encodeURIComponent(term)}`;
  function cancel() { controller.current?.abort(); controller.current = null; setBusy(false); }
  async function search() {
    const value = input.trim(); if (!value) return;
    cancel(); setSelected(null); setConfirmed(false); setError("");
    if (!/^https?:\/\//i.test(value)) {
      if (/^[a-z][a-z\d+.-]*:/i.test(value)) { setError("http 또는 https 상품 링크를 입력해주세요."); return; }
      setSearchTerm(value);
      window.open(naverUrl(value), "_blank", "noopener,noreferrer");
      return;
    }
    try { new URL(value); } catch { setError("올바른 상품 링크를 입력해주세요."); return; }
    const current = new AbortController(); controller.current = current;
    setBusy(true);
    try {
      const response = await fetch("/api/metadata", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: value }), signal: current.signal });
      const metadata = await response.json() as Omit<ProductCandidate, "url"> & { error?: string };
      if (!response.ok) throw new Error(metadata.error || "상품 정보를 가져오지 못했습니다.");
      if (!current.signal.aborted) {
        setSelected({ ...metadata, url: value, title: metadata.title || "" });
        if (!metadata.title) setError("상품명을 확인하지 못했습니다. 아래 입력 폼에서 직접 입력해주세요.");
      }
    } catch (cause) {
      if (!current.signal.aborted) setError(cause instanceof Error ? cause.message : "상품 정보를 가져오지 못했습니다.");
    } finally { if (!current.signal.aborted) setBusy(false); }
  }

  return <section className="product-picker" aria-label="상품 검색 및 선택">
    <div className="url-fetch"><label>상품명 또는 링크<input value={input} maxLength={2048} placeholder="상품명 또는 https:// 상품 링크" onChange={(event) => { cancel(); setInput(event.target.value); setSelected(null); setConfirmed(false); setError(""); }} onKeyDown={(event) => { if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); void search(); } }} /></label><button type="button" disabled={busy || !input.trim()} onClick={() => void search()}>{busy ? "확인 중" : /^https?:\/\//i.test(input.trim()) ? "링크 확인" : "네이버 쇼핑 검색 ↗"}</button></div>
    {searchTerm && <div className="product-search-guide"><a href={naverUrl(searchTerm)} target="_blank" rel="noreferrer">‘{searchTerm}’ 검색 다시 열기 ↗</a><p>네이버 쇼핑에서 상품을 고른 뒤, 판매 페이지 링크를 위 입력창에 붙여넣고 ‘링크 확인’을 눌러주세요.</p></div>}
    {error && <p role="alert">{error}</p>}
    {busy && <p role="status">상품 정보를 확인하고 있어요.</p>}
    {confirmed ? <div className="product-confirmed"><span>선택한 상품을 입력 폼에 반영했습니다.</span><button type="button" onClick={() => { setConfirmed(false); setSelected(null); }}>상품 다시 선택</button></div> : selected ? <article className="product-preview">
      {selected.image && <img src={selected.image} alt="" referrerPolicy="no-referrer" />}
      <div><strong>{selected.title || "상품명 미확인"}</strong><p>{selected.source || new URL(selected.url).hostname}</p><p>{selected.price == null ? "가격 미확인" : `${selected.price.toLocaleString("ko-KR")} ${selected.currency || "KRW"}`}</p><a href={selected.url} target="_blank" rel="noreferrer">판매 페이지 열기 ↗</a><small>모델·옵션·배송비와 실제 판매 가격을 확인해주세요.</small></div>
      <div className="product-picker-actions"><button type="button" onClick={() => { cancel(); setSelected(null); setError(""); }}>다른 상품 선택</button><button type="button" className="primary" disabled={busy || !selected.title} onClick={() => { onConfirm(selected); setConfirmed(true); }}>이 상품으로 확정</button></div>
    </article> : null}
    <small>상품 정보를 확인하고 확정한 뒤 아래에서 수정·저장하세요. 직접 입력도 가능합니다.</small>
  </section>;
}
