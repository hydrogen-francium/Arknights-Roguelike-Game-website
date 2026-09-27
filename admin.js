let competitionState = null;

/** 将数组转为后台多行文本，供运营者逐行编辑。 */
function linesFromArray(values) {
  return (values || []).join('\n');
}

/** 将后台多行文本解析为非空文本数组。 */
function arrayFromLines(value) {
  return value.split('\n').map(item => item.trim()).filter(Boolean);
}

/** 转义后台已有文本，避免编辑器中的内容破坏表单结构。 */
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
}

/** 将逐行的“类别|规则|分值”文本转换为积分项目数组。 */
function parseScoreItems(value) {
  return arrayFromLines(value).map(line => {
    const [category, rule, points] = line.split('|').map(item => item.trim());
    if (!category || !rule || points === undefined || Number.isNaN(Number(points))) throw new Error(`积分项目格式错误：${line}`);
    return {category, rule, points: Number(points)};
  });
}

/** 将积分项目数组转换为后台可读的逐行文本。 */
function stringifyScoreItems(items) {
  return (items || []).map(item => `${item.category || ''}|${item.rule || ''}|${item.points || 0}`).join('\n');
}

/** 将数字输入严格解析为有限数值，避免错误成绩静默写入赛事数据。 */
function numberFromInput(value, fieldName) {
  if (value.trim() === '' || !Number.isFinite(Number(value))) throw new Error(`${fieldName}必须是数字`);
  return Number(value);
}

/** 返回全部选手，供日程下拉框复用队伍数据。 */
function allPlayers() {
  return competitionState.teams.flatMap(team => team.players.map(player => ({player, team})));
}

/** 根据编号生成日程选手选项，并标记当前已选值。 */
function playerOptions(selectedId) {
  return `<option value="">未安排</option>${allPlayers().map(({player, team}) => `<option value="${escapeHtml(player.id)}" ${selectedId === player.id ? 'selected' : ''}>${escapeHtml(team.name)} · ${escapeHtml(player.name)}</option>`).join('')}`;
}

/** 将赛事信息填充到基础表单。 */
function renderEventForm() {
  const {event} = competitionState;
  document.getElementById('shortName').value = event.shortName || '';
  document.getElementById('fullName').value = event.fullName || '';
  document.getElementById('description').value = event.description || '';
  document.getElementById('eventStatus').value = event.status || '';
  document.getElementById('eventMode').value = event.mode || '';
  document.getElementById('ruleVersion').value = event.ruleVersion || '';
  document.getElementById('audio').value = event.audio || '';
}

/** 绘制规则章节编辑器，支持章节、段落、条目、分数子章节和提示框。 */
function renderRulesEditor() {
  document.getElementById('rulesEditor').innerHTML = competitionState.rules.sections.map((section, index) => `<article class="editor-card rule-card" data-rule-index="${index}"><header><strong>规则章节 ${index + 1}</strong><button class="button danger" data-remove-rule="${index}" type="button">删除章节</button></header><div class="rule-grid"><label>章节标题<input data-rule-field="title" value="${escapeHtml(section.title)}"></label><label>章节编号<input data-rule-field="id" value="${escapeHtml(section.id)}"></label><label class="wide">段落<textarea data-rule-field="paragraphs">${escapeHtml(linesFromArray(section.paragraphs))}</textarea></label><label class="wide">普通条目<textarea data-rule-field="items">${escapeHtml(linesFromArray(section.items))}</textarea></label><label class="wide">提示框<textarea data-rule-field="callout">${escapeHtml(section.callout || '')}</textarea></label></div><div class="subsections"><h4>分数规则子章节</h4>${(section.subsections || []).map((subsection, subIndex) => `<div class="subsection-card" data-subsection-index="${subIndex}"><div class="inline-tools"><input data-subsection-field="title" value="${escapeHtml(subsection.title)}"><button class="button danger" data-remove-subsection type="button">删除子章节</button></div><textarea data-subsection-field="items">${escapeHtml(linesFromArray(subsection.items))}</textarea></div>`).join('')}<button class="button secondary" data-add-subsection type="button">新增分数子章节</button></div></article>`).join('');
}

/** 绘制某一赛段的日期和唯一参赛选手选择项。 */
function renderScheduleStage(stage) {
  const host = document.getElementById(`${stage}Schedule`);
  host.innerHTML = (competitionState.schedule[stage] || []).map((day, index) => `<div class="schedule-row" data-stage="${stage}" data-day-index="${index}"><label>日期<input data-day-field="date" value="${escapeHtml(day.date)}"></label><label>赛程标签<input data-day-field="label" value="${escapeHtml(day.label)}"></label><label>当日参赛选手<select data-day-field="playerIds">${playerOptions(day.playerIds?.[0] || '')}</select></label><button class="button danger" data-remove-day type="button">删除</button></div>`).join('');
}

