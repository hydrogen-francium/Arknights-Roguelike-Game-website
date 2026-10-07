/** 读取已核对的明日方舟公开干员档案分页；返回带发现地址的条目，接口错误和页数超限立即抛出。 */
export async function readOfficialArchive(config, request) {
  const records = [];
  for (let page = 1; page <= config.maxPages; page += 1) {
    const url = new URL(config.url);
    url.searchParams.set('page', String(page));
    console.log('读取官方档案第 ' + page + ' 页：' + url.href);
    const response = await request(url.href);
    if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('官方档案响应不是 JSON：' + url.href);
    const body = await response.json();
    if (body.code !== 0 || !Array.isArray(body.data?.list) || typeof body.data.end !== 'boolean') throw new Error('官方档案响应不符合 code、data.list、data.end 契约：' + url.href);
    for (const item of body.data.list) {
      if (typeof item.name !== 'string' || !item.name.trim()) throw new Error('官方档案条目缺少名称：' + url.href);
      records.push({ page: url.href, item });
    }
    // 接口的 end 是已确认的结束信号；不能按条目数量猜测是否还有下一页。
    if (body.data.end) return records;
  }
  throw new Error('官方档案超过 maxPages，采集未完整，请检查来源或调整配置');
}
