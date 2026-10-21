export type PurchaseMethod = "unknown" | "self" | "gift" | "other";
export const purchaseMethodLabels: Record<PurchaseMethod, string> = {
  unknown: "취득 방법 미기록", self: "직접 구매", gift: "선물로 받음", other: "기타",
};
export function purchaseExpense(wish: { purchase_method: PurchaseMethod; purchase_price: number | null; price: number | null }) {
  return wish.purchase_method === "gift" ? 0 : wish.purchase_price ?? wish.price ?? 0;
}