/** 绘制所有队伍、选手和图片字段。 */
function renderTeamsEditor() {
  document.getElementById('teamsEditor').innerHTML = competitionState.teams.map((team, teamIndex) => `<article class="editor-card team-card" data-team-id="${escapeHtml(team.id)}"><header class="team-header"><label>队伍名称<input data-team-field="name" value="${escapeHtml(team.name)}"></label><div class="upload-field"><label>队伍图标<input id="team-emblem-${teamIndex}" data-team-field="emblem" value="${escapeHtml(team.emblem)}"></label><button class="button secondary" data-upload-target="team-emblem-${teamIndex}" type="button">上传</button></div><button class="button danger" data-remove-team type="button">删除队伍</button></header><div class="players">${team.players.map((player, playerIndex) => playerMarkup(player, teamIndex, playerIndex)).join('')}</div><button class="button secondary" data-add-player type="button">新增选手</button></article>`).join('');
}

/** 生成单个选手的结构化编辑表单。 */
function playerMarkup(player, teamIndex, playerIndex) {
  const avatarId = `avatar-${teamIndex}-${playerIndex}`;
  const lineupId = `lineup-${teamIndex}-${playerIndex}`;
  return `<article class="player-card" data-player-id="${escapeHtml(player.id)}"><header class="inline-tools"><strong>选手 ${playerIndex + 1}</strong><button class="button danger" data-remove-player type="button">删除选手</button></header><div class="player-grid"><label>选手编号<input data-player-field="id" value="${escapeHtml(player.id)}"></label><label>选手名称<input data-player-field="name" value="${escapeHtml(player.name)}"></label><div class="upload-field"><label>头像<input id="${avatarId}" data-player-field="avatar" value="${escapeHtml(player.avatar)}"></label><button class="button secondary" data-upload-target="${avatarId}" type="button">上传</button></div><label>初赛游戏结算分<input type="number" data-player-field="prelim" value="${Number(player.prelim || 0)}"></label><label>决赛游戏结算分<input type="number" data-player-field="final" value="${Number(player.final || 0)}"></label><label>分队倍率名称<input data-player-field="multiplier" value="${escapeHtml(player.multiplier)}"></label><label>完成结局（逗号分隔）<input data-player-field="endings" value="${escapeHtml((player.endings || []).join('、'))}"></label><label>开局主力<input data-player-field="starter" value="${escapeHtml(player.starter)}"></label><label>开局分队<input data-player-field="squad" value="${escapeHtml(player.squad)}"></label><label>干员抓位<input data-player-field="recruit" value="${escapeHtml(player.recruit)}"></label><label>提取余额<input data-player-field="extractionBalance" value="${escapeHtml(player.extractionBalance)}"></label><div class="upload-field"><label>阵容构筑图<input id="${lineupId}" data-player-field="lineupImage" value="${escapeHtml(player.lineupImage)}"></label><button class="button secondary" data-upload-target="${lineupId}" type="button">上传</button></div><label class="wide">规则加减分（类别|规则|分值，每行一项）<textarea data-player-field="scoreItems">${escapeHtml(stringifyScoreItems(player.scoreItems))}</textarea></label><label class="wide">扣分项目（类别|规则|分值，每行一项）<textarea data-player-field="deductions">${escapeHtml(stringifyScoreItems(player.deductions))}</textarea></label></div></article>`;
}

/** 将基础表单内容写回内存中的赛事状态。 */
function collectEventForm() {
  competitionState.event = {
    ...competitionState.event,
    shortName: document.getElementById('shortName').value,
    fullName: document.getElementById('fullName').value,
    description: document.getElementById('description').value,
    status: document.getElementById('eventStatus').value,
    mode: document.getElementById('eventMode').value,
    ruleVersion: document.getElementById('ruleVersion').value,
    audio: document.getElementById('audio').value
  };
}

/** 将规则编辑器内容写回规则数据结构。 */
function collectRules() {
  competitionState.rules.sections = [...document.querySelectorAll('.rule-card')].map(card => {
    const field = name => card.querySelector(`[data-rule-field="${name}"]`).value;
    return {
      id: field('id'),
      title: field('title'),
      paragraphs: arrayFromLines(field('paragraphs')),
      items: arrayFromLines(field('items')),
      callout: field('callout'),
      subsections: [...card.querySelectorAll('.subsection-card')].map(subsection => ({title: subsection.querySelector('[data-subsection-field="title"]').value, items: arrayFromLines(subsection.querySelector('[data-subsection-field="items"]').value)}))
    };
  });
}

