import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, mkdir, copyFile, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sixStarOperators } from '../six-star-operators.js';
import { getSixStarOperator, validateEliteExplorer, projectEliteExplorer } from '../elite-explorers.js';
import { getScoreComponents } from '../scoring.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const operator = sixStarOperators[0];

/** 生成指定干员与独立赛段状态的测试队伍；每次返回新对象，避免用例互相污染。 */
function createTeam(published = true) {
  return { id: 'test-team', eliteExplorer: { operatorId: operator.id, avatar: '', published }, players: [{ id: 'test-player', eliteExplorerUsage: { prelim: true, final: false } }] };
}

/** 核对固定目录不会因为重复编号或重名而造成后台选择歧义。 */
test('六星目录编号与名称唯一，且包含机械师', () => {
  assert.equal(new Set(sixStarOperators.map(item => item.id)).size, sixStarOperators.length);
  assert.equal(new Set(sixStarOperators.map(item => item.name)).size, sixStarOperators.length);
  assert.equal(getSixStarOperator('char_4230_mcnist').name, '机械师');
  assert.throws(() => getSixStarOperator('不存在的干员'), /六星/);
});

/** 未录入指定是合法状态，不应自动制造指定或未使用记录。 */
test('未指定与未登记允许保存', () => {
  validateEliteExplorer({ players: [{}] });
  validateEliteExplorer({ eliteExplorer: null, players: [{ eliteExplorerUsage: { prelim: null, final: null } }] });
  const team = createTeam();
  team.players[0].eliteExplorerUsage.prelim = null;
  validateEliteExplorer(team);
});

/** 拒绝伪造干员、非法状态与未指定却已使用的记录，保持输入契约明确。 */
test('非法指定和使用状态立即报错', () => {
  const team = createTeam();
  team.eliteExplorer.operatorId = 'invalid';
  assert.throws(() => validateEliteExplorer(team), /六星/);
  team.eliteExplorer.operatorId = operator.id;
  team.eliteExplorer.published = 'true';
  assert.throws(() => validateEliteExplorer(team), /公布状态/);
  team.eliteExplorer.published = true;
  team.players[0].eliteExplorerUsage.final = 'false';
  assert.throws(() => validateEliteExplorer(team), /使用状态/);
  team.players[0].eliteExplorerUsage.final = false;
  team.eliteExplorer = null;
  assert.throws(() => validateEliteExplorer(team), /未指定/);
});

/** 未公布内容必须在服务器投影时剔除，不能仅依赖浏览器隐藏。 */
test('未公布指定与使用记录不进入公开投影', () => {
  const team = createTeam(false);
  const original = structuredClone(team);
  const result = projectEliteExplorer(team);
  assert.equal(result.eliteExplorer, null);
  assert.equal(Object.hasOwn(result.players[0], 'eliteExplorerUsage'), false);
  assert.deepEqual(team, original);
});

/** 两赛段共享一个整届指定，但使用状态分别保留，不互相覆盖。 */
test('公布后两赛段共享指定且保留独立使用记录', () => {
  const result = projectEliteExplorer(createTeam());
  assert.equal(result.eliteExplorer.name, operator.name);
  assert.deepEqual(result.players[0].eliteExplorerUsage, { prelim: true, final: false });
});

/** 精英探索者属于使用次数规则，不能污染现有基础分、倍率和加减分。 */
test('指定与使用状态不改变任何赛段计分', async () => {
  const state = JSON.parse(await readFile(join(root, 'data/competition.json'), 'utf8'));
  const player = state.teams[0].players[0];
  const withUsage = { ...player, eliteExplorerUsage: { prelim: true, final: false } };
  assert.deepEqual(getScoreComponents(withUsage, 'prelim'), getScoreComponents(player, 'prelim'));
  assert.deepEqual(getScoreComponents(withUsage, 'final'), getScoreComponents(player, 'final'));
});

