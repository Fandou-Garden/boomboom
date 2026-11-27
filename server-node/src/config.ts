/**
 * 服务端配置。所有数值集中在服务端，前端只提交操作意图。
 *
 * 规则来源标注：
 *  - ORIGINAL：原版代码/配置可核对（本项目 reference/、art-source/ 已留档）。
 *  - LOCAL_RULE：未能导出原版配置时的「单机临时规则」，与原版规则分开配置，
 *    不冒称原版。见 docs/PROGRESS.md 与 README-SERVER.md。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(here, '../..');

/**
 * 轻量 .env 读取：只填充分缺失的变量，不覆盖已由 shell / 启动脚本注入的值。
 * 文件缺失时静默跳过（.env.example 只是样例）。不读取任何凭证类内容。
 */
function loadDotEnv(): void {
  const file = path.join(REPO_ROOT, '.env');
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    const key = match[1];
    if (process.env[key] !== undefined) continue;
    const value = match[2].trim().replace(/^['"]|['"]$/g, '');
    process.env[key] = value;
  }
}
loadDotEnv();

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}
function numEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

const dataDir = process.env.DDT_DATA_DIR || path.join(REPO_ROOT, 'data');

export const config = {
  host: process.env.DDT_HOST || '127.0.0.1',
  port: intEnv('DDT_PORT', 8100),
  distRoot: process.env.DDT_DIST_ROOT || path.join(REPO_ROOT, 'dist'),
  dataDir,
  dbPath: process.env.DDT_DB_PATH || path.join(dataDir, 'ddt.sqlite'),
  /** server 模式提供 /api/server/*；offline 时只保留现有 Go 契约（用于排障）。 */
  mode: (process.env.DDT_MODE === 'offline' ? 'offline' : 'server') as 'server' | 'offline',
  debug: process.env.DDT_DEBUG === '1',
  tickMs: intEnv('DDT_TICK_MS', 40),
  playerId: 'local-player',
  playerName: '本地玩家',

  /** 固定规则弱机器人：只在服务端执行，低攻击倍率，不使用必中或额外伤害。 */
  bot: {
    angle: numEnv('DDT_BOT_ANGLE', 42),
    force: numEnv('DDT_BOT_FORCE', 1180),
    /** attack 进入原版 MakeDamage 公式 (1 + attack*0.001)。 */
    attackScale: numEnv('DDT_BOT_ATTACK_SCALE', 0.35),
    /** 引擎默认 ENEMY_MOVE/THINK/AIM 秒数即为「固定等待一小段时间」。 */
    move: false,
    label: '固定弱机器人',
    ruleSource: 'LOCAL_RULE',
  },

  /**
   * 战后九宫格。3x3、每场最多 3 张为任务指定的单机可配置规则；
   * 原版各模式翻牌次数未能导出，不声称是所有原版模式的默认规则。
   */
  rewards: {
    cards: 9,
    maxPicks: 3,
    /** 保证至少 2 张材料卡，避免玩家因随机性卡在「无法强化」的闭环外。 */
    guaranteedItemCards: 2,
    stoneChance: numEnv('DDT_REWARD_STONE_CHANCE', 0.34),
    win: { coins: [80, 260] as [number, number], stoneAmount: [1, 2] as [number, number] },
    lose: { coins: [30, 90] as [number, number], stoneAmount: [1, 1] as [number, number] },
    /** 原版配置中存在的强化石等级/种类（item_key 见 001_init.sql 种子）。 */
    stoneItemKeys: ['xuanwu1', 'xuanwu2', 'xuanwu3', 'xuanwu4', 'xuanwu5'],
    ruleSource: 'LOCAL_RULE',
  },

  /**
   * 铁匠铺：原版 StrengthenMgr / StrengthenInfo 配置未能导出，
   * 以下为明确标注的单机临时规则，绝不冒称原版。
   */
  forge: {
    maxLevel: 12,
    /** 每级增加的原版 attack 属性点数，直接进入 MakeDamage 公式。 */
    attackPerLevel: 25,
    /** 首级消耗低于单张金币卡下限，保证「翻牌 -> 强化」单机闭环可完成。 */
    coinCostBase: 60,
    coinCostPerLevel: 80,
    itemCostBase: 1,
    itemCostPerLevel: 1,
    /** 0 级 -> 1 级必定成功，保证闭环可验证；之后按本地概率。 */
    firstLevelGuaranteed: true,
    successBase: 0.9,
    successPerLevel: 0.06,
    successMin: 0.35,
    /** 失败不降级；消耗照扣（本地规则）。 */
    failDowngrade: false,
    ruleSource: 'LOCAL_RULE',
  },
};

export type AppConfig = typeof config;

/** 供前端展示的规则摘要（不含任何可被前端用来决定结果的字段）。 */
export function publicRules() {
  return {
    mode: config.mode,
    bot: {
      label: config.bot.label,
      angle: config.bot.angle,
      force: config.bot.force,
      attackScale: config.bot.attackScale,
      ruleSource: config.bot.ruleSource,
    },
    rewards: {
      cards: config.rewards.cards,
      maxPicks: config.rewards.maxPicks,
      ruleSource: config.rewards.ruleSource,
      note: '3x3 每场最多 3 张为单机可配置规则，不代表原版所有模式默认值',
    },
    forge: {
      maxLevel: config.forge.maxLevel,
      attackPerLevel: config.forge.attackPerLevel,
      ruleSource: config.forge.ruleSource,
      note: '原版强化配置未导出，当前为单机临时规则，与原版规则分开配置',
    },
  };
}