/** 将日期编辑器内容写回对应赛段的日程数据。 */
function collectScheduleStage(stage) {
  competitionState.schedule[stage] = [...document.querySelectorAll(`.schedule-row[data-stage="${stage}"]`)].map(row => ({
    date: row.querySelector('[data-day-field="date"]').value,
    label: row.querySelector('[data-day-field="label"]').value,
    playerIds: row.querySelector('[data-day-field="playerIds"]').value ? [row.querySelector('[data-day-field="playerIds"]').value] : []
  }));
}

/** 将单个选手表单转换为规范的选手对象。 */
function collectPlayer(card) {
  const value = name => card.querySelector(`[data-player-field="${name}"]`).value;
  return {
    id: value('id'),
    name: value('name'),
    avatar: value('avatar'),
    prelim: numberFromInput(value('prelim'), '初赛游戏结算分'),
    final: numberFromInput(value('final'), '决赛游戏结算分'),
    multiplier: value('multiplier'),
    endings: value('endings').split(/[、,，]/).map(item => item.trim()).filter(Boolean),
    starter: value('starter'),
    squad: value('squad'),
    recruit: value('recruit'),
    extractionBalance: value('extractionBalance'),
    lineupImage: value('lineupImage'),
    scoreItems: parseScoreItems(value('scoreItems')),
    deductions: parseScoreItems(value('deductions'))
  };
}

/** 将队伍编辑器内容写回队伍和选手数据。 */
function collectTeams() {
  competitionState.teams = [...document.querySelectorAll('.team-card')].map(card => ({
    id: card.dataset.teamId,
    name: card.querySelector('[data-team-field="name"]').value,
    emblem: card.querySelector('[data-team-field="emblem"]').value,
    players: [...card.querySelectorAll('.player-card')].map(collectPlayer)
  }));
}

/** 在上传接口中保存图片，并把返回路径写入目标字段。 */
async function uploadAsset(input) {
  const file = input.files[0];
  if (!file) return;
  const response = await fetch(`/api/assets?name=${encodeURIComponent(file.name)}`, {method: 'PUT', body: file});
  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    throw new Error(result.error || `素材上传失败：${response.status}`);
  }
  const result = await response.json();
  document.getElementById(input.dataset.target).value = result.path;
  setStatus(`已上传：${result.path}`);
}

/** 从接口读取最新赛事状态并重绘全部编辑器。 */
async function loadState() {
  const response = await fetch('/api/admin/competition');
  if (!response.ok) throw new Error(`读取失败：${response.status}`);
  competitionState = await response.json();
  renderEventForm();
  renderPublicationForm();
  renderRulesEditor();
  renderScheduleStage('prelim');
  renderScheduleStage('final');
  renderTeamsEditor();
  setStatus('已读取最新数据');
}

/** 设置后台状态提示文本。 */
function setStatus(message) {
  document.getElementById('status').textContent = message;
}

/** 校验并保存完整赛事状态，任何格式错误都会阻止提交。 */
async function saveState() {
  collectEventForm();
  collectPublicationForm();
  collectRules();
  collectScheduleStage('prelim');
  collectScheduleStage('final');
  collectTeams();
  const response = await fetch('/api/admin/competition', {method: 'PUT', headers: {'content-type': 'application/json'}, body: JSON.stringify(competitionState)});
  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    throw new Error(result.error || `保存失败：${response.status}`);
  }
  setStatus('保存成功，刷新官网即可查看最新数据');
}

/** 将服务器中的页面发布开关填充到后台复选框。 */
function renderPublicationForm() {
  document.querySelectorAll('[data-publication-page]').forEach(input => {
    input.checked = Boolean(competitionState.pages[input.dataset.publicationPage]);
  });
}

/** 将页面发布复选框写回赛事状态，关闭页面时不再向公开接口投放内容。 */
function collectPublicationForm() {
  competitionState.pages = Object.fromEntries([...document.querySelectorAll('[data-publication-page]')].map(input => [input.dataset.publicationPage, input.checked]));
}

/** 生成一个新队伍编号，避免新增队伍与已有队伍冲突。 */
function nextId(prefix, ids) {
  let index = ids.length + 1;
  while (ids.includes(`${prefix}-${index}`)) index += 1;
  return `${prefix}-${index}`;
}

