import { useState, type FormEvent } from "react";
import { purchaseMethodLabels, type PurchaseMethod } from "../purchase";

type Props = { initialMethod: PurchaseMethod; initialPrice: number | null; onSave: (method: PurchaseMethod, price: number | null) => Promise<void>; onCancel: () => void };
export function PurchaseCompletion({ initialMethod, initialPrice, onSave, onCancel }: Props) {
  const [method, setMethod] = useState<PurchaseMethod>(initialMethod);
  const [price, setPrice] = useState(initialPrice == null ? "" : String(initialPrice));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    const amount = price.trim() === "" ? null : Number(price.replace(/,/g, ""));
    if (method !== "gift" && amount !== null && (!Number.isSafeInteger(amount) || amount < 0)) { setError("결제 금액은 0 이상의 정수로 입력해주세요."); return; }
    setBusy(true); setError("");
    try { await onSave(method, method === "gift" ? null : amount); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "저장하지 못했습니다."); }
    finally { setBusy(false); }
  }
  return <form className="editor-form" onSubmit={submit}>
    <label>어떻게 갖게 되었나요?<select value={method} onChange={(event) => setMethod(event.target.value as PurchaseMethod)}>{(Object.keys(purchaseMethodLabels) as PurchaseMethod[]).map((key) => <option key={key} value={key}>{purchaseMethodLabels[key]}</option>)}</select></label>
    {method === "gift" ? <p>선물로 받은 상품은 월별 결제 금액 합계에서 제외됩니다.</p> : <label>실제 결제 금액<input inputMode="numeric" value={price} onChange={(event) => setPrice(event.target.value)} placeholder="금액을 입력해주세요" /></label>}
    {error && <p role="alert">{error}</p>}
    <div className="modal-actions"><button type="button" disabled={busy} onClick={onCancel}>취소</button><button className="primary" disabled={busy}>{busy ? "저장 중" : "완료 기록 저장"}</button></div>
  </form>;
}
