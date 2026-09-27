/** 记录游戏结局名称与官网规则分类之间的对应关系。 */
export const endingRuleTypes = { 痛苦将息: '一结局', 畸症: '二结局', 混沌源阶理论: '三结局', 五层追猎: '五层追猎', 六层追猎: '六层追猎' };

/** 记录各个已约定结局的额外分值。 */
export const endingRulePoints = { 痛苦将息: 80, 畸症: 150, 混沌源阶理论: 150, 五层追猎: 160, 六层追猎: 160 };

/** 根据选手的分队名称返回相应倍率。 */
export function getMultiplier(player) {
  if (player.multiplier === '文明开化') return 1.12;
  if (player.multiplier === '多边贸易') return 0.88;
  if (['开拓者', '地质调查'].includes(player.multiplier)) return 0.95;
  return 1;
}

/** 汇总基础分、分队倍率、队伍奖励、规则项目和结局奖励。 */
export function getScoreComponents(player, stage) {
  const base = player[stage];
  const multiplierDelta = Math.round(base * getMultiplier(player)) - base;
  const squadBonus = player.squad === '矛头分队' ? 100 : 0;
  const ruleItems = player.scoreItems || [];
  const endingItems = player.endings.map(ending => ({ category: '结局加分', rule: `${endingRuleTypes[ending] || '结局'}（${ending}）`, points: endingRulePoints[ending] || 0 }));
  const deductions = player.deductions || [];
  const extraTotal = [...ruleItems, ...endingItems, ...deductions].reduce((sum, item) => sum + item.points, 0);
  return { base, multiplierDelta, squadBonus, ruleItems, endingItems, deductions, total: base + multiplierDelta + squadBonus + extraTotal };
}

/** 返回指定选手和赛段按照统一规则计算后的最终得分。 */
export function calculatePlayerScore(player, stage) {
  return getScoreComponents(player, stage).total;
}
