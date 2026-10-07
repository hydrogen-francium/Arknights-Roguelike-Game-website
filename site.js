import { getMultiplier as calculateMultiplier, getScoreComponents as calculateScoreComponents } from './scoring.js';

let state = null;
let currentStage = 'prelim';
let currentDay = 0;
let rankMode = 'current';
let selectedScoreTeamId = null;

const squadAssets = {
  堡垒战术分队: '素材/堡垒战术分队.png', 本源研修分队: '素材/本源研修分队.png', 地面突破分队: '素材/地面突破分队.png',
  地质调查分队: '素材/地质调查分队.png', 多边贸易分队: '素材/多边贸易分队.png', 高台突破分队: '素材/高台突破分队.png',
  后勤分队: '素材/后勤分队.png', 开拓者分队: '素材/开拓者分队.png', 矛头分队: '素材/矛头分队.png',
  破坏战术分队: '素材/破坏战术分队.png', 特勤分队: '素材/特勤分队.png', 突击战术分队: '素材/突击战术分队.png',
  文明开化分队: '素材/文明开化分队.png', 远程战术分队: '素材/远程战术分队.png', 指挥分队: '素材/指挥分队.png'
};

const endingAssets = {
  混沌源阶理论: '素材/通关：混沌源阶理论.png', 畸症: '素材/通关：畸症.png', 痛苦将息: '素材/通关：痛苦将息.png'
};

/** 转义用户录入的文本，防止后台内容直接进入页面时破坏 HTML。 */
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character]);
}

/** 展示服务端已公布的队伍指定；未公布时不生成徽章，头像未上传时仅显示文字。 */
function eliteExplorerBadgeMarkup(team) {
  const explorer = team.eliteExplorer;
  if (!explorer) return '';
  const avatar = explorer.avatar ? '<img src="' + escapeHtml(explorer.avatar) + '" alt="" loading="lazy" decoding="async">' : '';
  return '<div class="elite-explorer">' + avatar + '<div><small>精英探索者 · 六星</small><b>' + escapeHtml(explorer.name) + '</b></div></div>';
}

/** 展示选手在给定赛段的规则状态；它不进入积分账本，也不改变最终成绩。 */
function eliteExplorerRuleMarkup(team, player, stage) {
  if (!team.eliteExplorer) return '';
  const used = player.eliteExplorerUsage?.[stage] ?? null;
  const label = used === null ? '未登记' : used ? '已使用' : '未使用';
  return '<section class="elite-rule-status"><h4>队伍规则状态</h4><div class="elite-rule-content">' + eliteExplorerBadgeMarkup(team) + '<p><b>本局使用：</b>' + label + '</p></div><p class="elite-rule-note">指定干员可由全队不限次数使用，不受普通六星干员每队两次的使用限制；该身份不加分或扣分。</p></section>';
}

/** 返回所有选手及所属队伍，用于日程、排名和积分数据共用同一份数据源。 */
function allPlayers() {
  return state.teams.flatMap(team => team.players.map(player => ({player, team})));
}

/** 按选手编号查找选手及所属队伍，找不到时返回空值。 */
function findPlayer(playerId) {
  return allPlayers().find(item => item.player.id === playerId) || null;
}

/** 返回选手的分队倍率，倍率名称与后台录入值保持一致。 */
function getMultiplier(player) {
  return calculateMultiplier(player);
}

/** 汇总一名选手在指定赛段的基础分、倍率调整、规则加分和结局加分。 */
function getScoreComponents(player, stage) {
  if (!player.computedScores?.[stage]) throw new Error(`选手 ${player.name} 缺少服务端计分结果`);
  return player.computedScores[stage];
}

/** 返回选手在指定赛段的最终展示分数。 */
function calculatePlayerScore(player, stage) {
  return getScoreComponents(player, stage).total;
}

/** 根据初赛总分计算进入决赛的两支队伍编号。 */
function getFinalTeamIds() {
  return [...state.teams]
    .map(team => ({id: team.id, total: team.players.reduce((sum, player) => sum + calculatePlayerScore(player, 'prelim'), 0)}))
    .sort((left, right) => right.total - left.total)
    .slice(0, 2)
    .map(item => item.id);
}

/** 返回队伍在当前排名模式下使用的赛段、成员分数和总分。 */
function getTeamScore(team, mode = rankMode) {
  const useFinal = mode === 'final' || (mode === 'current' && getFinalTeamIds().includes(team.id));
  const stage = useFinal ? 'final' : 'prelim';
  const scores = team.players.map(player => calculatePlayerScore(player, stage));
  return {stage, scores, total: scores.reduce((sum, score) => sum + score, 0)};
}

