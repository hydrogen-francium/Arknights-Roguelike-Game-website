import { sixStarOperators } from './six-star-operators.js';

/** 根据干员编号读取规则允许的目录项；编号不存在时直接抛错，避免无效指定被展示。 */
export function getSixStarOperator(operatorId) {
  const operator = sixStarOperators.find(item => item.id === operatorId);
  if (!operator) throw new Error('指定干员必须选择目录内的干员');
  return operator;
}

/** 校验队伍整届固定的指定、头像和公布状态；尚未选择时允许字段省略或为空。 */
export function validateEliteExplorer(team) {
  const explorer = team.eliteExplorer;
  // 未筹备完成的队伍允许不指定，不能制造虚构的干员选择。
  if (explorer === undefined || explorer === null) return;
  if (typeof explorer !== 'object' || Array.isArray(explorer)) throw new Error('队伍指定干员必须是对象或空值');
  getSixStarOperator(explorer.operatorId);
  if (typeof explorer.avatar !== 'string' || typeof explorer.published !== 'boolean') throw new Error('指定干员头像路径和公布状态无效');
}

/** 生成公开队伍对象，不修改原始数据；未公布时隐藏指定，公布时从目录派生干员名称。 */
export function projectEliteExplorer(team) {
  const { eliteExplorer, ...fields } = team;
  if (eliteExplorer?.published !== true) return { ...fields, eliteExplorer: null };
  const operator = getSixStarOperator(eliteExplorer.operatorId);
  return { ...fields, eliteExplorer: { ...eliteExplorer, name: operator.name } };
}
