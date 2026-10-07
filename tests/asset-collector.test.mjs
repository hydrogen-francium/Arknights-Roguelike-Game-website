import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { decodeLinks, originalImageUrl, extractLinks, parseRobots, robotsAllows, createRequester, validateConfig, galleryMarkup, collectAssets } from '../tools/asset-collector.mjs';

/** 核对页面实体和内嵌配置的链接转义，不执行输入中的任何脚本。 */
test('采集器解码 HTML 实体与 JSON 链接转义', () => {
  assert.equal(decodeLinks(String.raw`https:\/\/example.com\/图\u7247.png?a=1&amp;b=2`), 'https://example.com/图片.png?a=1&b=2');
  assert.equal(decodeLinks('&#x56FE;&#29255;&quot;&apos;'), '图片"\'');
});

/** 原图转换只应用于已核对的图床，不根据其他站点的路径猜测原图。 */
test('PRTS 缩略图和参考页压缩图还原为原图', () => {
  assert.equal(originalImageUrl('https://media.prts.wiki/thumb/d/d0/主题图.png/800px-主题图.png?v=123', 'https://prts.wiki'), 'https://media.prts.wiki/d/d0/%E4%B8%BB%E9%A2%98%E5%9B%BE.png');
  assert.equal(originalImageUrl('//i0.hdslb.com/bfs/image.png@2e_90q.webp', 'https://live.bilibili.com'), 'https://i0.hdslb.com/bfs/image.png');
  assert.equal(originalImageUrl('https://other.example.com/image.png@small', 'https://other.example.com'), 'https://other.example.com/image.png@small');
});

/** 覆盖背景样式、图片属性和配置链接，同时检查域名白名单与原图级去重。 */
test('从页面、内嵌配置及样式发现图片，不追踪无关域名', () => {
  const html = String.raw`<img src="//i0.hdslb.com/bfs/a.png@2e_90q.webp"><script>{"image":"https:\/\/i0.hdslb.com\/bfs\/a.png"}</script><div style="background:url(/b.png)"></div><link href="/theme.css"><img src="https://unrelated.example.com/c.png">`;
  const result = extractLinks(html, 'https://i0.hdslb.com/page', ['i0.hdslb.com']);
  assert.deepEqual(result.images, ['https://i0.hdslb.com/bfs/a.png', 'https://i0.hdslb.com/b.png']);
  assert.deepEqual(result.styles, ['https://i0.hdslb.com/theme.css']);
});

/** 检查最长路径、允许优先、通配符与终止符，避免把禁止路径下载到本地。 */
test('抓取规则按访问组与最长路径匹配', () => {
  const groups = parseRobots('User-agent: *\nDisallow: /private/\nAllow: /private/public/\nDisallow: /*.json$\n');
  assert.equal(robotsAllows(groups, new URL('https://example.com/private/file.png')), false);
  assert.equal(robotsAllows(groups, new URL('https://example.com/private/public/file.png')), true);
  assert.equal(robotsAllows(groups, new URL('https://example.com/list.json')), false);
  assert.equal(robotsAllows(groups, new URL('https://example.com/list.json?x=1')), true);
  const specific = parseRobots('User-agent: *\nDisallow: /\nUser-agent: CockroachCupAssetCollector\nAllow: /\n');
  assert.equal(robotsAllows(specific, new URL('https://example.com/image.png')), true);
});

/** 配置中的范围和请求间隔必须显式合法，不能静默修正非法输入。 */
test('默认采集配置有效，非法限速与页面域名立即报错', async () => {
  const config = JSON.parse(await readFile(new URL('../tools/asset-sources.json', import.meta.url), 'utf8'));
  validateConfig(config);
  assert.throws(() => validateConfig({ ...config, delayMs: 999 }), /间隔/);
  assert.throws(() => validateConfig({ ...config, maxAssets: '350' }), /正整数/);
  const invalid = structuredClone(config);
  invalid.sources[0].pages = ['https://unrelated.example.com/page'];
  assert.throws(() => validateConfig(invalid), /hosts/);
});

/** 验证候选预览仅引用本地图片且转义远程名称，避免将远程脚本带进离线页面。 */
test('离线预览保留来源并转义远程文本', () => {
  const html = galleryMarkup({ sources: [], assets: [{ sha256: 'abc', name: '</script><script>alert(1)</script>.png', file: 'images/abc.png', category: '待筛选', bytes: 1024, existingFiles: [], sources: [{ id: 'test', name: '测试', page: 'https://example.com/page' }] }] });
  assert.match(html, /src="images\/abc.png"/);
  assert.match(html, /loading="lazy"/);
  assert.match(html, /\\u003c\/script>/);
  assert.doesNotMatch(html, /<script>alert\(1\)/);
});

/** 使用本地 HTTP 服务核对实际请求链路，禁止访问、限流和跨域均显式失败且不自动重试。 */
test('请求器遵守抓取规则、域名和 HTTP 错误', async t => {
  const hits = new Map();
  const server = createServer((request, response) => {
    hits.set(request.url, (hits.get(request.url) || 0) + 1);
    if (request.url === '/robots.txt') { response.end('User-agent: *\nDisallow: /blocked\n'); return; }
    if (request.url === '/limited') { response.writeHead(429); response.end(); return; }
    if (request.url === '/redirect') { response.writeHead(302, { location: 'http://localhost/other.png' }); response.end(); return; }
    response.end('公开内容');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(done => server.close(done)));
  const base = 'http://127.0.0.1:' + server.address().port;
  const request = createRequester(['127.0.0.1'], 0, 3000);
  assert.equal(await (await request(base + '/allowed')).text(), '公开内容');
  await assert.rejects(() => request(base + '/blocked'), /禁止/);
  assert.equal(hits.has('/blocked'), false);
  await assert.rejects(() => request(base + '/limited'), /429/);
  assert.equal(hits.get('/limited'), 1);
  await assert.rejects(() => request(base + '/redirect'), /未授权/);
});

/** 页面中的正则语法与文件说明页不是图片，不能仅凭双斜杠或扩展名判定下载地址。 */
test('排除脚本正则片段和 Wiki 文件说明页面', () => {
  const html = `<script>const pattern = /https?:\\/\\/[^ ]+/;</script><a href="https://prts.wiki/w/文件:example.png">说明页</a><img src="https://media.prts.wiki/a/ab/example.png">`;
  assert.deepEqual(extractLinks(html, 'https://prts.wiki/w/活动', ['prts.wiki', 'media.prts.wiki']).images, ['https://media.prts.wiki/a/ab/example.png']);
});

/** 在创建文件和发出网络请求之前拒绝官网目录，包括 Windows 的大小写等价路径。 */
test('候选输出不能进入公开官网目录', async () => {
  const config = JSON.parse(await readFile(new URL('../tools/asset-sources.json', import.meta.url), 'utf8'));
  const project = fileURLToPath(new URL('../', import.meta.url));
  await assert.rejects(() => collectAssets(config, project), /不得位于/);
  // Windows 忽略路径大小写；其他平台的大小写路径不保证属于同一目录。
  if (process.platform === 'win32') await assert.rejects(() => collectAssets(config, project.toLowerCase()), /不得位于/);
});
