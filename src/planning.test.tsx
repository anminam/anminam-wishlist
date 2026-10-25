// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { planningRequest } from '../worker/planning';
import worker from '../worker/index';
import { experienceDue, simulation, type PlanningWish } from './planning';
let sqlite: DatabaseSync;
let db: D1Database;
beforeEach(() => {
  sqlite = new DatabaseSync(':memory:'); sqlite.exec('PRAGMA foreign_keys=ON');
  for (const file of readdirSync('migrations').filter(f => f.endsWith('.sql')).sort()) sqlite.exec(readFileSync(`migrations/${file}`, 'utf8'));
  function prepare(sql: string, args: unknown[] = []): unknown {
    return {
      bind: (...values: unknown[]) => prepare(sql, values),
      all: async () => ({ results: sqlite.prepare(sql).all(...args as never[]) }),
      first: async () => sqlite.prepare(sql).get(...args as never[]) || null,
      run: async () => ({ meta: { changes: Number(sqlite.prepare(sql).run(...args as never[]).changes) } }),
    };
  }
  db = { prepare, batch: async (statements: D1PreparedStatement[]) => { sqlite.exec('BEGIN'); try { const result = []; for (const statement of statements) result.push(await statement.run()); sqlite.exec('COMMIT'); return result; } catch (e) { sqlite.exec('ROLLBACK'); throw e; } } } as unknown as D1Database;
  for (const [id, status, planned] of [['a','wanted','2026-10'],['b','wanted','2026-11'],['c','wanted','2026-10'],['p','purchased',null],['h','archived',null]]) {
    sqlite.prepare('INSERT INTO wishes(id,title,url,status,planned_month,purchase_price,purchased_at) VALUES(?,?,?,?,?,42000,?)').run(id, id, `https://example.com/${id}`, status, planned, status === 'purchased' ? '2026-09-01' : null);
  }
});
afterEach(() => { sqlite.close(); vi.unstubAllGlobals(); });
async function call(path: string, body: Record<string, unknown> = {}, method = 'PUT') {
  return planningRequest(new Request(`https://example.com/api/admin/planning${path}`, { method }), db, body);
}
it('월 후보를 원자적으로 교체하고 다른 월의 미선택 위시와 구매 기록을 보존한다', async () => {
  expect((await call('/month', { month: '2026-10', ids: ['b'] })).status).toBe(200);
  expect(sqlite.prepare('SELECT id,planned_month FROM wishes WHERE id IN (\'a\',\'b\',\'c\') ORDER BY id').all().map(r => [r.id,r.planned_month])).toEqual([['a',null],['b','2026-10'],['c',null]]);
  expect(sqlite.prepare("SELECT purchase_price,purchased_at FROM wishes WHERE id='p'").get()).toMatchObject({ purchase_price:42000, purchased_at:'2026-09-01' });
  expect((await call('/month', { month:'2026-11',ids:[] })).status).toBe(200);
  expect(sqlite.prepare("SELECT planned_month FROM wishes WHERE id='b'").get()?.planned_month).toBe('2026-10');
});
it('일괄 요청에서 구매 완료·없는 ID·중복·과도한 선택을 거절하며 부분 변경하지 않는다', async () => {
  for (const selected of [['a','p'],['a','missing'],['a','a'],Array.from({length:81},(_,i)=>String(i))]) expect((await call('/bulk',{action:'archive',ids:selected},'PATCH')).status).toBeGreaterThanOrEqual(400);
  expect(sqlite.prepare("SELECT status FROM wishes WHERE id='a'").get()?.status).toBe('wanted');
  expect((await call('/bulk',{action:'month',ids:['h'],month:'2026-10'},'PATCH')).status).toBe(400);
  expect((await call('/bulk',{action:'archive',ids:['a']},'PATCH')).status).toBe(200);
  expect((await call('/bulk',{action:'restore',ids:['a']},'PATCH')).status).toBe(200);
});
it('사용 기록 검증·미루기·삭제는 구매 금액과 날짜를 보존한다', async () => {
  expect((await call('/experiences/a',{rating:5,usage:null,note:''})).status).toBe(409);
  expect((await call('/experiences/p',{rating:0,usage:null,note:''})).status).toBe(400);
  expect((await call('/experiences/p',{rating:5,usage:'using',note:'좋아요'})).status).toBe(200);
  await call('/experiences/p',{snooze:true});
  expect(sqlite.prepare('SELECT rating,note,remind_after FROM wish_experiences').get()).toMatchObject({rating:5,note:'좋아요',remind_after:expect.any(String)});
  await call('/experiences/p',{},'DELETE');
  expect(sqlite.prepare('SELECT COUNT(*) AS n FROM wish_experiences').get()?.n).toBe(0);
  expect(sqlite.prepare("SELECT purchase_price,purchased_at FROM wishes WHERE id='p'").get()).toMatchObject({purchase_price:42000,purchased_at:'2026-09-01'});
});
it('구매 완료 후보가 있을 때 명시적으로 선택한 대체 후보만 보관한다', async () => {
  const response = await call('/groups',{name:'후보',ids:['a','b','p']},'POST');
  const {id} = await response.json() as {id:string};
  expect(response.status).toBe(201);
  expect((await call(`/groups/${id}`,{purchased_id:'a',ids:['b']},'PATCH')).status).toBe(409);
  expect((await call(`/groups/${id}`,{purchased_id:'p',ids:['a']},'PATCH')).status).toBe(200);
  expect(sqlite.prepare("SELECT status FROM wishes WHERE id='b'").get()?.status).toBe('wanted');
  await call(`/groups/${id}`,{},'DELETE');
  expect(sqlite.prepare('SELECT COUNT(*) AS n FROM wishes').get()?.n).toBe(5);
  expect(sqlite.prepare('SELECT COUNT(*) AS n FROM decision_members').get()?.n).toBe(0);
});
it('모든 기획 경로는 익명 접근을 거절하고 공개 위시에는 사용 기록이 없다', async () => {
  const env = { DB:db } as Env;
  for (const path of ['', '/month','/bulk','/experiences/p','/groups']) {
    const response = await worker.fetch(new Request(`https://example.com/api/admin/planning${path}`),env,{} as ExecutionContext);
    expect(response.status).toBe(401);
  }
  await call('/experiences/p',{rating:5,usage:'using',note:'관리자 전용 후기'});
  const response = await worker.fetch(new Request('https://example.com/api/wishes'),env,{} as ExecutionContext);
  const text = await response.text();
  expect(response.status).toBe(200); expect(text).not.toContain('관리자 전용 후기'); expect(text).not.toContain('wish_experiences');
});
it('합계는 한국 시간 구매 월을 사용하고 선물·외화·가격 미정을 분리한다', () => {
  const base: PlanningWish = {id:'a',title:'후보',status:'wanted',price:150000,currency:'KRW',planned_month:null,purchased_at:null,purchase_price:null,purchase_method:'self',priority:2};
  const bought = {...base,id:'p',status:'purchased' as const,purchase_price:100000,purchased_at:'2026-09-30T15:00:00Z'};
  expect(simulation([base,bought],['a'],'2026-10',300000)).toMatchObject({spend:100000,planned:150000,remaining:50000});
  const report = simulation([base,bought,{...bought,id:'gift',purchase_method:'gift'},{...base,id:'usd',currency:'USD'},{...base,id:'missing',price:null}],['a','usd','missing'],'2026-10',0);
  expect(report).toMatchObject({spend:100000,planned:150000,remaining:-250000,missing:1,foreign:1});
  expect(simulation([],[],'2026-10').remaining).toBeNull();
  expect(experienceDue({...bought,purchased_at:null},undefined)).toBe(false);
  expect(experienceDue({...bought,purchased_at:'2026-09-01'},undefined,Date.parse('2026-10-26'))).toBe(true);
  expect(experienceDue({...bought,purchased_at:'2026-09-01'},{wish_id:'p',rating:null,usage:null,note:'',remind_after:'2026-11-01'},Date.parse('2026-10-26'))).toBe(false);
});
it('관리자 JSON 백업·복원에 사용 기록과 묶음을 포함하고 구버전 백업도 처리한다', async () => {
  const pair = await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
  const jwk = {...await crypto.subtle.exportKey('jwk',pair.publicKey),kid:'planning-test',alg:'RS256'};
  vi.stubGlobal('fetch',vi.fn(async () => Response.json({keys:[jwk]})));
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const unsigned = `${encode({alg:'RS256',kid:'planning-test'})}.${encode({iss:'https://planning-test.cloudflareaccess.com',aud:['planning-test'],exp:Math.floor(Date.now()/1000)+300})}`;
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5',pair.privateKey,new TextEncoder().encode(unsigned));
  const headers = {'cf-access-jwt-assertion':`${unsigned}.${Buffer.from(signature).toString('base64url')}`,'content-type':'application/json'};
  const env = {DB:db,ACCESS_TEAM_DOMAIN:'planning-test',ACCESS_AUD:'planning-test'} as unknown as Env;
  const ctx = {} as ExecutionContext;
  await call('/experiences/p',{rating:4,usage:'using',note:'백업할 기록'});
  await call('/groups',{name:'비교 후보',ids:['a','b']},'POST');
  const exported = await worker.fetch(new Request('https://example.com/api/export',{headers}),env,ctx);
  expect(exported.status).toBe(200);
  const backup = await exported.json() as Record<string,unknown>;
  expect(backup.wish_experiences).toEqual([expect.objectContaining({rating:4,note:'백업할 기록'})]);
  sqlite.exec('DELETE FROM wish_experiences; DELETE FROM decision_members; DELETE FROM decision_groups;');
  const imported = await worker.fetch(new Request('https://example.com/api/import',{method:'POST',headers,body:JSON.stringify(backup)}),env,ctx);
  expect(imported.status).toBe(200);
  expect(sqlite.prepare('SELECT note FROM wish_experiences').get()?.note).toBe('백업할 기록');
  expect(sqlite.prepare('SELECT COUNT(*) AS n FROM decision_members').get()?.n).toBe(2);
  const old = { ...backup }; delete old.wish_experiences; delete old.decision_groups; delete old.decision_members;
  const legacy = await worker.fetch(new Request('https://example.com/api/import',{method:'POST',headers,body:JSON.stringify(old)}),env,ctx);
  expect(legacy.status).toBe(200);
});
