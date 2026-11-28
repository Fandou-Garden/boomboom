/** 测试辅助：以指定环境变量生成一盘奖励，用于对照 normal / test 奖励池，不修改任何存档。 */
import { config } from '../../server-node/src/config.js';
import { buildRewardCards } from '../../server-node/src/services.js';

const seed = Number(process.argv[2] || '12345');
const cards = buildRewardCards(seed, true);
console.log(JSON.stringify({
  poolMode: config.rewards.poolMode,
  poolVersion: config.rewards.poolVersion,
  extremeChance: config.rewards.extremeChance,
  cards,
}));