/** 更新首页的赛事名称、状态、模式、规则版本和背景音乐。 */
function renderEvent() {
  if (!state.event) return;
  const {event} = state;
  document.title = `${event.shortName} · 赛事档案`;
  document.querySelector('.seal').textContent = `${event.shortName} · ${event.status}`;
  document.querySelector('.hero h1 span').textContent = event.fullName;
  document.querySelector('.hero h1').lastChild.textContent = event.shortName;
  document.querySelector('.hero-desc').textContent = event.description;
  const statusValues = document.querySelectorAll('.statusline strong');
  [event.status, event.mode, event.ruleVersion].forEach((value, index) => {
    if (statusValues[index]) statusValues[index].textContent = value;
  });
  const audio = document.getElementById('themeAudio');
  if (event.audio) audio.src = event.audio;
}

/** 将后台维护的规则章节绘制到规则页，规则文本因此不再依赖 HTML 静态副本。 */
function renderRules() {
  if (!state.rules) return;
  const host = document.querySelector('.rules-content');
  const nav = document.querySelector('.rules-nav');
  nav.innerHTML = `<strong>规则索引</strong>${state.rules.sections.map(section => `<a href="#rule-${escapeHtml(section.id)}">${escapeHtml(section.title)}</a>`).join('')}`;
  host.innerHTML = state.rules.sections.map((section, index) => {
    const paragraphs = (section.paragraphs || []).map(text => `<p>${escapeHtml(text)}</p>`).join('');
    const items = (section.items || []).length ? `<ul>${section.items.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>` : '';
    const subsections = (section.subsections || []).map(subsection => `<section class="dynamic-rule-subsection"><h3>${escapeHtml(subsection.title)}</h3><ul>${(subsection.items || []).map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul></section>`).join('');
    const callout = section.callout ? `<div class="rule-callout">${escapeHtml(section.callout)}</div>` : '';
    return `<article class="rule-block" id="rule-${escapeHtml(section.id)}"><h2>${escapeHtml(section.title)}</h2>${index === 0 ? `<p class="rule-version">${escapeHtml(state.rules.version)}</p>` : ''}${paragraphs}${items}${subsections}${callout}</article>`;
  }).join('');
}

/** 绘制当前赛段的日期按钮，并把按钮事件绑定到当前日程状态。 */
function renderDays() {
  if (!state.schedule) return;
  const days = state.schedule[currentStage] || [];
  if (currentDay >= days.length) currentDay = Math.max(0, days.length - 1);
  const tabs = document.getElementById('dayTabs');
  tabs.innerHTML = days.map((day, index) => `<button class="${index === currentDay ? 'active' : ''}" data-day="${index}">${escapeHtml(day.date)}<br><small>${escapeHtml(day.label)}</small></button>`).join('');
  tabs.querySelectorAll('button').forEach(button => button.addEventListener('click', () => {
    currentDay = Number(button.dataset.day);
    renderDays();
    renderSchedule();
  }));
}

