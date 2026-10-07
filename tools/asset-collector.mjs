import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile, copyFile } from 'node:fs/promises';
import { resolve, dirname, basename, extname, join, sep, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as pause } from 'node:timers/promises';

const toolDir = dirname(fileURLToPath(import.meta.url));
const projectDir = resolve(toolDir, '..');
const agent = 'CockroachCupAssetCollector/1.0';
const imageTypes = new Map([['image/png', '.png'], ['image/jpeg', '.jpg'], ['image/webp', '.webp'], ['image/gif', '.gif'], ['image/svg+xml', '.svg']]);

/** 解码页面中已确认使用的实体和转义，不执行任何远程脚本，返回可解析的链接文本。 */
export function decodeLinks(text) {
  return text.replace(/\\u([0-9a-f]{4})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\\//g, '/')
    .replace(/&(?:amp|quot|apos|lt|gt);|&#(?:x[0-9a-f]+|[0-9]+);/gi, entity => {
      if (entity.startsWith('&#')) return String.fromCodePoint(parseInt(entity.slice(entity[2].toLowerCase() === 'x' ? 3 : 2, -1), entity[2].toLowerCase() === 'x' ? 16 : 10));
      return { '&amp;': '&', '&quot;': '"', '&apos;': "'", '&lt;': '<', '&gt;': '>' }[entity.toLowerCase()];
    });
}

/** 将已核对的缩略图格式转换为原图地址；只处理指定图床的已知规则，返回绝对链接。 */
export function originalImageUrl(value, base) {
  const url = new URL(value, base);
  if (!['https:', 'http:'].includes(url.protocol)) throw new Error('素材链接只允许 HTTP 或 HTTPS');
  // Wiki 的缩略图路径包含尺寸后缀，原图路径是前三段；格式不匹配时保留原路径。
  if (url.hostname === 'media.prts.wiki' && /^\/thumb\/[a-f0-9]\/[a-f0-9]{2}\/[^/]+\/[^/]+$/.test(url.pathname)) {
    url.pathname = url.pathname.replace(/^\/thumb/, '').slice(0, url.pathname.replace(/^\/thumb/, '').lastIndexOf('/'));
  }
  // 活动图床的 @ 后缀是图片处理指令，采集原图而不是网页的压缩预览。
  if (url.hostname.endsWith('.hdslb.com')) url.pathname = url.pathname.split('@')[0];
  if (url.hostname === 'media.prts.wiki') url.searchParams.delete('v');
  url.hash = '';
  return url.href;
}

