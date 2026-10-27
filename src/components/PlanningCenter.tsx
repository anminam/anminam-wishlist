import { useEffect, useState } from 'react';
import { experienceDue, koreanMonth, planningApi, simulation, type DecisionGroup, type Experience, type PlanningWish } from '../planning';
import './planning.css';
const money = (value: number) => `${value.toLocaleString('ko-KR')}원`;
const statusNames = { wanted: '갖고 싶은 것', purchased: '구매 완료', archived: '보관함' };
export function PlanningCenter({ wishes, budgets, onChanged, onCompare }: { wishes: PlanningWish[]; budgets: { month: string; amount: number }[]; onChanged: () => Promise<void>; onCompare: (ids: string[]) => void }) {
  const [tab, setTab] = useState('month');
  const [month, setMonth] = useState(() => koreanMonth(new Date().toISOString()));
  const [selected, setSelected] = useState<string[]>([]);
  const [experiences, setExperiences] = useState<Experience[]>([]);
  const [groups, setGroups] = useState<DecisionGroup[]>([]);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [query, setQuery] = useState('');
  const [bulkStatus, setBulkStatus] = useState<'wanted' | 'archived'>('wanted');
  const [action, setAction] = useState('month');
  const [bulkMonth, setBulkMonth] = useState(month);
  const [name, setName] = useState('');
  const [editing, setEditing] = useState<string>('');
  const [rating, setRating] = useState('');
  const [usage, setUsage] = useState('');
  const [note, setNote] = useState('');
  const [showAllExperiences, setShowAllExperiences] = useState(false);
  const [resolving, setResolving] = useState('');
  const [winner, setWinner] = useState('');
  async function load() {
    setError('');
    const data = await planningApi<{ experiences: Experience[]; groups: DecisionGroup[] }>('');
    setExperiences(data.experiences); setGroups(data.groups); setReady(true);
  }
  useEffect(() => { void load().catch(e => setError(e.message)); }, []);
  useEffect(() => {
    setSelected(tab === 'month' ? wishes.filter(w => w.status === 'wanted' && w.planned_month === month).map(w => w.id) : []);
    setQuery(''); setNotice(''); setResolving('');
  }, [tab, month, wishes]);
  useEffect(() => { if (tab === 'bulk') setSelected([]); }, [bulkStatus, query, tab]);
  const result = simulation(wishes, selected, month, budgets.find(b => b.month === month)?.amount);
  const visible = wishes.filter(w => (tab !== 'bulk' || w.status === bulkStatus) && (tab !== 'month' || w.status === 'wanted') && w.title.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const due = wishes.filter(w => experienceDue(w, experiences.find(e => e.wish_id === w.id)));
  function toggle(id: string) { setSelected(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id]); }
  async function run(work: () => Promise<unknown>, message: string) {
    if (busy) return;
    setBusy(true); setError(''); setNotice('');
    try { await work(); await onChanged(); await load(); if (tab !== 'month') setSelected([]); setNotice(message); }
    catch (e) { setError(e instanceof Error ? e.message : '처리하지 못했습니다.'); }
    finally { setBusy(false); }
  }
  function edit(wish: PlanningWish) {
    const record = experiences.find(e => e.wish_id === wish.id);
    setEditing(wish.id); setRating(record?.rating ? String(record.rating) : ''); setUsage(record?.usage || ''); setNote(record?.note || ''); setError('');
  }
  return <div className="planning-center">
    <div className="planning-tabs" role="tablist" aria-label="구매 계획 기능">{[['month', '구매 후보'], ['bulk', '일괄 정리'], ['experience', `사용 기록${due.length ? ` · ${due.length}` : ''}`], ['groups', '대체 상품 묶음']].map(([key, label]) => <button role="tab" aria-selected={tab === key} key={key} onClick={() => { setTab(key); setEditing(''); }} disabled={busy}>{label}</button>)}</div>
    {error && <p role="alert" className="planning-error">{error}</p>}{notice && <p role="status">{notice}</p>}
    {!ready && <p>계획 정보를 불러오는 중입니다. {error && <button onClick={() => void load().catch(e => setError(e.message))}>다시 불러오기</button>}</p>}
    <fieldset disabled={busy || !ready} className="planning-fields">
    {tab === 'month' && <>
      <p>후보를 골라 예산을 확인해요. 저장해야 구매 예정 월에 반영됩니다.</p>
      <label>구매할 월<input type="month" value={month} onChange={e => setMonth(e.target.value)} required /></label>
      <div className="planning-totals"><div><small>구매 지출</small><strong>{money(result.spend)}</strong></div><div><small>선택한 후보</small><strong>{money(result.planned)}</strong></div><div><small>{result.remaining !== null && result.remaining < 0 ? '예산 초과' : '남는 예산'}</small><strong>{result.remaining === null ? '예산 미설정' : money(Math.abs(result.remaining))}</strong></div></div>
      <p className="muted">가격 확인된 원화 항목 기준 · 선물 지출 제외{result.missing > 0 && ` · 가격 미정 ${result.missing}개`}{result.foreign > 0 && ` · 다른 통화 ${result.foreign}개 별도 (합산 제외)`}</p>
      <label>후보 검색<input value={query} onChange={e => setQuery(e.target.value)} /></label>
      <CandidateList wishes={visible} selected={selected} toggle={toggle} />
      <p>{selected.length}개 선택 · 다른 월에 예정된 후보를 선택하면 이 달로 옮깁니다. 해제한 이 달 후보는 예정 월이 비워집니다.</p>
      <button className="primary" disabled={!month || selected.length > 80} onClick={() => void run(() => planningApi('/month', { month, ids: selected, remove_ids: wishes.filter(w => w.status === 'wanted' && w.planned_month === month && !selected.includes(w.id)).map(w => w.id) }, 'PUT'), '구매 예정 월을 저장했습니다.')}>이 달 구매 예정으로 저장</button>
    </>}
    {tab === 'bulk' && <>
      <p>현재 표시된 위시를 선택해 한 번에 정리해요. 구매 완료 기록은 개별 항목에서 수정해주세요.</p>
      <label>정리할 상태<select value={bulkStatus} onChange={e => setBulkStatus(e.target.value as 'wanted' | 'archived')}><option value="wanted">갖고 싶은 것</option><option value="archived">보관함</option></select></label>
      <label>정리할 위시 검색<input value={query} onChange={e => setQuery(e.target.value)} /></label>
      <button onClick={() => setSelected(visible.slice(0, 80).map(w => w.id))}>표시된 항목 선택 (최대 80개)</button> <button onClick={() => setSelected([])}>선택 해제</button>
      <CandidateList wishes={visible} selected={selected} toggle={toggle} />
      <label>변경할 내용<select value={action} onChange={e => setAction(e.target.value)}><option value="month">구매 예정 월 변경·해제</option><option value="archive">보관함으로 이동</option><option value="restore">갖고 싶은 것으로 복귀</option></select></label>
      {action === 'month' && <label>새 구매 예정 월 (비우면 해제)<input type="month" value={bulkMonth} onChange={e => setBulkMonth(e.target.value)} /></label>}
      <p>{selected.length}개에 적용 · {action === 'month' ? bulkMonth || '예정 월 해제' : action === 'archive' ? '보관함으로 이동' : '갖고 싶은 것으로 복귀'}</p>
      <button className="primary" disabled={!selected.length || selected.length > 80 || (action === 'month' && bulkStatus !== 'wanted')} onClick={() => {
        if (window.confirm(`${selected.length}개의 위시에 표시된 변경을 적용할까요?`)) void run(() => planningApi('/bulk', { action, ids: selected, month: bulkMonth || null }, 'PATCH'), '선택한 위시를 정리했습니다.');
      }}>선택한 위시에 적용</button>
    </>}
    {tab === 'experience' && <>
      <p>구매하거나 선물 받은 뒤의 경험을 기록해요. 만족도와 후기는 관리자에게만 보입니다.</p>
      <label className="planning-check"><input type="checkbox" checked={showAllExperiences} onChange={e => setShowAllExperiences(e.target.checked)} />전체 구매 완료 항목 보기</label>
      {!showAllExperiences && <p>구매 30일 후 미기록 항목 {due.length}개</p>}
      {(showAllExperiences ? wishes.filter(w => w.status === 'purchased') : due).map(w => {
        const record = experiences.find(e => e.wish_id === w.id);
        return <article className="planning-record" key={w.id}><strong>{w.title}</strong><p>{record?.rating ? `만족도 ${record.rating}점` : '만족도 미기록'}{record?.usage ? ` · ${{ using: '사용 중', rarely: '거의 사용 안 함', finished: '사용 종료' }[record.usage]}` : ''}</p>{record?.note && <p>{record.note}</p>}
          <button onClick={() => edit(w)}>사용 기록 {record?.rating || record?.usage || record?.note ? '수정' : '남기기'}</button> <button onClick={() => void run(() => planningApi(`/experiences/${encodeURIComponent(w.id)}`, { snooze: true }, 'PUT'), '30일 뒤 다시 알려드릴게요.')}>한 달 미루기</button>
        </article>;
      })}
      {editing && <form className="stack-form planning-record" onSubmit={e => { e.preventDefault(); void run(async () => { await planningApi(`/experiences/${encodeURIComponent(editing)}`, { rating: rating ? Number(rating) : null, usage: usage || null, note }, 'PUT'); setEditing(''); }, '사용 기록을 저장했습니다.'); }}>
        <h3>{wishes.find(w => w.id === editing)?.title}</h3>
        <label>만족도<select value={rating} onChange={e => setRating(e.target.value)}><option value="">미기록</option>{[1,2,3,4,5].map(n => <option key={n} value={n}>{n}점</option>)}</select></label>
        <label>사용 상태<select value={usage} onChange={e => setUsage(e.target.value)}><option value="">미기록</option><option value="using">사용 중</option><option value="rarely">거의 사용 안 함</option><option value="finished">사용 종료</option></select></label>
        <label>짧은 후기<textarea maxLength={1000} rows={3} value={note} onChange={e => setNote(e.target.value)} /></label>
        <div className="inline-actions"><button type="button" onClick={() => setEditing('')}>취소</button><button className="primary">사용 기록 저장</button><button type="button" className="danger" onClick={() => {
          if (window.confirm('만족도와 사용 기록을 지울까요? 구매 기록은 유지됩니다.')) void run(async () => { await planningApi(`/experiences/${encodeURIComponent(editing)}`, undefined, 'DELETE'); setEditing(''); }, '사용 기록을 지웠습니다.');
        }}>사용 기록 지우기</button></div>
      </form>}
    </>}
    {tab === 'groups' && <>
      <p>같은 용도의 상품을 묶어 비교하고, 하나를 구매한 뒤 다른 후보를 정리해요. 묶음은 관리자에게만 보입니다.</p>
      {groups.map(group => <article className="planning-record" key={group.id}>
        <h3>{group.name}</h3><ul>{group.wish_ids.map(id => { const w = wishes.find(w => w.id === id); return w ? <li key={id}>{w.title} · {statusNames[w.status]}</li> : null; })}</ul>
        <div className="inline-actions"><button onClick={() => onCompare(group.wish_ids.slice(0, 4))} disabled={!group.wish_ids.length}>앞의 최대 4개 비교</button><button onClick={() => { setResolving(group.id); setWinner(''); setSelected([]); }}>구매 후 다른 후보 정리</button><button className="danger" onClick={() => { if (window.confirm('묶음을 삭제할까요? 위시는 유지됩니다.')) void run(() => planningApi(`/groups/${group.id}`, undefined, 'DELETE'), '묶음을 삭제했습니다.'); }}>묶음 삭제</button></div>
        {resolving === group.id && <div className="planning-record"><label>구매 완료한 후보<select value={winner} onChange={e => setWinner(e.target.value)}><option value="">선택해주세요</option>{group.wish_ids.map(id => wishes.find(w => w.id === id)).filter((w): w is PlanningWish => !!w && w.status === 'purchased').map(w => <option key={w.id} value={w.id}>{w.title}</option>)}</select></label><p>구매 완료는 기존 위시에서 먼저 기록해주세요. 보관할 후보만 직접 선택해요.</p><CandidateList wishes={wishes.filter(w => group.wish_ids.includes(w.id) && w.status === 'wanted')} selected={selected} toggle={toggle} /><button disabled={!winner || !selected.length} onClick={() => { if (window.confirm(`${selected.length}개의 다른 후보를 보관할까요?`)) void run(async () => { await planningApi(`/groups/${group.id}`, { purchased_id: winner, ids: selected }, 'PATCH'); setResolving(''); }, '선택한 다른 후보를 보관했습니다.'); }}>선택한 다른 후보 보관</button> <button onClick={() => { setResolving(''); setSelected([]); }}>그대로 유지</button></div>}
      </article>)}
      {!resolving && <><h3>새 대체 상품 묶음</h3><label>묶음 이름<input value={name} maxLength={80} onChange={e => setName(e.target.value)} placeholder="예: 무선 헤드폰 후보" /></label><label>묶을 위시 검색<input value={query} onChange={e => setQuery(e.target.value)} /></label><CandidateList wishes={visible} selected={selected} toggle={toggle} /><p>{selected.length}개 선택 · 2~20개</p><button className="primary" disabled={!name.trim() || selected.length < 2 || selected.length > 20} onClick={() => void run(async () => { await planningApi('/groups', { name, ids: selected }); setName(''); }, '대체 상품 묶음을 만들었습니다.')}>묶음 만들기</button></>}
    </>}
    </fieldset>
  </div>;
}
function CandidateList({ wishes, selected, toggle }: { wishes: PlanningWish[]; selected: string[]; toggle: (id: string) => void }) {
  return <div className="planning-candidates">{wishes.length ? wishes.map(w => <label className="planning-candidate" key={w.id}><input type="checkbox" checked={selected.includes(w.id)} onChange={() => toggle(w.id)} /><span><strong>{w.title}</strong><small>{w.planned_month ? `${w.planned_month} 예정 · ` : ''}{w.price === null ? '가격 미정' : w.currency === 'KRW' ? money(w.price) : `${w.price.toLocaleString()} ${w.currency} · 원화 합산 제외`}</small></span></label>) : <p className="muted">해당하는 위시가 없어요.</p>}</div>;
}
