import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProductPicker } from "./ProductPicker";

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const reply = (title: string) => new Response(JSON.stringify({ title, image: "", price: null, source: "판매처" }));
function setup() {
  const onConfirm = vi.fn();
  const view = render(<ProductPicker initialInput="" onConfirm={onConfirm} />);
  const input = screen.getByLabelText("상품명 또는 링크");
  return { ...view, input, onConfirm };
}
async function lookup(input: HTMLElement, url: string) {
  fireEvent.change(input, { target: { value: url } });
  fireEvent.click(screen.getByRole("button", { name: "링크 확인" }));
  await screen.findByRole("button", { name: "이 상품으로 확정" });
}

describe("상품 검색과 확정", () => {
  it("상품명을 네이버 검색으로 열고 검색어를 유지한다", () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const { input, onConfirm } = setup();
    fireEvent.change(input, { target: { value: "소니 헤드폰" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(open).toHaveBeenCalledWith(expect.stringContaining(encodeURIComponent("소니 헤드폰")), "_blank", "noopener,noreferrer");
    fireEvent.change(input, { target: { value: "https://example.com/product" } });
    expect(screen.getByRole("link", { name: /검색 다시 열기/ }).getAttribute("href")).toContain(encodeURIComponent("소니 헤드폰"));
    expect(onConfirm).not.toHaveBeenCalled();
  });
  it("확정 전에는 폼을 변경하지 않고 다른 상품 선택과 재확정을 지원한다", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(reply("상품 A")).mockResolvedValueOnce(reply("상품 B")));
    const { input, onConfirm } = setup();
    await lookup(input, "https://example.com/a");
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "다른 상품 선택" }));
    await lookup(input, "https://example.com/b");
    fireEvent.click(screen.getByRole("button", { name: "이 상품으로 확정" }));
    expect(onConfirm).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ title: "상품 B", url: "https://example.com/b", price: null, image: "" }));
    fireEvent.click(screen.getByRole("button", { name: "상품 다시 선택" }));
    expect(screen.queryByText("선택한 상품을 입력 폼에 반영했습니다.")).toBeNull();
  });
  it("입력 변경 후 늦게 도착한 응답은 무시하고 종료 시 요청을 취소한다", async () => {
    let resolve!: (value: Response) => void;
    const fetchMock = vi.fn().mockImplementation(() => new Promise<Response>((done) => { resolve = done; }));
    vi.stubGlobal("fetch", fetchMock);
    const { input, unmount } = setup();
    fireEvent.change(input, { target: { value: "https://example.com/a" } });
    fireEvent.click(screen.getByRole("button", { name: "링크 확인" }));
    const signal = fetchMock.mock.calls[0][1].signal as AbortSignal;
    fireEvent.change(input, { target: { value: "새 상품" } });
    expect(signal.aborted).toBe(true);
    await act(async () => { resolve(reply("이전 상품")); });
    expect(screen.queryByText("이전 상품")).toBeNull();
    fireEvent.change(input, { target: { value: "https://example.com/b" } });
    fireEvent.click(screen.getByRole("button", { name: "링크 확인" }));
    const nextSignal = fetchMock.mock.calls[1][1].signal as AbortSignal;
    unmount(); expect(nextSignal.aborted).toBe(true);
  });
  it("조회 차단과 상품명 누락을 안내하고 확정을 막는다", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ error: "접근 제한" }), { status: 422 })).mockResolvedValueOnce(reply("")));
    const { input, onConfirm } = setup();
    fireEvent.change(input, { target: { value: "https://example.com/a" } });
    fireEvent.click(screen.getByRole("button", { name: "링크 확인" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("접근 제한"));
    await lookup(input, "https://example.com/b");
    expect((screen.getByRole("button", { name: "이 상품으로 확정" }) as HTMLButtonElement).disabled).toBe(true);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
