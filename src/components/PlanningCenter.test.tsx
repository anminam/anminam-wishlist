import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PlanningCenter } from './PlanningCenter';
import { SavedSearches, readSavedSearches, type SearchConditions } from './SavedSearches';
import type { PlanningWish } from '../planning';
beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), clear: () => values.clear() });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const current: SearchConditions = {query:'헤드폰',category:'가전',status:'wanted',sort:'priority',view:'list',collection:''};
it('검색 조건을 저장하고 같은 이름 중복을 막으며 다시 적용한다', () => {
  const apply = vi.fn(), message = vi.fn();
  render(<SavedSearches current={current} admin={false} collections={[]} onApply={apply} onMessage={message} />);
  fireEvent.click(screen.getByText('현재 조건 저장'));
  fireEvent.change(screen.getByLabelText('검색 조건 이름'),{target:{value:'관심 가전'}});
  fireEvent.click(screen.getByRole('button',{name:'저장'}));
  expect(readSavedSearches()[0].conditions).toEqual(current);
  fireEvent.click(screen.getByText('현재 조건 저장'));
  fireEvent.change(screen.getByLabelText('검색 조건 이름'),{target:{value:'관심 가전'}});
  fireEvent.click(screen.getByRole('button',{name:'저장'}));
  expect(message).toHaveBeenLastCalledWith(expect.stringContaining('같은 이름'));
  fireEvent.click(screen.getByText('취소'));
  fireEvent.change(screen.getByLabelText('저장한 검색 조건'),{target:{value:readSavedSearches()[0].id}});
  fireEvent.click(screen.getByText('불러오기'));
  expect(apply).toHaveBeenCalledWith(current);
});
it('손상된 저장값을 무시하고 관리자 컬렉션 조건은 공개 화면에서 숨긴다', () => {
  localStorage.setItem('wishlist-saved-searches-v1','{"version":999,"items":[]}'); expect(readSavedSearches()).toEqual([]);
  localStorage.setItem('wishlist-saved-searches-v1',JSON.stringify({version:1,items:[{id:'a',name:'비공개 컬렉션',adminOnly:true,conditions:{...current,collection:'private'}}]}));
  const props = {current,collections:[],onApply:vi.fn(),onMessage:vi.fn()};
  const view = render(<SavedSearches {...props} admin={false} />);
  expect(screen.queryByText('비공개 컬렉션')).toBeNull();
  view.rerender(<SavedSearches {...props} admin={true} />);
  fireEvent.change(screen.getByLabelText('저장한 검색 조건'),{target:{value:'a'}}); fireEvent.click(screen.getByText('불러오기'));
  expect(props.onApply).toHaveBeenCalledWith({...current,collection:''});
  expect(props.onMessage).toHaveBeenCalledWith(expect.stringContaining('컬렉션이 없어'));
});
it('구매 후보의 저장 실패 시 선택을 유지하고 다시 저장한다', async () => {
  let attempts = 0;
  const requests: unknown[] = [];
  vi.stubGlobal('fetch',vi.fn(async (_path: string, init?: RequestInit) => {
    if (init?.method === 'PUT') { requests.push(JSON.parse(String(init.body))); attempts++; return Response.json(attempts === 1 ? {error:'저장 실패'} : {ok:true},{status:attempts === 1 ? 500 : 200}); }
    return Response.json({experiences:[],groups:[]});
  }));
  const wish: PlanningWish = {id:'a',title:'헤드폰 후보',price:150000,currency:'KRW',status:'wanted',planned_month:null,purchased_at:null,purchase_price:null,purchase_method:'self',priority:2};
  render(<PlanningCenter wishes={[wish]} budgets={[]} onChanged={vi.fn().mockResolvedValue(undefined)} onCompare={vi.fn()} />);
  await waitFor(() => expect((screen.getByRole('button',{name:'이 달 구매 예정으로 저장'}) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByText('이 달 구매 예정으로 저장'));
  await screen.findByText('저장 실패');
  expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(true);
  fireEvent.click(screen.getByText('이 달 구매 예정으로 저장'));
  await screen.findByText('구매 예정 월을 저장했습니다.');
  expect(requests).toHaveLength(2); expect(requests[0]).toMatchObject({ids:['a']}); expect(requests[1]).toMatchObject({ids:['a']});
});