/** 生成单名选手在日程页的公开信息和完整得分详情。 */
function playerMarkup(player, team, stage) {
  const components = getScoreComponents(player, stage);
  const endings = player.endings || [];
  const scoreItems = [...components.ruleItems, ...components.endingItems, ...components.deductions];
  const ledger = `<div class="score-ledger"><span class="ledger-heading">基础与分队计算</span><span class="ledger-rule">游戏结算分</span><b class="ledger-points">${components.base}</b><span class="ledger-rule">${escapeHtml(player.multiplier || '普通')}倍率调整</span><b class="ledger-points ${components.multiplierDelta < 0 ? 'negative' : 'positive'}">${components.multiplierDelta > 0 ? '+' : ''}${components.multiplierDelta}</b>${components.squadBonus ? `<span class="ledger-rule">矛头分队额外加分</span><b class="ledger-points positive">+${components.squadBonus}</b>` : ''}${scoreItems.map(item => `<span class="ledger-heading">${escapeHtml(item.category || '规则项')}</span><span class="ledger-rule">${escapeHtml(item.rule || '')}</span><b class="ledger-points ${Number(item.points) < 0 ? 'negative' : 'positive'}">${Number(item.points) > 0 ? '+' : ''}${Number(item.points || 0)}</b>`).join('')}<span class="ledger-heading">最终得分</span><span class="ledger-rule">本场公开成绩</span><b class="ledger-points">${components.total}</b></div>`;
  const endingBadges = endings.map(ending => endingAssets[ending] ? `<span class="ending-icon"><img src="${escapeHtml(endingAssets[ending])}" alt="" loading="lazy" decoding="async">${escapeHtml(ending)}</span>` : `<span class="ending-icon ending-text">${escapeHtml(ending)}</span>`).join('') || '待录入';
  const squadIcon = squadAssets[player.squad];
  const squadMarkup = squadIcon ? `<span class="squad-icon"><img src="${escapeHtml(squadIcon)}" alt="" loading="lazy" decoding="async">${escapeHtml(player.squad)}</span>` : escapeHtml(player.squad || '待录入');
  return `<article class="schedule-player-card"><div class="schedule-player-head"><img class="schedule-avatar" src="${escapeHtml(player.avatar)}" alt="" loading="lazy" decoding="async"><div><strong>${escapeHtml(player.name)}</strong><span>${escapeHtml(team.name)}</span></div><b>${components.total} 分</b></div><div class="player-detail-grid"><div><small>开局主力</small><strong>${escapeHtml(player.starter || '待录入')}</strong></div><div><small>开局分队</small><strong>${squadMarkup}</strong></div><div><small>完成结局</small><strong class="ending-list">${endingBadges}</strong></div><div><small>提取余额</small><strong>${escapeHtml(player.extractionBalance || '待录入')}</strong></div><div class="detail-wide"><small>干员抓位</small><strong>${escapeHtml(player.recruit || '待录入')}</strong></div></div>${eliteExplorerRuleMarkup(team, player, stage)}${player.lineupImage ? `<figure class="lineup-figure"><figcaption>阵容构筑</figcaption><img src="${escapeHtml(player.lineupImage)}" alt="${escapeHtml(player.name)}阵容构筑" loading="lazy" decoding="async"></figure>` : ''}<details class="schedule-score-details"><summary>查看得分详情</summary>${ledger}</details></article>`;
}

/** 绘制当前赛段和当前日期的全部参赛选手；每日一场不再使用硬编码首名。 */
function renderSchedule() {
  if (!state.schedule) return;
  const host = document.getElementById('scheduleContent');
  const days = state.schedule[currentStage] || [];
  const day = days[currentDay];
  const note = document.querySelector('#schedule .day-note');
  if (note) note.textContent = `${currentStage === 'prelim' ? '初赛' : '决赛'}按日期查看当日参赛选手与完整得分详情。`;
  if (!day) {
    host.innerHTML = '<div class="schedule-empty">当前赛段尚未录入日程。</div>';
    return;
  }
  const players = day.playerIds.map(findPlayer).filter(Boolean);
  host.innerHTML = `<div class="match-card"><div class="match-top"><strong>${escapeHtml(day.label)}</strong><span>${escapeHtml(day.date)} · ${players.length} 名参赛选手</span></div>${players.length ? players.map(({player, team}) => playerMarkup(player, team, currentStage)).join('') : '<div class="schedule-empty">本日尚未录入参赛选手。</div>'}</div>`;
}

/** 绘制队伍排名；成员分数只保留头像和分数，避免网名长度破坏表格。 */
function renderRanking() {
  if (!state.teams.length) return;
  const ranked = state.teams.map(team => ({team, ...getTeamScore(team)})).sort((left, right) => right.total - left.total);
  document.getElementById('rankRows').innerHTML = ranked.map((row, index) => `<div class="team-row"><span class="ranknum">${String(index + 1).padStart(2, '0')}</span><div class="rankteam"><img src="${escapeHtml(row.team.emblem)}" alt="" loading="lazy" decoding="async"><div class="rankteam-copy"><b>${escapeHtml(row.team.name)}</b>${eliteExplorerBadgeMarkup(row.team)}</div></div><span class="member-scores">${row.team.players.map((player, playerIndex) => `<span class="member-score" title="${escapeHtml(player.name)}" aria-label="${escapeHtml(player.name)}：${Math.round(row.scores[playerIndex])}分"><img src="${escapeHtml(player.avatar)}" alt="" loading="lazy" decoding="async"><b>${Math.round(row.scores[playerIndex])}</b></span>`).join('')}</span><span>${row.stage === 'final' ? '决赛分' : '初赛分'}</span><strong class="total">${Math.round(row.total)}</strong></div>`).join('');
  const tabs = document.getElementById('scoreTeamTabs');
  if (!selectedScoreTeamId || !state.teams.some(team => team.id === selectedScoreTeamId)) selectedScoreTeamId = state.teams[0]?.id || null;
  tabs.innerHTML = state.teams.map(team => `<button class="${team.id === selectedScoreTeamId ? 'active' : ''}" data-score-team="${escapeHtml(team.id)}"><img src="${escapeHtml(team.emblem)}" alt="" loading="lazy" decoding="async">${escapeHtml(team.name)}</button>`).join('');
  tabs.querySelectorAll('button').forEach(button => button.addEventListener('click', () => {
    selectedScoreTeamId = button.dataset.scoreTeam;
    renderRanking();
  }));
  renderScoreData();
}

