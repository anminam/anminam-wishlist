// The caller must authenticate every request before entering this module.
const reply = (data: unknown, status = 200) => Response.json(data, { status });
const fail = (message: string, status = 400) => reply({ error: message }, status);
const month = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
function ids(value: unknown, min = 1, max = 80): string[] | null {
  return Array.isArray(value) && value.length >= min && value.length <= max && value.every(id => typeof id === 'string' && id.length > 0 && id.length <= 100) && new Set(value).size === value.length ? value : null;
}
async function rows(db: D1Database, selected: string[]) {
  return (await db.prepare('SELECT id, status, planned_month FROM wishes WHERE id IN (SELECT value FROM json_each(?))').bind(JSON.stringify(selected)).all<{ id: string; status: string; planned_month: string | null }>()).results;
}
export async function planningRequest(request: Request, db: D1Database, body: Record<string, unknown> = {}): Promise<Response> {
  const path = new URL(request.url).pathname;
  if (path === '/api/admin/planning' && request.method === 'GET') {
    const [experiences, groups, members] = await Promise.all([
      db.prepare('SELECT * FROM wish_experiences').all(),
      db.prepare('SELECT * FROM decision_groups ORDER BY created_at DESC').all(),
      db.prepare('SELECT * FROM decision_members').all(),
    ]);
    return reply({ experiences: experiences.results, groups: groups.results.map(group => ({ ...group, wish_ids: members.results.filter(member => member.group_id === group.id).map(member => member.wish_id) })) });
  }
  if (path === '/api/admin/planning/month' && request.method === 'PUT') {
    const selected = ids(body.ids, 0);
    const removed = ids(body.remove_ids, 0, 500);
    if (!month(body.month) || !selected || !removed || removed.some(id => selected.includes(id))) return fail('구매 예정 월과 후보를 확인해주세요. 화면을 다시 열고 저장해주세요.');
    const found = await rows(db, selected);
    const removedRows = await rows(db, removed);
    if (found.length !== selected.length || found.some(row => row.status !== 'wanted') || removedRows.length !== removed.length || removedRows.some(row => row.status !== 'wanted' || row.planned_month !== body.month)) return fail('후보 상태가 변경되었습니다. 목록을 새로 불러와주세요.', 409);
    // Update only selected candidates and explicitly deselected plans, never unseen rows.
    const result = await db.prepare(`UPDATE wishes SET planned_month = CASE WHEN id IN (SELECT value FROM json_each(?)) THEN ? ELSE NULL END, updated_at = datetime('now') WHERE status = 'wanted' AND (id IN (SELECT value FROM json_each(?)) OR (planned_month = ? AND id IN (SELECT value FROM json_each(?))))`).bind(JSON.stringify(selected), body.month, JSON.stringify(selected), body.month, JSON.stringify(removed)).run();
    return reply({ ok: true, changed: result.meta.changes });
  }
  if (path === '/api/admin/planning/bulk' && request.method === 'PATCH') {
    const selected = ids(body.ids);
    if (!selected || !['month', 'archive', 'restore'].includes(String(body.action))) return fail('변경할 위시와 작업을 확인해주세요. 한 번에 최대 80개까지 선택할 수 있어요.');
    const found = await rows(db, selected);
    if (found.length !== selected.length || found.some(row => row.status === 'purchased')) return fail('구매 완료 항목은 일괄 변경할 수 없어요. 목록을 새로 불러와주세요.', 409);
    if (body.action === 'month') {
      if (body.month !== null && !month(body.month)) return fail('구매 예정 월을 확인해주세요.');
      if (found.some(row => row.status !== 'wanted')) return fail('구매 예정 월은 갖고 싶은 위시에서 정해주세요.');
      await db.prepare("UPDATE wishes SET planned_month = ?, updated_at = datetime('now') WHERE status = 'wanted' AND id IN (SELECT value FROM json_each(?))").bind(body.month, JSON.stringify(selected)).run();
    } else {
      await db.prepare("UPDATE wishes SET status = ?, updated_at = datetime('now') WHERE status IN ('wanted', 'archived') AND id IN (SELECT value FROM json_each(?))").bind(body.action === 'archive' ? 'archived' : 'wanted', JSON.stringify(selected)).run();
    }
    return reply({ ok: true });
  }
  const experience = path.match(/^\/api\/admin\/planning\/experiences\/([^/]+)$/);
  if (experience && ['PUT', 'DELETE'].includes(request.method)) {
    const id = decodeURIComponent(experience[1]);
    const wish = await db.prepare('SELECT status FROM wishes WHERE id = ?').bind(id).first<{ status: string }>();
    if (!wish || wish.status !== 'purchased') return fail('구매 완료 항목에서 사용 기록을 남겨주세요.', 409);
    if (request.method === 'DELETE') {
      await db.prepare('DELETE FROM wish_experiences WHERE wish_id = ?').bind(id).run();
    } else if (body.snooze === true) {
      await db.prepare("INSERT INTO wish_experiences (wish_id, remind_after) VALUES (?, datetime('now', '+30 days')) ON CONFLICT(wish_id) DO UPDATE SET remind_after = datetime('now', '+30 days'), updated_at = datetime('now')").bind(id).run();
    } else {
      if (body.rating !== null && (typeof body.rating !== 'number' || !Number.isInteger(body.rating) || body.rating < 1 || body.rating > 5)) return fail('만족도는 1~5점 중 선택해주세요.');
      if (body.usage !== null && !['using', 'rarely', 'finished'].includes(String(body.usage))) return fail('사용 상태를 확인해주세요.');
      if (typeof body.note !== 'string' || body.note.length > 1000) return fail('후기는 1,000자 이내로 적어주세요.');
      await db.prepare(`INSERT INTO wish_experiences (wish_id, rating, usage, note) VALUES (?, ?, ?, ?) ON CONFLICT(wish_id) DO UPDATE SET rating = excluded.rating, usage = excluded.usage, note = excluded.note, remind_after = NULL, updated_at = datetime('now')`).bind(id, body.rating, body.usage, body.note.trim()).run();
    }
    return reply({ ok: true });
  }
  if (path === '/api/admin/planning/groups' && request.method === 'POST') {
    const selected = ids(body.ids, 2, 20);
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!selected || !name || name.length > 80) return fail('묶음 이름과 2~20개의 후보를 선택해주세요.');
    if ((await rows(db, selected)).length !== selected.length) return fail('후보를 찾을 수 없습니다.', 409);
    const id = crypto.randomUUID();
    await db.batch([
      db.prepare('INSERT INTO decision_groups (id, name) VALUES (?, ?)').bind(id, name),
      ...selected.map(wishId => db.prepare('INSERT INTO decision_members (group_id, wish_id) VALUES (?, ?)').bind(id, wishId)),
    ]);
    return reply({ ok: true, id }, 201);
  }
  const group = path.match(/^\/api\/admin\/planning\/groups\/([^/]+)$/);
  if (group && request.method === 'DELETE') {
    const id = decodeURIComponent(group[1]);
    await db.batch([db.prepare('DELETE FROM decision_members WHERE group_id = ?').bind(id), db.prepare('DELETE FROM decision_groups WHERE id = ?').bind(id)]);
    return reply({ ok: true });
  }
  if (group && request.method === 'PATCH') {
    const selected = ids(body.ids, 1, 20);
    if (!selected || typeof body.purchased_id !== 'string' || selected.includes(body.purchased_id)) return fail('보관할 다른 후보를 선택해주세요.');
    const members = (await db.prepare('SELECT w.id, w.status FROM decision_members m JOIN wishes w ON w.id = m.wish_id WHERE m.group_id = ?').bind(decodeURIComponent(group[1])).all<{ id: string; status: string }>()).results;
    if (!members.some(row => row.id === body.purchased_id && row.status === 'purchased') || selected.some(id => !members.some(row => row.id === id && row.status === 'wanted'))) return fail('구매 완료 기록과 후보 상태를 다시 확인해주세요.', 409);
    await db.prepare("UPDATE wishes SET status = 'archived', updated_at = datetime('now') WHERE status = 'wanted' AND id IN (SELECT value FROM json_each(?))").bind(JSON.stringify(selected)).run();
    return reply({ ok: true });
  }
  return fail('요청을 찾을 수 없습니다.', 404);
}