/** 绑定规则、日程、队伍、选手和上传按钮的事件委托。 */
function bindEditorEvents() {
  document.querySelectorAll('[data-admin-page]').forEach(button => button.addEventListener('click', () => {
    const page = button.dataset.adminPage;
    document.querySelectorAll('[data-admin-page]').forEach(tab => tab.classList.toggle('active', tab === button));
    document.querySelectorAll('[data-admin-page-content]').forEach(panel => panel.classList.toggle('active', panel.dataset.adminPageContent === page));
  }));
  document.getElementById('addRuleSection').addEventListener('click', () => { competitionState.rules.sections.push({id: nextId('section', competitionState.rules.sections.map(item => item.id)), title: '新规则章节', paragraphs: [], items: [], callout: '', subsections: []}); renderRulesEditor(); });
  document.querySelectorAll('[data-add-day]').forEach(button => button.addEventListener('click', () => { competitionState.schedule[button.dataset.addDay].push({date: '待定', label: `${button.dataset.addDay === 'prelim' ? '初赛' : '决赛'} Day${competitionState.schedule[button.dataset.addDay].length + 1}`, playerIds: []}); renderScheduleStage(button.dataset.addDay); }));
  document.getElementById('addTeam').addEventListener('click', () => { competitionState.teams.push({id: nextId('team', competitionState.teams.map(item => item.id)), name: '新队伍', emblem: '', players: []}); renderTeamsEditor(); });
  document.body.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button) return;
    const ruleCard = button.closest('.rule-card');
    if (button.matches('[data-remove-rule]')) { ruleCard.remove(); return; }
    if (button.matches('[data-add-subsection]')) { button.insertAdjacentHTML('beforebegin', '<div class="subsection-card" data-subsection-index="new"><div class="inline-tools"><input data-subsection-field="title" value="新分数规则"><button class="button danger" data-remove-subsection type="button">删除子章节</button></div><textarea data-subsection-field="items"></textarea></div>'); return; }
    if (button.matches('[data-remove-subsection]')) { button.closest('.subsection-card').remove(); return; }
    const teamCard = button.closest('.team-card');
    if (button.matches('[data-remove-team]')) { teamCard.remove(); return; }
    if (button.matches('[data-add-player]')) { const teamIndex = [...document.querySelectorAll('.team-card')].indexOf(teamCard); const playerIndex = teamCard.querySelectorAll('.player-card').length; teamCard.querySelector('.players').insertAdjacentHTML('beforeend', playerMarkup({id: nextId('p', allPlayers().map(item => item.player.id)), name: '新选手', avatar: '', prelim: 0, final: 0, multiplier: '', endings: [], starter: '', squad: '', recruit: '', extractionBalance: '', lineupImage: '', scoreItems: [], deductions: []}, teamIndex, playerIndex)); renderScheduleStage('prelim'); renderScheduleStage('final'); return; }
    if (button.matches('[data-remove-player]')) { button.closest('.player-card').remove(); return; }
    if (button.matches('[data-upload-target]')) { const fileInput = document.createElement('input'); fileInput.type = 'file'; fileInput.accept = 'image/png,image/jpeg,image/webp,image/gif'; fileInput.dataset.target = button.dataset.uploadTarget; fileInput.addEventListener('change', () => uploadAsset(fileInput).catch(error => setStatus(error.message))); fileInput.click(); }
  });
}

/** 将登录接口错误显示在登录表单内，避免未认证状态访问编辑器。 */
function showLoginError(message) {
  document.getElementById('loginError').textContent = message;
}

/** 读取当前会话并在已认证时打开后台编辑器。 */
async function checkSession() {
  const response = await fetch('/api/session');
  if (!response.ok) throw new Error(`会话检查失败：${response.status}`);
  const result = await response.json();
  if (!result.authenticated) return;
  await enterAdminEditor();
}

/** 显示已认证的编辑器并加载后台数据。 */
async function enterAdminEditor() {
  document.getElementById('loginPanel').hidden = true;
  document.getElementById('adminEditor').hidden = false;
  await loadState();
}

/** 提交后台登录凭据并建立服务器会话。 */
async function handleLogin(event) {
  event.preventDefault();
  showLoginError('');
  const response = await fetch('/api/session', {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({username: document.getElementById('loginUsername').value, password: document.getElementById('loginPassword').value})
  });
  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    throw new Error(result.error || `登录失败：${response.status}`);
  }
  await enterAdminEditor();
}

/** 删除当前后台会话并回到登录页。 */
async function logout() {
  const response = await fetch('/api/session', {method: 'DELETE'});
  if (!response.ok) throw new Error(`退出登录失败：${response.status}`);
  window.location.reload();
}

document.getElementById('loginForm').addEventListener('submit', event => handleLogin(event).catch(error => showLoginError(error.message)));
document.getElementById('save').addEventListener('click', () => saveState().catch(error => setStatus(error.message)));
document.getElementById('reload').addEventListener('click', () => loadState().catch(error => setStatus(error.message)));
document.getElementById('logout').addEventListener('click', () => logout().catch(error => setStatus(error.message)));
bindEditorEvents();
checkSession().catch(error => showLoginError(error.message));