/** 绘制所选队伍的积分数据，并支持逐名选手展开规则加减分和多个完成结局。 */
function renderScoreData() {
  const team = state.teams.find(item => item.id === selectedScoreTeamId);
  if (!team) return;
  const row = getTeamScore(team);
  document.getElementById('scoreData').innerHTML = `<div class="score-data-card"><header class="score-data-team"><img src="${escapeHtml(team.emblem)}" alt="" loading="lazy" decoding="async"><div class="score-data-team-copy"><h3>${escapeHtml(team.name)}</h3>${eliteExplorerBadgeMarkup(team)}</div><span>队伍总分 ${Math.round(row.total)}</span></header>${team.players.map(player => { const components = getScoreComponents(player, row.stage); const modifier = getMultiplier(player).toFixed(2); const extra = components.squadBonus + [...components.ruleItems, ...components.endingItems, ...components.deductions].reduce((sum, item) => sum + Number(item.points || 0), 0); return `<details class="score-data-entry"><summary class="score-data-row"><span class="score-name"><img src="${escapeHtml(player.avatar)}" alt="" loading="lazy" decoding="async">${escapeHtml(player.name)}</span><span>${components.base}</span><span>×${modifier}</span><span class="${extra < 0 ? 'negative' : ''}">${extra > 0 ? '+' : ''}${extra}</span><strong>${components.total}</strong></summary><div class="score-data-expanded"><p><b>完成结局：</b>${escapeHtml((player.endings || []).join('、') || '待录入')}</p>${eliteExplorerRuleMarkup(team, player, row.stage)}${scoreLedgerMarkup(player, row.stage)}</div></details>`; }).join('')}</div>`;
}

/** 将未发布页面替换为不含任何占位数据的筹备中状态。 */
function renderPublicationState() {
  for (const page of ['home', 'rules', 'schedule', 'ranking']) {
    if (state.pages[page]) continue;
    const target = document.getElementById(page);
    if (target) target.innerHTML = '<div class="page-pending"><span>COCKROACH CUP #3</span><strong>页面筹备中</strong><small>内容尚未发布，敬请期待。</small></div>';
  }
}

/** 生成积分数据展开面板中的逐项明细。 */
function scoreLedgerMarkup(player, stage) {
  const components = getScoreComponents(player, stage);
  const items = [...components.ruleItems, ...components.endingItems, ...components.deductions];
  return `<div class="score-ledger">${items.map(item => `<span class="ledger-heading">${escapeHtml(item.category || '规则项')}</span><span class="ledger-rule">${escapeHtml(item.rule || '')}</span><b class="ledger-points ${Number(item.points) < 0 ? 'negative' : 'positive'}">${Number(item.points) > 0 ? '+' : ''}${Number(item.points || 0)}</b>`).join('')}<span class="ledger-heading">基础与分队计算</span><span class="ledger-rule">游戏结算分</span><b class="ledger-points">${components.base}</b><span class="ledger-rule">倍率调整</span><b class="ledger-points ${components.multiplierDelta < 0 ? 'negative' : 'positive'}">${components.multiplierDelta > 0 ? '+' : ''}${components.multiplierDelta}</b>${components.squadBonus ? `<span class="ledger-rule">矛头分队额外加分</span><b class="ledger-points positive">+${components.squadBonus}</b>` : ''}<span class="ledger-heading">最终得分</span><span class="ledger-rule">本场公开成绩</span><b class="ledger-points">${components.total}</b></div>`;
}

/** 切换单页视图，并同步更新顶部导航。 */
function showPage(pageId) {
  document.querySelectorAll('.page').forEach(page => page.classList.toggle('active', page.id === pageId));
  document.querySelectorAll('.nav button').forEach(button => button.classList.toggle('active', button.dataset.page === pageId));
  document.querySelector('.nav').classList.remove('open');
  const menuToggle = document.querySelector('.menu-toggle');
  menuToggle.setAttribute('aria-expanded', 'false');
  menuToggle.setAttribute('aria-label', '打开导航');
  window.scrollTo({top: 0, behavior: 'smooth'});
}

