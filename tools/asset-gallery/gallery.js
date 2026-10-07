const manifest = JSON.parse(document.getElementById('asset-data').textContent);
const cards = [...document.querySelectorAll('.card')];
const assets = new Map(manifest.assets.map(asset => [asset.sha256, asset]));
const selected = new Set();
const search = document.getElementById('search');
const source = document.getElementById('source');
const category = document.getElementById('category');
const status = document.getElementById('status');

/** 按搜索词、来源和分类筛选当前卡片，更新可见数量；只改变本地页面，不发送网络请求。 */
function updateFilter() {
  const words = search.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
  for (const card of cards) {
    const asset = assets.get(card.dataset.id);
    card.hidden = !words.every(word => card.dataset.search.toLowerCase().includes(word))
      || (source.value !== '' && !asset.sources.some(item => item.id === source.value))
      || (category.value !== '' && asset.category !== category.value);
  }
  status.textContent = '已收集 ' + cards.length + ' 张 · 当前显示 ' + cards.filter(card => !card.hidden).length + ' 张 · 已勾选 ' + selected.size + ' 张';
}

/** 同步单张卡片的勾选与内存状态，避免筛选后导出的清单和界面选择不一致。 */
function setSelected(card, checked) {
  card.querySelector('input[type="checkbox"]').checked = checked;
  card.classList.toggle('selected', checked);
  if (checked) selected.add(card.dataset.id);
  else selected.delete(card.dataset.id);
}

/** 记录图片实际尺寸；尺寸从本地图片读取，不信任来源页面的缩略图尺寸。 */
function showDimensions(event) {
  const image = event.target;
  image.closest('.card').querySelector('.dimensions').textContent = image.naturalWidth + ' × ' + image.naturalHeight;
}

/** 将已勾选素材的本地路径与原始来源下载成清单，方便手动挑选或交给后续官网美术调整。 */
function exportSelection() {
  const records = [...selected].map(id => assets.get(id));
  const url = URL.createObjectURL(new Blob([JSON.stringify({ selectedAt: new Date().toISOString(), assets: records }, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = '已选素材.json';
  link.click();
  URL.revokeObjectURL(url);
}

for (const card of cards) {
  /** 手动勾选后同步选择集合与计数，筛选隐藏卡片不丢失已选状态。 */
  card.querySelector('input[type="checkbox"]').addEventListener('change', event => { setSelected(card, event.target.checked); updateFilter(); });
  const image = card.querySelector('img');
  image.addEventListener('load', showDimensions);
  if (image.complete && image.naturalWidth) showDimensions({ target: image });
}
for (const control of [search, source, category]) control.addEventListener('input', updateFilter);
/** 切换本地预览背景，便于识别深色和透明装饰素材，不修改图片文件。 */
document.getElementById('background').addEventListener('change', event => { document.body.dataset.background = event.target.value; });
/** 只勾选当前筛选可见的图片，避免一键选择无关来源。 */
document.getElementById('selectVisible').addEventListener('click', () => { for (const card of cards) if (!card.hidden) setSelected(card, true); updateFilter(); });
/** 清空全部勾选，包括当前隐藏的卡片，保证导出清单与操作意图一致。 */
document.getElementById('clear').addEventListener('click', () => { for (const card of cards) setSelected(card, false); updateFilter(); });
document.getElementById('export').addEventListener('click', exportSelection);
updateFilter();
