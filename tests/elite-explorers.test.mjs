import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, mkdir, copyFile, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { sixStarOperators } from '../six-star-operators.js';
import { getSixStarOperator, validateEliteExplorer, projectEliteExplorer } from '../elite-explorers.js';
import { getScoreComponents } from '../scoring.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const operator = sixStarOperators[0];

/** 生成仅包含整届固定指定的测试队伍；每次返回新对象，避免用例互相污染。 */
function createTeam(published = true) {
  return { id: 'test-team', eliteExplorer: { operatorId: operator.id, avatar: '', published }, players: [{ id: 'test-player' }] };
}

/** 提取有文档注释分隔的顶层函数，供模板测试执行实际前端实现，而不是重复模板逻辑。 */
function functionSource(source, name) {
  const start = source.indexOf('function ' + name + '(');
  const end = source.indexOf('\n/**', start);
  assert.ok(start >= 0 && end > start, '前端函数未找到：' + name);
  return source.slice(start, end);
}

/** 核对固定目录不会因为重复编号或重名而造成后台选择歧义。 */
test('干员目录编号与名称唯一，且包含机械师', () => {
  assert.equal(new Set(sixStarOperators.map(item => item.id)).size, sixStarOperators.length);
  assert.equal(new Set(sixStarOperators.map(item => item.name)).size, sixStarOperators.length);
  assert.equal(getSixStarOperator('char_4230_mcnist').name, '机械师');
  assert.throws(() => getSixStarOperator('不存在的干员'), /目录/);
});

/** 未录入指定是合法筹备状态，不应自动制造干员选择。 */
test('未指定允许保存，已指定只校验队伍字段', () => {
  validateEliteExplorer({ players: [{}] });
  validateEliteExplorer({ eliteExplorer: null, players: [{}] });
  validateEliteExplorer(createTeam());
});

/** 拒绝伪造干员和非法字段类型，保持输入契约明确。 */
test('非法指定立即报错', () => {
  const team = createTeam();
  team.eliteExplorer.operatorId = 'invalid';
  assert.throws(() => validateEliteExplorer(team), /目录/);
  team.eliteExplorer.operatorId = operator.id;
  team.eliteExplorer.published = 'true';
  assert.throws(() => validateEliteExplorer(team), /公布状态/);
  team.eliteExplorer.published = true;
  team.eliteExplorer.avatar = 1;
  assert.throws(() => validateEliteExplorer(team), /头像路径/);
  team.eliteExplorer = [];
  assert.throws(() => validateEliteExplorer(team), /对象或空值/);
});

/** 未公布内容必须在服务器投影时剔除，不能仅依赖浏览器隐藏。 */
test('未公布指定不进入公开投影，原始数据不变', () => {
  const team = createTeam(false);
  const original = structuredClone(team);
  const result = projectEliteExplorer(team);
  assert.equal(result.eliteExplorer, null);
  assert.deepEqual(result.players, team.players);
  assert.deepEqual(team, original);
});

/** 公布后仅派生目录名称，选手对象无需任何额外规则字段。 */
test('公布后展示整届指定，不新增逐局使用数据', () => {
  const team = createTeam();
  const original = structuredClone(team);
  const result = projectEliteExplorer(team);
  assert.equal(result.eliteExplorer.name, operator.name);
  assert.deepEqual(result.players, [{ id: 'test-player' }]);
  assert.deepEqual(team, original);
});

/** 指定仅属于队伍信息，不改变选手基础分、倍率和加减分。 */
test('队伍指定不改变任何赛段计分', async () => {
  const state = JSON.parse(await readFile(join(root, 'data/competition.json'), 'utf8'));
  const team = state.teams[0];
  const baseline = team.players.map(player => ({ prelim: getScoreComponents(player, 'prelim'), final: getScoreComponents(player, 'final') }));
  team.eliteExplorer = createTeam().eliteExplorer;
  assert.deepEqual(projectEliteExplorer(team).players.map(player => ({ prelim: getScoreComponents(player, 'prelim'), final: getScoreComponents(player, 'final') })), baseline);
});

/** 执行真实前后台模板，核对只展示选择的干员、移除逐局字段，并保留日程中的队伍指定。 */
test('前后台模板只展示指定干员，不显示星级或逐局使用状态', async () => {
  const site = await readFile(join(root, 'site.js'), 'utf8');
  const admin = await readFile(join(root, 'admin.js'), 'utf8');
  const state = JSON.parse(await readFile(join(root, 'data/competition.json'), 'utf8'));
  const player = state.teams[0].players[0];
  const team = projectEliteExplorer(createTeam());
  const siteFunctions = ['escapeHtml', 'eliteExplorerBadgeMarkup', 'playerMarkup'].map(name => functionSource(site, name)).join('\n');
  const siteContext = { team, player, getScoreComponents, endingAssets: {}, squadAssets: {} };
  const badge = runInNewContext(siteFunctions + '\neliteExplorerBadgeMarkup(team)', siteContext);
  assert.match(badge, /指定干员/);
  assert.ok(badge.includes(operator.name));
  assert.doesNotMatch(badge, /六星|本局|已使用|未使用|未登记/);
  assert.equal(runInNewContext(siteFunctions + '\neliteExplorerBadgeMarkup({})', siteContext), '');
  const schedule = runInNewContext(siteFunctions + "\nplayerMarkup(player, team, 'prelim')", siteContext);
  assert.ok(schedule.includes(badge));
  assert.doesNotMatch(schedule, /队伍规则状态|本局使用/);
  const adminFunctions = ['escapeHtml', 'eliteExplorerEditorMarkup', 'playerMarkup'].map(name => functionSource(admin, name)).join('\n');
  const markup = runInNewContext(adminFunctions + '\neliteExplorerEditorMarkup(team, 0) + playerMarkup(player, 0, 0)', { team, player, sixStarOperators, stringifyScoreItems: () => '' });
  assert.match(markup, /指定干员 · 整届赛事固定/);
  assert.doesNotMatch(markup, /六星|eliteUsage|使用记录|使用精英探索者/);
  assert.doesNotMatch(admin, /eliteExplorerUsage|eliteUsage/);
  assert.doesNotMatch(site, /eliteExplorerRuleMarkup|eliteExplorerUsage/);
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
  assert.equal(Object.hasOwn(schedule.content.teams[0].players[0], 'eliteExplorerUsage'), false);
  const icon = await fetch(origin + '/favicon.svg?v=test');
  assert.equal(icon.status, 200);
  assert.equal(icon.headers.get('content-type'), 'image/svg+xml');
  assert.match(await icon.text(), /<svg/);
  state.teams[0].eliteExplorer.operatorId = 'invalid';
  const invalid = await fetch(origin + '/api/admin/competition', { method: 'PUT', headers: { origin, cookie, 'content-type': 'application/json' }, body: JSON.stringify(state) });
  assert.equal(invalid.status, 500);
  assert.match((await invalid.json()).error, /目录/);
  assert.equal(JSON.parse(await readFile(join(workspace, 'data/competition.json'), 'utf8')).teams[0].eliteExplorer.operatorId, operator.id);
});
