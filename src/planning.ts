import { purchaseExpense, type PurchaseMethod } from './purchase';
export type PlanningWish = {
  id: string; title: string; status: 'wanted' | 'purchased' | 'archived'; price: number | null;
  currency: string; planned_month: string | null; purchased_at: string | null;
  purchase_price: number | null; purchase_method: PurchaseMethod; priority: number;
};
export type Experience = { wish_id: string; rating: number | null; usage: 'using' | 'rarely' | 'finished' | null; note: string; remind_after: string | null };
export type DecisionGroup = { id: string; name: string; wish_ids: string[] };
export function koreanMonth(value: string) {
  const parsed = new Date(/(?:Z|[+-]\d\d:\d\d)$/.test(value) ? value : `${value.replace(' ', 'T')}Z`);
  if (!Number.isFinite(parsed.getTime())) return '';
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit' }).format(parsed);
}
export function simulation(wishes: PlanningWish[], selected: string[], month: string, budget?: number) {
  const purchases = wishes.filter(w => w.status === 'purchased' && w.purchased_at && koreanMonth(w.purchased_at) === month && w.purchase_method !== 'gift');
  const candidates = wishes.filter(w => w.status === 'wanted' && selected.includes(w.id));
  const eligible = (w: PlanningWish) => w.currency === 'KRW';
  const spend = purchases.filter(eligible).reduce((sum, w) => sum + purchaseExpense(w), 0);
  const planned = candidates.filter(eligible).reduce((sum, w) => sum + (w.price ?? 0), 0);
  const missing = candidates.filter(w => eligible(w) && w.price === null).length + purchases.filter(w => eligible(w) && w.purchase_price === null && w.price === null).length;
  const foreign = [...purchases, ...candidates].filter(w => !eligible(w)).length;
  return { spend, planned, missing, foreign, remaining: budget === undefined ? null : budget - spend - planned };
}
export function experienceDue(wish: PlanningWish, record: Experience | undefined, now = Date.now()) {
  if (wish.status !== 'purchased' || !wish.purchased_at || record?.rating != null || record?.usage || record?.note) return false;
  const purchased = Date.parse(wish.purchased_at.replace(' ', 'T') + (/(?:Z|[+-]\d\d:\d\d)$/.test(wish.purchased_at) ? '' : 'Z'));
  const reminder = record?.remind_after ? Date.parse(record.remind_after.replace(' ', 'T') + (/(?:Z|[+-]\d\d:\d\d)$/.test(record.remind_after) ? '' : 'Z')) : 0;
  return Number.isFinite(purchased) && now - purchased >= 30 * 86400000 && (!reminder || reminder <= now);
}
export async function planningApi<T = { ok: boolean }>(path: string, body?: unknown, method = 'POST'): Promise<T> {
  const response = await fetch(`/api/admin/planning${path}`, { method: body === undefined && method === 'POST' ? 'GET' : method, headers: { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const data = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(data.error || '저장하지 못했습니다.');
  return data;
}
