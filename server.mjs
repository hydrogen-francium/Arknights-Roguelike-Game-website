import { createServer } from 'node:http';
import { randomBytes, randomUUID, timingSafeEqual, createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import { basename, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { calculatePlayerScore, getScoreComponents } from './scoring.js';

const rootDir = resolve(fileURLToPath(new URL('.', import.meta.url)));
const dataFile = join(rootDir, 'data', 'competition.json');
const backupDir = join(rootDir, 'backups');
const assetDir = join(rootDir, '素材', '上传');
const port = Number(process.env.PORT || 3100);
const adminUsername = process.env.ADMIN_USERNAME || '';
const adminPassword = process.env.ADMIN_PASSWORD || '';
const cookieSecure = process.env.COOKIE_SECURE === 'true';
const sessionDurationMs = 12 * 60 * 60 * 1000;
const sessions = new Map();
const loginAttempts = new Map();
const contentTypes = { '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8', '.gif': 'image/gif', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.mp3': 'audio/mpeg', '.png': 'image/png', '.webp': 'image/webp' };

if (adminUsername.length < 3 || adminPassword.length < 16 || adminPassword === 'REPLACE_WITH_LONG_RANDOM_SECRET') throw new Error('必须设置 ADMIN_USERNAME，并将 ADMIN_PASSWORD 设置为至少 16 位的非默认强密码');

/** 读取赛事状态并解析 JSON；文件损坏时将解析错误直接交由调用方处理。 */
async function readCompetition() {
  return JSON.parse(await readFile(dataFile, 'utf8'));
}

/** 为比赛成绩添加由服务端规则引擎生成的初赛与决赛权威得分。 */
function attachComputedScores(state) {
  return state.teams.map(team => ({ ...team, players: team.players.map(player => ({ ...player, computedScores: { prelim: getScoreComponents(player, 'prelim'), final: getScoreComponents(player, 'final') } })) }));
}

/** 按页面发布状态构造最小公开数据，避免未发布内容进入浏览器响应。 */
function publicPagePayload(state, page) {
  if (!['home', 'rules', 'schedule', 'ranking'].includes(page)) return null;
  const pages = state.pages;
  if (!pages[page]) return { pages, content: null };
  if (page === 'home') return { pages, content: { event: state.event } };
  if (page === 'rules') return { pages, content: { rules: state.rules } };
  const teams = attachComputedScores(state);
  if (page === 'ranking') return { pages, content: { teams } };
  const days = [...state.schedule.prelim, ...state.schedule.final];
  const scheduledIds = new Set(days.flatMap(day => day.playerIds));
  return { pages, content: { schedule: state.schedule, teams: teams.map(team => ({ ...team, players: team.players.filter(player => scheduledIds.has(player.id)) })) } };
}

/** 校验后台提交的赛事数据及全部用于服务端计分的字段。 */
function validateCompetitionState(state) {
  if (!state || typeof state !== 'object' || !state.event || !state.rules || !state.schedule || !Array.isArray(state.teams)) throw new Error('赛事状态结构无效');
  if (!state.pages || ['home', 'rules', 'schedule', 'ranking'].some(key => typeof state.pages[key] !== 'boolean')) throw new Error('四个页面都必须明确设置发布或筹备状态');
  if (!Array.isArray(state.rules.sections) || !Array.isArray(state.schedule.prelim) || !Array.isArray(state.schedule.final)) throw new Error('规则或赛程结构无效');
  if (state.teams.some(team => !team || typeof team !== 'object' || !Array.isArray(team.players))) throw new Error('队伍必须包含选手数组');
  const playerIds = state.teams.flatMap(team => team.players.map(player => player.id));
  if (playerIds.some(id => typeof id !== 'string' || !id) || new Set(playerIds).size !== playerIds.length) throw new Error('选手编号必须存在且不能重复');
  if (state.schedule.prelim.concat(state.schedule.final).some(day => !Array.isArray(day.playerIds) || day.playerIds.some(id => !playerIds.includes(id)))) throw new Error('日程引用了不存在的选手编号');
  for (const team of state.teams) for (const player of team.players) {
    if (!Number.isFinite(player.prelim) || player.prelim < 0 || !Number.isFinite(player.final) || player.final < 0) throw new Error(`选手 ${player.name} 的结算分必须是非负有限数值`);
    if (!Array.isArray(player.endings) || !Array.isArray(player.scoreItems) || !Array.isArray(player.deductions)) throw new Error(`选手 ${player.name} 的结局和积分项目必须是数组`);
    for (const item of [...player.scoreItems, ...player.deductions]) if (!Number.isFinite(item.points) || typeof item.category !== 'string' || typeof item.rule !== 'string') throw new Error(`选手 ${player.name} 存在无效的积分项目`);
    calculatePlayerScore(player, 'prelim');
    calculatePlayerScore(player, 'final');
  }
}

/** 保存旧赛事 JSON 快照并原子替换当前文件，副作用是写入数据与备份目录。 */
async function writeCompetition(state) {
  validateCompetitionState(state);
  const previous = await readFile(dataFile);
  await mkdir(backupDir, { recursive: true });
  await writeFile(join(backupDir, `competition-${new Date().toISOString().replaceAll(':', '-')}-${randomUUID().slice(0, 8)}.json`), previous);
  const backups = (await readdir(backupDir)).filter(name => name.startsWith('competition-') && name.endsWith('.json')).sort().reverse();
  for (const oldBackup of backups.slice(30)) await unlink(join(backupDir, oldBackup));
  const temporaryFile = `${dataFile}.${randomUUID()}.tmp`;
  await writeFile(temporaryFile, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  await rename(temporaryFile, dataFile);
}

/** 统一发送 JSON 响应并声明 UTF-8 编码。 */
function sendJson(response, statusCode, payload, headers = {}) {
  response.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers });
  response.end(JSON.stringify(payload));
}

/** 读取有大小上限的 JSON 请求体，超限时拒绝解析。 */
async function readJsonBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 2 * 1024 * 1024) throw Object.assign(new Error('JSON 请求不能超过 2 MiB'), { statusCode: 413 });
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

/** 读取不超过 10 MiB 的图片请求体。 */
async function readBinaryBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 10 * 1024 * 1024) throw Object.assign(new Error('图片不能超过 10 MiB'), { statusCode: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/** 对比登录凭据的摘要，避免因长度不同而泄露直接比较时序。 */
function secureTextEqual(left, right) {
  return timingSafeEqual(createHash('sha256').update(left).digest(), createHash('sha256').update(right).digest());
}

/** 从 Cookie 中读取会话并清理过期状态；返回有效会话编号或空值。 */
function getSession(request) {
  const token = (request.headers.cookie || '').split(';').map(item => item.trim()).find(item => item.startsWith('cc_session='))?.slice('cc_session='.length);
  const session = token ? sessions.get(token) : null;
  if (!session || session.expiresAt <= Date.now()) {
    if (token) sessions.delete(token);
    return null;
  }
  return token;
}

/** 限制登录失敗重试速率，避免公开后台被无限次猜测密码。 */
function loginIsLimited(ip) {
  const attempts = loginAttempts.get(ip) || [];
  const active = attempts.filter(time => time > Date.now() - 15 * 60 * 1000);
  loginAttempts.set(ip, active);
  return active.length >= 8;
}

/** 记录一次失败登录的客户端来源。 */
function recordFailedLogin(ip) {
  loginAttempts.set(ip, [...(loginAttempts.get(ip) || []), Date.now()]);
}

/** 验证浏览器写请求来源与主机一致，以拒绝跨站伪造后台操作。 */
function assertSameOrigin(request) {
  const origin = request.headers.origin;
  if (!origin || new URL(origin).host !== request.headers.host) throw Object.assign(new Error('后台写请求必须来自本站'), { statusCode: 403 });
}

/** 保存并返回随机命名的图片素材，文件名不会覆盖已有上传。 */
async function writeAsset(request, filename) {
  const extension = extname(basename(filename)).toLowerCase();
  if (!['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(extension)) throw new Error('只允许上传 png、jpg、jpeg、webp 或 gif 图片');
  const body = await readBinaryBody(request);
  if (!body.length) throw new Error('不能上传空文件');
  const signatures = { '.png': body.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), '.jpg': body[0] === 255 && body[1] === 216, '.jpeg': body[0] === 255 && body[1] === 216, '.gif': body.subarray(0, 3).toString() === 'GIF', '.webp': body.subarray(0, 4).toString() === 'RIFF' && body.subarray(8, 12).toString() === 'WEBP' };
  if (!signatures[extension]) throw new Error('文件扩展名与图片内容不匹配');
  await mkdir(assetDir, { recursive: true });
  const safeName = `${randomUUID()}${extension}`;
  await writeFile(join(assetDir, safeName), body);
  return `素材/上传/${safeName}`;
}

/** 读取项目静态文件；路径解析结果不得越过项目根目录。 */
async function sendStaticFile(response, pathname) {
  const relativePath = pathname === '/' ? 'index.html' : pathname.slice(1);
  const filePath = resolve(rootDir, normalize(relativePath));
  if (filePath !== rootDir && !filePath.startsWith(`${rootDir}${sep}`)) return sendJson(response, 403, { error: '禁止访问项目目录之外的文件' });
  const body = await readFile(filePath);
  const extension = extname(filePath).toLowerCase();
  const cacheControl = ['.html', '.js', '.css', '.json'].includes(extension) ? 'no-store' : 'public, max-age=604800';
  response.writeHead(200, { 'content-type': contentTypes[extension] || 'application/octet-stream', 'cache-control': cacheControl });
  response.end(body);
}

/** 处理登录、按页公开数据、后台写入与静态文件请求。 */
async function handleRequest(request, response) {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const pathname = decodeURIComponent(url.pathname);
  const token = getSession(request);
  if (pathname === '/health') return sendJson(response, 200, { ok: true });
  if (pathname === '/api/session' && request.method === 'GET') return sendJson(response, 200, { authenticated: Boolean(token) });
  if (pathname === '/api/session' && request.method === 'POST') {
    assertSameOrigin(request);
    const ip = request.socket.remoteAddress || 'unknown';
    if (loginIsLimited(ip)) return sendJson(response, 429, { error: '登录失败次数过多，请 15 分钟后重试' });
    const credentials = await readJsonBody(request);
    if (!secureTextEqual(String(credentials.username || ''), adminUsername) || !secureTextEqual(String(credentials.password || ''), adminPassword)) {
      recordFailedLogin(ip);
      return sendJson(response, 401, { error: '用户名或密码错误' });
    }
    const newToken = randomBytes(32).toString('hex');
    sessions.set(newToken, { expiresAt: Date.now() + sessionDurationMs });
    loginAttempts.delete(ip);
    const secure = cookieSecure ? '; Secure' : '';
    return sendJson(response, 200, { authenticated: true }, { 'set-cookie': `cc_session=${newToken}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${secure}` });
  }
  if (pathname === '/api/session' && request.method === 'DELETE') {
    assertSameOrigin(request);
    if (token) sessions.delete(token);
    return sendJson(response, 200, { authenticated: false }, { 'set-cookie': 'cc_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' });
  }
  if (pathname.startsWith('/api/public/')) {
    const payload = publicPagePayload(await readCompetition(), pathname.slice('/api/public/'.length));
    return payload ? sendJson(response, 200, payload) : sendJson(response, 404, { error: '页面不存在' });
  }
  if (pathname.startsWith('/api/admin/')) {
    if (!token) return sendJson(response, 401, { error: '需要登录后台' });
    if (request.method !== 'GET') assertSameOrigin(request);
    if (pathname === '/api/admin/competition' && request.method === 'GET') return sendJson(response, 200, await readCompetition());
    if (pathname === '/api/admin/competition' && request.method === 'PUT') {
      await writeCompetition(await readJsonBody(request));
      return sendJson(response, 200, { ok: true });
    }
  }
  if (pathname === '/api/assets' && request.method === 'PUT') {
    if (!token) return sendJson(response, 401, { error: '需要登录后台' });
    assertSameOrigin(request);
    const assetPath = await writeAsset(request, url.searchParams.get('name') || '');
    return sendJson(response, 200, { ok: true, path: assetPath });
  }
  if (pathname === '/admin') return sendStaticFile(response, '/admin.html');
  return sendStaticFile(response, pathname);
}

/** 启动赛事官网；后台凭据不完整时进程在监听端口前立即失败。 */
createServer((request, response) => {
  handleRequest(request, response).catch(error => {
    if (!response.headersSent) sendJson(response, error.statusCode || 500, { error: error.message });
  });
}).listen(port, '0.0.0.0', () => {
  console.log(`蟑螂杯#3官网已启动：http://localhost:${port}`);
  console.log(`后台编辑入口：http://localhost:${port}/admin`);
});
