import { useState } from 'react';
export type SearchConditions = { query: string; category: string; status: 'wanted' | 'purchased' | 'archived'; sort: string; view: 'grid' | 'compact' | 'list'; collection: string };
type SavedSearch = { id: string; name: string; adminOnly: boolean; conditions: SearchConditions };
const key = 'wishlist-saved-searches-v1';
export function readSavedSearches(): SavedSearch[] {
  try {
    const data = JSON.parse(localStorage.getItem(key) || 'null');
    if (data?.version !== 1 || !Array.isArray(data.items)) return [];
    return data.items.filter((s: SavedSearch) => s && typeof s.id === 'string' && typeof s.name === 'string' && s.name.length > 0 && s.name.length <= 40 && typeof s.adminOnly === 'boolean' && s.conditions && ['query', 'category', 'collection'].every(k => typeof s.conditions[k as keyof SearchConditions] === 'string') && ['wanted', 'purchased', 'archived'].includes(s.conditions.status) && ['newest', 'oldest', 'priority', 'price_asc', 'price_desc'].includes(s.conditions.sort) && ['grid', 'compact', 'list'].includes(s.conditions.view) && (!s.conditions.collection || s.adminOnly)).slice(0, 20);
  } catch { return []; }
}
export function SavedSearches({ current, admin, collections, onApply, onMessage }: { current: SearchConditions; admin: boolean; collections: string[]; onApply: (value: SearchConditions) => void; onMessage: (value: string) => void }) {
  const [items, setItems] = useState(readSavedSearches);
  const [selected, setSelected] = useState('');
  const [name, setName] = useState('');
  const [editing, setEditing] = useState(false);
  function persist(next: SavedSearch[]) {
    try { localStorage.setItem(key, JSON.stringify({ version: 1, items: next })); setItems(next); return true; }
    catch { onMessage('이 브라우저에 검색 조건을 저장할 수 없습니다.'); return false; }
  }
  const visible = items.filter(s => admin || !s.adminOnly);
  return <div className="saved-searches">
    <select aria-label="저장한 검색 조건" value={selected} onChange={e => { setSelected(e.target.value); setEditing(false); }}><option value="">저장한 검색 조건</option>{visible.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
    <button disabled={!visible.some(s => s.id === selected)} onClick={() => {
      const saved = visible.find(s => s.id === selected); if (!saved) return;
      const conditions = { ...saved.conditions };
      if (conditions.collection && !collections.includes(conditions.collection)) { conditions.collection = ''; onMessage('저장된 컬렉션이 없어 컬렉션 조건을 해제했어요.'); }
      onApply(conditions);
    }}>불러오기</button>
    <button onClick={() => { setEditing(true); setSelected(''); setName(''); }}>현재 조건 저장</button>
    {selected && <><button onClick={() => { setEditing(true); setName(items.find(s => s.id === selected)?.name || ''); }}>이름 변경</button><button onClick={() => { if (persist(items.filter(s => s.id !== selected))) { setSelected(''); setEditing(false); } }}>삭제</button></>}
    {editing && <form className="inline-actions" onSubmit={e => {
      e.preventDefault(); const trimmed = name.trim();
      if (!trimmed) return;
      if (items.some(s => s.id !== selected && s.name === trimmed)) { onMessage('같은 이름의 검색 조건이 있어요. 다른 이름을 적어주세요.'); return; }
      if (!selected && items.length >= 20) { onMessage('검색 조건은 최대 20개까지 저장할 수 있어요.'); return; }
      const next = selected ? items.map(s => s.id === selected ? { ...s, name: trimmed } : s) : [...items, { id: crypto.randomUUID(), name: trimmed, adminOnly: !!current.collection, conditions: { ...current } }];
      if (persist(next)) { setEditing(false); onMessage('이 브라우저에 검색 조건을 저장했습니다.'); }
    }}><input aria-label="검색 조건 이름" maxLength={40} value={name} onChange={e => setName(e.target.value)} required /><button type="submit">저장</button><button type="button" onClick={() => setEditing(false)}>취소</button></form>}
  </div>;
}
