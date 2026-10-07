import { sixStarOperators } from './six-star-operators.js';

/** 根据干员编号读取六星目录项；编号不存在时直接抛错，避免无效指定被展示。 */
export function getSixStarOperator(operatorId) {
  const operator = sixStarOperators.find(item => item.id === operatorId);
  if (!operator) throw new Error('精英探索者必须选择目录内的六星干员');
  return operator;
}

/** 校验队伍整届固定指定与两赛段使用记录；未指定和未登记是允许的业务状态。 */
export function validateEliteExplorer(team) {
  const explorer = team.eliteExplorer;
  // 尚未确定指定时允许省略字段或明确置空，不把旧赛事数据误判为已指定。
  if (explorer !== undefined && explorer !== null) {
    if (typeof explorer !== 'object' || Array.isArray(explorer)) throw new Error('队伍精英探索者必须是对象或空值');
    getSixStarOperator(explorer.operatorId);
    if (typeof explorer.avatar !== 'string' || typeof explorer.published !== 'boolean') throw new Error('精英探索者头像路径和公布状态无效');
  }
  for (const player of team.players) {
    const usage = player.eliteExplorerUsage;
    // 未登记不等于未使用，因此缺少记录时不生成真假值。
    if (usage === undefined) continue;
    if (!usage || typeof usage !== 'object' || Array.isArray(usage)) throw new Error('精英探索者使用记录必须包含初赛和决赛状态');
    for (const stage of ['prelim', 'final']) {
      const used = usage[stage];
      if (used !== null && typeof used !== 'boolean') throw new Error('精英探索者使用状态只能为已使用、未使用或未登记');
      if (used === true && !explorer) throw new Error('队伍未指定精英探索者，不能登记选手已使用');
    }
  }
}

/** 生成供公开页面使用的队伍数据；未公布的指定和使用记录不进入响应，返回新对象。 */
export function projectEliteExplorer(team) {
  const { eliteExplorer, ...fields } = team;
  const published = eliteExplorer?.published === true;
  const players = team.players.map(player => {
    const { eliteExplorerUsage, ...playerFields } = player;
    return published ? { ...playerFields, eliteExplorerUsage } : playerFields;
  });
  if (!published) return { ...fields, eliteExplorer: null, players };
  const operator = getSixStarOperator(eliteExplorer.operatorId);
  return { ...fields, eliteExplorer: { ...eliteExplorer, name: operator.name }, players };
}
