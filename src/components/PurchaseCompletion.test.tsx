import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { PurchaseCompletion } from "./PurchaseCompletion";
import { purchaseExpense } from "../purchase";

afterEach(cleanup);
it("선물은 금액 입력 없이 기록하고 지출 합계에서 제외한다", async () => {
  const save = vi.fn().mockResolvedValue(undefined);
  render(<PurchaseCompletion initialMethod="self" initialPrice={50000} onSave={save} onCancel={() => {}} />);
  fireEvent.change(screen.getByLabelText("어떻게 갖게 되었나요?"), { target: { value: "gift" } });
  expect(screen.queryByLabelText("실제 결제 금액")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "완료 기록 저장" }));
  await waitFor(() => expect(save).toHaveBeenCalledWith("gift", null));
  expect(purchaseExpense({ purchase_method: "gift", purchase_price: 50000, price: 60000 })).toBe(0);
  expect(purchaseExpense({ purchase_method: "unknown", purchase_price: 50000, price: 60000 })).toBe(50000);
});
it("직접 구매 금액을 검증하고 저장 오류가 나면 다시 시도할 수 있다", async () => {
  const save = vi.fn().mockRejectedValueOnce(new Error("저장 실패")).mockResolvedValueOnce(undefined);
  render(<PurchaseCompletion initialMethod="self" initialPrice={50000} onSave={save} onCancel={() => {}} />);
  fireEvent.change(screen.getByLabelText("실제 결제 금액"), { target: { value: "-1" } });
  fireEvent.click(screen.getByRole("button", { name: "완료 기록 저장" }));
  expect(save).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("실제 결제 금액"), { target: { value: "42,000" } });
  fireEvent.click(screen.getByRole("button", { name: "완료 기록 저장" }));
  await screen.findByText("저장 실패");
  fireEvent.click(screen.getByRole("button", { name: "완료 기록 저장" }));
  await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
  expect(save).toHaveBeenLastCalledWith("self", 42000);
});