/** 从公开页面、内嵌配置和样式提取图像及样式链接；域名白名单限制采集范围，不追踪普通超链接。 */
export function extractLinks(text, base, hosts) {
  const decoded = decodeLinks(text);
  // 页面脚本也包含 // 开头的正则表达式；只匹配具有完整域名的链接，不能把脚本语法当地址。
  const values = [...decoded.matchAll(/(?:https?:)?\/\/(?:[a-z0-9-]+\.)+[a-z0-9-]+(?::[0-9]+)?(?:[/?#][^\s"'<>\\(){};,]*)?/gi)].map(match => match[0]);
  for (const match of decoded.matchAll(/(?:\b(?:src|data-src|href)\s*=\s*["']([^"']+)["']|url\(\s*["']?([^\s"')]+))/gi)) values.push(match[1] || match[2]);
  const images = new Set();
  const styles = new Set();
  for (const value of values) {
    // 内联图片和锚点不需要网络请求，不能当作普通下载地址。
    if (value.startsWith('data:') || value.startsWith('#') || value.startsWith('mw-data:') || value.startsWith('javascript:')) continue;
    const url = new URL(value, base);
    if (!hosts.includes(url.hostname)) continue;
    // Wiki 的 /w/文件:图片.png 是说明页面，真实图片已由页面的 media 图床地址提供。
    if (url.hostname === 'prts.wiki' && url.pathname.startsWith('/w/')) continue;
    const original = originalImageUrl(url.href, base);
    if (/\.(?:png|jpe?g|webp|gif|svg)$/i.test(new URL(original).pathname)) images.add(original);
    if (/\.css$/i.test(url.pathname)) styles.add(url.href);
  }
  return { images: [...images], styles: [...styles] };
}

/** 解析抓取规则中的访问组与路径规则；空禁止项不禁止访问，返回供路径判定使用的规则组。 */
export function parseRobots(text) {
  const groups = [];
  let group = null;
  let hasRules = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.split('#')[0].trim();
    const match = line.match(/^([^:]+):\s*(.*)$/);
    if (!match) continue;
    const key = match[1].trim().toLowerCase();
    const value = match[2].trim();
    if (key === 'user-agent') {
      if (!group || hasRules) { group = { agents: [], rules: [] }; groups.push(group); hasRules = false; }
      group.agents.push(value.toLowerCase());
    } else if (group && ['allow', 'disallow'].includes(key)) {
      hasRules = true;
      if (value) group.rules.push({ allow: key === 'allow', path: value });
    }
  }
  return groups;
}

/** 按最长路径匹配判定本工具是否可访问；同长度时允许项优先，返回布尔值。 */
export function robotsAllows(groups, url) {
  const specific = groups.filter(group => group.agents.includes(agent.split('/')[0].toLowerCase()));
  const active = specific.length ? specific : groups.filter(group => group.agents.includes('*'));
  const path = decodeURI(url.pathname + url.search);
  let best = { length: -1, allow: true };
  for (const group of active) {
    for (const rule of group.rules) {
      const normalized = decodeURI(rule.path);
      const expression = '^' + normalized.split('*').map(part => part.replace(/[.+?^{}()|[\]\\]/g, '\\$&')).join('.*').replace(/\$$/, '$');
      const pattern = new RegExp(expression);
      const length = normalized.replace(/[*$]/g, '').length;
      // 更具体的规则覆盖宽泛规则；同长度允许项覆盖禁止项。
      if (pattern.test(path) && (length > best.length || (length === best.length && rule.allow))) best = { length, allow: rule.allow };
    }
  }
  return best.allow;
}

/** 创建单请求采集器；依次限速、检查域名与抓取规则，禁止自动重试和自动跨域重定向。 */
export function createRequester(hosts, delayMs, timeoutMs) {
  const policies = new Map();
  let lastRequest = 0;
  /** 发送一次已限定域名的请求，等待最低间隔；网络错误直接抛出，不自动重试。 */
  async function raw(url, referer) {
    if (!hosts.includes(url.hostname)) throw new Error('未授权的采集域名：' + url.hostname);
    await pause(Math.max(0, delayMs - (Date.now() - lastRequest)));
    lastRequest = Date.now();
    return fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(timeoutMs), headers: { 'user-agent': agent, ...(referer ? { referer } : {}) } });
  }
  /** 读取公开资源前检查其抓取规则；不存在的规则文件按标准允许，禁止或服务器错误立即报错。 */
  return async function request(value, referer) {
    let url = new URL(value);
    for (let redirects = 0; redirects <= 5; redirects += 1) {
      // 重定向每一跳都重新核对目标域名及策略，不能绕过原始白名单。
      if (!policies.has(url.origin)) {
        const response = await raw(new URL('/robots.txt', url), null);
        if (response.status === 404) policies.set(url.origin, []);
        else {
          if (!response.ok) throw new Error('抓取规则读取失败：HTTP ' + response.status + ' ' + url.origin + '/robots.txt');
          policies.set(url.origin, parseRobots(await response.text()));
        }
      }
      if (!robotsAllows(policies.get(url.origin), url)) throw new Error('抓取规则禁止访问：' + url.href);
      const response = await raw(url, referer);
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location');
        await response.body?.cancel();
        if (!location) throw new Error('重定向响应缺少目标地址：' + url.href);
        url = new URL(location, url);
        continue;
      }
      if (!response.ok) throw new Error('采集失败：HTTP ' + response.status + ' ' + url.href);
      return response;
    }
    throw new Error('重定向超过五次：' + value);
  };
}

/** 按原始文件名分类候选图片，分类只是筛选提示，不替用户决定是否用于官网。 */
export function classifyImage(name) {
  if (/分队/.test(name)) return '分队';
  if (/结局|通关|_complete_/.test(name)) return '结局';
  if (/主题图|背景|background|banner|^Avg_pic_/i.test(name)) return '背景';
  if (/图标|icon/i.test(name)) return '图标';
  if (/事件|藏品|道具|零件|引擎|拟造|层级|节点标记|稀有奖励/.test(name)) return '游戏元素';
  return '待筛选';
}

/** 将配置作为明确的输入契约校验；未知参数或非合法范围直接报错，不修正或静默兜底。 */
export function validateConfig(config) {
  if (!Array.isArray(config.sources) || !config.sources.length) throw new Error('配置必须包含非空 sources 数组');
  for (const source of config.sources) {
    if (!source || typeof source.id !== 'string' || !source.id.trim() || typeof source.name !== 'string' || !source.name.trim() || !Array.isArray(source.pages) || !source.pages.length || source.pages.some(page => typeof page !== 'string') || !Array.isArray(source.hosts) || !source.hosts.length || source.hosts.some(host => typeof host !== 'string' || !/^(?:[a-z0-9-]+\.)+[a-z0-9-]+$/i.test(host))) throw new Error('每个来源必须提供 id、name、pages 和 hosts');
    for (const page of source.pages) {
      const url = new URL(page);
      if (url.protocol !== 'https:' || !source.hosts.includes(url.hostname)) throw new Error('页面必须使用 HTTPS 且在来源 hosts 中：' + page);
    }
  }
  if (new Set(config.sources.map(source => source.id)).size !== config.sources.length) throw new Error('来源编号不能重复');
  for (const key of ['delayMs', 'timeoutMs', 'maxAssets', 'maxFileBytes', 'maxStyles']) {
    if (!Number.isSafeInteger(config[key]) || config[key] <= 0) throw new Error(key + ' 必须是正整数');
  }
  if (config.delayMs < 1000) throw new Error('请求间隔不得少于 1000 毫秒');
}

/** 将输入编码为安全的页面文本，避免远程名称或链接注入候选预览页。 */
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
}

/** 生成可直接双击的静态预览页；数据内嵌且转义，不需要启动服务或向远程图床发起请求。 */
export function galleryMarkup(manifest) {
  const cards = manifest.assets.map(asset => '<article class="card" data-id="' + asset.sha256 + '" data-search="' + escapeHtml(asset.name + ' ' + asset.category + ' ' + asset.sources.map(source => source.name).join(' ')) + '"><div class="preview"><img loading="lazy" decoding="async" src="' + escapeHtml(asset.file) + '" alt="' + escapeHtml(asset.name) + '"></div><div class="info"><label><input type="checkbox" value="' + asset.sha256 + '"><b>' + escapeHtml(asset.name) + '</b></label><p>' + escapeHtml(asset.category) + ' · ' + Math.round(asset.bytes / 1024) + ' KB · <span class="dimensions">等待加载尺寸</span></p><p>' + escapeHtml(asset.sources.map(source => source.name).join(' / ')) + '</p>' + (asset.existingFiles.length ? '<p class="existing">已有相同素材：' + escapeHtml(asset.existingFiles.join('、')) + '</p>' : '') + '<p><a href="' + escapeHtml(asset.file) + '" target="_blank" rel="noopener">打开原图</a> <a href="' + escapeHtml(asset.sources[0].page) + '" target="_blank" rel="noopener noreferrer">来源页面</a></p><code>' + escapeHtml(asset.file) + '</code></div></article>').join('');
  const data = JSON.stringify(manifest).replace(/</g, '\\u003c');
  return '<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>蟑螂杯 · 候选素材筛选</title><link rel="stylesheet" href="gallery.css"></head><body><header><h1>候选素材筛选</h1><p>原图与来源保存在本地；采集成功不代表拥有使用授权。不会自动替换官网素材。</p><div class="tools"><input id="search" placeholder="搜索文件名、来源、分类"><select id="source"><option value="">全部来源</option>' + manifest.sources.map(source => '<option value="' + escapeHtml(source.id) + '">' + escapeHtml(source.name) + '</option>').join('') + '</select><select id="category"><option value="">全部分类</option><option>背景</option><option>分队</option><option>结局</option><option>图标</option><option>游戏元素</option><option>待筛选</option></select><select id="background"><option value="checker">透明棋盘</option><option value="dark">深色背景</option><option value="light">浅色背景</option></select><button id="selectVisible">勾选当前筛选结果</button><button id="clear">清空勾选</button><button id="export">导出已选素材清单</button></div><p id="status"></p></header><main>' + cards + '</main><script type="application/json" id="asset-data">' + data + '</script><script src="gallery.js"></script></body></html>';
}

/** 扫描官网当前图片的摘要，供预览页标记已有素材，不移动、不重写官网文件。 */
async function existingImageHashes() {
  const result = new Map();
  for (const entry of await readdir(join(projectDir, '素材'), { withFileTypes: true })) {
    if (!entry.isFile() || !/\.(png|jpe?g|webp|gif|svg)$/i.test(entry.name)) continue;
    const hash = createHash('sha256').update(await readFile(join(projectDir, '素材', entry.name))).digest('hex');
    if (!result.has(hash)) result.set(hash, []);
    result.get(hash).push('素材/' + entry.name);
  }
  return result;
}

/** 写入清单和离线预览页并复制本地预览脚本；只操作候选目录，不修改官网数据。 */
async function writeOutputs(output, manifest) {
  await writeFile(join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  await writeFile(join(output, 'index.html'), galleryMarkup(manifest), 'utf8');
  for (const name of ['gallery.js', 'gallery.css']) await copyFile(join(toolDir, 'asset-gallery', name), join(output, name));
}

/** 读取有大小上限的图片响应；超过配置限制直接中止，不把截断文件写入候选目录。 */
async function imageBytes(response, limit) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of response.body) {
    bytes += chunk.length;
    if (bytes > limit) throw new Error('图片超过 maxFileBytes：' + response.url);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/** 按配置发现公开图片并逐个下载去重；每次保存进度，错误中止前仍生成已完成部分的预览页。 */
export async function collectAssets(config, output) {
  validateConfig(config);
  output = resolve(output);
  // Windows 路径大小写不影响目录身份，使用平台路径语义而非字符串前缀检查公开目录边界。
  const outputRelative = relative(projectDir, output);
  if (outputRelative === '' || (!isAbsolute(outputRelative) && outputRelative !== '..' && !outputRelative.startsWith('..' + sep))) throw new Error('候选目录不得位于官网项目目录中');
  await mkdir(join(output, 'images'), { recursive: true });
  const priorFiles = await readdir(output);
  const manifest = priorFiles.includes('manifest.json') ? JSON.parse(await readFile(join(output, 'manifest.json'), 'utf8')) : { version: 1, assets: [], sources: [] };
  const existing = await existingImageHashes();
  const hosts = [...new Set(config.sources.flatMap(source => source.hosts))];
  const request = createRequester(hosts, config.delayMs, config.timeoutMs);
  const candidates = new Map();
  const stylesSeen = new Set();
  manifest.sources = config.sources.map(source => ({ id: source.id, name: source.name, pages: source.pages }));
  manifest.collectedAt = new Date().toISOString();
  try {
    for (const source of config.sources) {
      for (const page of source.pages) {
        console.log('读取页面：' + page);
        const response = await request(page);
        if (!response.headers.get('content-type')?.includes('text/html')) throw new Error('页面响应不是 HTML：' + page);
        const links = extractLinks(await response.text(), page, source.hosts);
        for (const style of links.styles) {
          if (stylesSeen.has(style)) continue;
          if (stylesSeen.size >= config.maxStyles) throw new Error('样式数量超过 maxStyles，请检查页面范围或调整配置');
          stylesSeen.add(style);
          const styleResponse = await request(style, page);
          if (!styleResponse.headers.get('content-type')?.includes('text/css')) throw new Error('样式响应不是 CSS：' + style);
          links.images.push(...extractLinks(await styleResponse.text(), style, source.hosts).images);
        }
        for (const url of links.images) {
          if (!candidates.has(url)) candidates.set(url, []);
          const sources = candidates.get(url);
          if (!sources.some(item => item.page === page)) sources.push({ id: source.id, name: source.name, page, url });
        }
      }
    }
    manifest.discovered = candidates.size;
    manifest.limit = config.maxAssets;
    console.log('发现 ' + candidates.size + ' 个原图地址，本次最多下载 ' + config.maxAssets + ' 个。');
    let index = 0;
    for (const [url, sources] of [...candidates].slice(0, config.maxAssets)) {
      index += 1;
      console.log('[' + index + '/' + Math.min(candidates.size, config.maxAssets) + '] ' + decodeURIComponent(new URL(url).pathname.split('/').at(-1)));
      const saved = manifest.assets.find(asset => asset.sources.some(source => source.url === url));
      if (saved) {
        const hash = createHash('sha256').update(await readFile(join(output, saved.file))).digest('hex');
        if (hash !== saved.sha256) throw new Error('已有候选文件摘要不一致：' + saved.file);
        saved.category = classifyImage(saved.name);
        for (const source of sources) if (!saved.sources.some(item => item.page === source.page && item.url === source.url)) saved.sources.push(source);
        continue;
      }
      const response = await request(url, sources[0].page);
      const type = response.headers.get('content-type')?.split(';')[0].trim();
      if (!imageTypes.has(type)) throw new Error('素材响应不是支持的图片类型：' + type + ' ' + url);
      const body = await imageBytes(response, config.maxFileBytes);
      const hash = createHash('sha256').update(body).digest('hex');
      const duplicate = manifest.assets.find(asset => asset.sha256 === hash);
      if (duplicate) duplicate.sources.push(...sources);
      else {
        const name = decodeURIComponent(new URL(url).pathname.split('/').at(-1));
        const safeName = basename(name, extname(name)).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 70);
        const file = 'images/' + hash.slice(0, 12) + '-' + safeName + imageTypes.get(type);
        await writeFile(join(output, file), body);
        manifest.assets.push({ sha256: hash, name, file, bytes: body.length, type, category: classifyImage(name), existingFiles: existing.get(hash) || [], sources });
      }
      await writeOutputs(output, manifest);
    }
  } finally {
    // 保存已成功的图片和来源，错误仍向上传播；用户修正问题后重新运行，不做自动重试。
    await writeOutputs(output, manifest);
  }
  console.log('已收集 ' + manifest.assets.length + ' 张去重图片。预览：' + join(output, 'index.html'));
  return manifest;
}

/** 解析明确支持的命令行参数，加载配置并采集；未知参数立即报错，默认输出到项目外的同级目录。 */
async function main() {
  const options = { config: join(toolDir, 'asset-sources.json'), out: resolve(projectDir, '../web-素材候选') };
  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    if (!['--config', '--out'].includes(key) || !args[index + 1]) throw new Error('仅支持 --config 配置路径 和 --out 候选目录');
    options[key.slice(2)] = resolve(args[index + 1]);
  }
  await collectAssets(JSON.parse(await readFile(options.config, 'utf8')), options.out);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