/** 用临时独立目录验证真实登录、保存、公开投影及图标响应，不写入实际赛事数据。 */
test('服务端完整保存、公布与图标链路', { timeout: 15000 }, async t => {
  const workspace = await mkdtemp(join(tmpdir(), 'cockroach-elite-test-'));
  let child;
  /** 清理仅限本用例创建的临时目录；先核对路径边界再移除，且终止测试服务。 */
  t.after(async () => {
    if (child && child.exitCode === null) {
      const exited = once(child, 'exit');
      child.kill();
      await exited;
    }
    assert.equal(dirname(resolve(workspace)), resolve(tmpdir()));
    assert.ok(basename(workspace).startsWith('cockroach-elite-test-'));
    await rm(workspace, { recursive: true });
  });
  for (const file of ['package.json', 'server.mjs', 'scoring.js', 'elite-explorers.js', 'six-star-operators.js', 'favicon.svg', 'index.html', 'admin.html']) await copyFile(join(root, file), join(workspace, file));
  await mkdir(join(workspace, 'data'));
  const state = JSON.parse(await readFile(join(root, 'data/competition.json'), 'utf8'));
  const baseline = state.teams[0].players.map(player => ({ prelim: getScoreComponents(player, 'prelim'), final: getScoreComponents(player, 'final') }));
  state.teams[0].eliteExplorer = { operatorId: operator.id, avatar: '', published: false };
  for (const player of state.teams[0].players) player.eliteExplorerUsage = { prelim: true, final: false };
  await writeFile(join(workspace, 'data/competition.json'), JSON.stringify(state), 'utf8');
  const reservation = createServer();
  reservation.listen(0, '127.0.0.1');
  await once(reservation, 'listening');
  const port = reservation.address().port;
  await new Promise(done => reservation.close(done));
  const origin = 'http://127.0.0.1:' + port;
  child = spawn(process.execPath, [join(workspace, 'server.mjs')], { env: { ...process.env, PORT: String(port), ADMIN_USERNAME: 'test-admin', ADMIN_PASSWORD: 'temporary-test-password-2026', COOKIE_SECURE: 'false' }, stdio: ['ignore', 'pipe', 'pipe'] });
  await once(child.stdout, 'data');
  const login = await fetch(origin + '/api/session', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ username: 'test-admin', password: 'temporary-test-password-2026' }) });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const hidden = await (await fetch(origin + '/api/public/ranking')).json();
  assert.equal(hidden.content.teams[0].eliteExplorer, null);
  assert.equal(Object.hasOwn(hidden.content.teams[0].players[0], 'eliteExplorerUsage'), false);
  state.teams[0].eliteExplorer.published = true;
  const saved = await fetch(origin + '/api/admin/competition', { method: 'PUT', headers: { origin, cookie, 'content-type': 'application/json' }, body: JSON.stringify(state) });
  assert.equal(saved.status, 200);
  const persisted = await (await fetch(origin + '/api/admin/competition', { headers: { cookie } })).json();
  assert.deepEqual(persisted.teams[0].eliteExplorer, state.teams[0].eliteExplorer);
  const ranking = await (await fetch(origin + '/api/public/ranking')).json();
  assert.equal(ranking.content.teams[0].eliteExplorer.name, operator.name);
  assert.deepEqual(ranking.content.teams[0].players.map(player => player.computedScores), baseline);
  const schedule = await (await fetch(origin + '/api/public/schedule')).json();
  assert.equal(schedule.content.teams[0].eliteExplorer.operatorId, operator.id);
  assert.deepEqual(schedule.content.teams[0].players[0].eliteExplorerUsage, { prelim: true, final: false });
  const icon = await fetch(origin + '/favicon.svg?v=test');
  assert.equal(icon.status, 200);
  assert.equal(icon.headers.get('content-type'), 'image/svg+xml');
  assert.match(await icon.text(), /<svg/);
  state.teams[0].eliteExplorer = null;
  const invalid = await fetch(origin + '/api/admin/competition', { method: 'PUT', headers: { origin, cookie, 'content-type': 'application/json' }, body: JSON.stringify(state) });
  assert.equal(invalid.status, 500);
  assert.match((await invalid.json()).error, /未指定/);
  assert.equal(JSON.parse(await readFile(join(workspace, 'data/competition.json'), 'utf8')).teams[0].eliteExplorer.operatorId, operator.id);
});