/** 切换移动端导航菜单，并同步按钮的展开状态和无障碍标签。 */
function toggleMobileMenu() {
  const nav = document.querySelector('.nav');
  const menuToggle = document.querySelector('.menu-toggle');
  const isOpen = nav.classList.toggle('open');
  menuToggle.setAttribute('aria-expanded', String(isOpen));
  menuToggle.setAttribute('aria-label', isOpen ? '关闭导航' : '打开导航');
}

/** 绑定导航、赛段切换和音乐控制事件。 */
function bindInteractions() {
  document.querySelectorAll('[data-go]').forEach(button => button.addEventListener('click', () => showPage(button.dataset.go)));
  document.querySelectorAll('[data-link-page]').forEach(link => link.addEventListener('click', event => { event.preventDefault(); showPage(link.dataset.linkPage); }));
  document.querySelector('.menu-toggle').addEventListener('click', toggleMobileMenu);
  document.querySelectorAll('.nav button').forEach(button => button.addEventListener('click', () => showPage(button.dataset.page)));
  document.querySelectorAll('[data-stage]').forEach(button => button.addEventListener('click', () => {
    currentStage = button.dataset.stage;
    currentDay = 0;
    document.querySelectorAll('[data-stage]').forEach(tab => tab.classList.toggle('active', tab === button));
    renderDays();
    renderSchedule();
  }));
  document.querySelectorAll('[data-rank-mode]').forEach(button => button.addEventListener('click', () => {
    rankMode = button.dataset.rankMode;
    document.querySelectorAll('[data-rank-mode]').forEach(tab => tab.classList.toggle('active', tab === button));
    renderRanking();
  }));
  const audio = document.getElementById('themeAudio');
  document.getElementById('musicToggle').addEventListener('click', () => {
    if (audio.paused) audio.play();
    else audio.pause();
  });
  audio.addEventListener('play', () => { document.getElementById('musicToggle').textContent = '暂停音乐'; document.getElementById('musicToggle').setAttribute('aria-pressed', 'true'); });
  audio.addEventListener('pause', () => { document.getElementById('musicToggle').textContent = '播放音乐'; document.getElementById('musicToggle').setAttribute('aria-pressed', 'false'); });
}

/** 从本地服务读取唯一赛事状态；直接打开文件时显示明确的访问方式提示。 */
async function loadCompetitionState() {
  if (window.location.protocol === 'file:') throw new Error('请通过 npm run dev 启动本地服务后访问赛事官网。');
  const pages = await Promise.all(['home', 'rules', 'schedule', 'ranking'].map(async page => {
    const response = await fetch(`/api/public/${page}`);
    if (!response.ok) throw new Error(`赛事数据接口返回 ${response.status}`);
    return response.json();
  }));
  state = { pages: pages[0].pages, event: pages[0].content?.event || null, rules: pages[1].content?.rules || null, schedule: pages[2].content?.schedule || null, teams: pages.find(item => item.content?.teams)?.content?.teams || [] };
}

/** 读取数据后初始化首页、规则、日程、排名和音乐控制。 */
async function bootstrap() {
  try {
    await loadCompetitionState();
    renderEvent();
    renderRules();
    bindInteractions();
    renderDays();
    renderSchedule();
    renderRanking();
    renderPublicationState();
    requestThemePlayback();
  } catch (error) {
    document.body.innerHTML = `<main class="load-error"><h1>赛事数据加载失败</h1><p>${escapeHtml(error.message)}</p></main>`;
  }
}

/** 页面加载时尝试自动播放，并在浏览器要求用户操作时等待首次交互重试。 */
function requestThemePlayback() {
  const audio = document.getElementById('themeAudio');
  let waitingForInteraction = true;
  const retryAfterInteraction = () => {
    if (!waitingForInteraction) return;
    waitingForInteraction = false;
    document.removeEventListener('pointerdown', retryAfterInteraction);
    document.removeEventListener('keydown', retryAfterInteraction);
    audio.play().catch(error => {
      if (error.name !== 'NotAllowedError') console.error('主题音乐播放失败', error);
    });
  };
  audio.play().catch(error => {
    if (error.name === 'NotAllowedError') {
      document.addEventListener('pointerdown', retryAfterInteraction);
      document.addEventListener('keydown', retryAfterInteraction);
      return;
    }
    console.error('主题音乐播放失败', error);
  });
}

bootstrap();
