/**
 * 服务端配置。所有数值集中在服务端，前端只提交操作意图。
 *
 * 交付规则（2026-11-28 用户授权简化）：
 *  - **原版素材 + 单机自定义强化规则**：界面 / 武器素材 / 动画 / 音效来自原版，
 *    强化算法是本项目自定的简单单机规则，不称为「原版强化算法」。
 *  - 原版强化链路的研究证据保留在 docs/RULE_EVIDENCE.md 与 original-data.ts，
 *    仅作存档，不参与运行时规则；不再追查缺失配置。
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

/**
 * 旧 LOCAL_RULE 每级追加的固定攻击点数，仅用于 004 迁移反推「未强化基础伤害」。
 * 新规则不再使用该值：一律从 base_attack 按倍率重算，避免旧加成叠加。
 */
export const LEGACY_ATTACK_PER_LEVEL = 25;

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
    /**
     * 单机保底规则（SINGLE_PLAYER_RULE）：盘面保证至少含 2 张材料卡，
     * 但 9 张卡在服务端整体随机洗牌后落位——**不是固定卡位**，
     * 玩家点固定位置不会必得固定奖励，也不存在「按领取次序」派发。
     * 保底只约束「盘面内容构成」，不约束「哪个位置是什么」。
     */
    guaranteedItemCards: 2,
    stoneChance: numEnv('DDT_REWARD_STONE_CHANCE', 0.34),
    /**
     * 正常奖励池的武器卡概率（**单机自定义掉率**，不代表任何官方概率）。
     * 武器使用已核实的上游名称与属性，标注「中文品质名称待核对」；
     * 不编造模板 / 属性 / 素材；已验证可正常装备与战斗。
     */
    weaponChance: numEnv('DDT_REWARD_WEAPON_CHANCE', 0.12),
    /** normal 为正常奖励池；test 为独立的测试奖励池，只用于自动化验证掉落。 */
    poolMode: (process.env.DDT_REWARD_POOL === 'test' ? 'test' : 'normal') as 'normal' | 'test',
    /** 奖励池配置版本：写入 reward_boards.pool_version，旧盘不因规则变更重抽。 */
    poolVersion: 'v4-2026-11-28-simple-forge',
    testPoolNote: '独立测试奖励池：强制包含 2 张金币卡、1 张真强化石卡、1 张武器卡（9 张整体洗牌，无固定卡位），仅用于自动化验证「翻牌 → 强化」闭环；赢局每张金币 ≥80，任选 2 张合计 ≥160，足以支付 +0→+1 的 100 金币。武器使用上游真实名称并标注「中文品质名称待核对」，不代表官方概率，也不改变正常掉落规则。',
    win: { coins: [80, 260] as [number, number], stoneAmount: [1, 2] as [number, number] },
    lose: { coins: [30, 90] as [number, number], stoneAmount: [1, 1] as [number, number] },
    /** 真正的原版强化石 Đá cường hóa 1..6（002 迁移登记），不再是四圣兽合成石。 */
    stoneItemKeys: ['strength1', 'strength2', 'strength3', 'strength4', 'strength5', 'strength6'],
    ruleSource: 'SINGLE_PLAYER_RULE',
    guaranteeNote: '保底只保证盘面至少含 2 张真强化石卡，9 张全部随机洗牌落位（单机保底规则），无固定卡位；旧奖励盘按生成时 pool_version 保留原结果。',
  },

  /**
   * 铁匠铺：统一采用「原版素材 + 单机自定义强化规则」（用户授权简化）。
   * 原版强化链路研究证据保留在 docs/RULE_EVIDENCE.md / original-data.ts，
   * 仅作存档，不参与运行时规则；不再追查缺失配置。
   */
  forge: {
    ruleSource: 'SIMPLE_LOCAL_V1',
    ruleLabel: '原版素材 + 单机自定义强化规则',
    /** 初始 +0，上限 +12。 */
    maxLevel: 12,
    /** 每次强化只消耗 1 颗已确认的真强化石；所有等级统一提供一次强化机会。 */
    stonesPerAttempt: 1,
    /** 金币消耗 = coinCostPerTargetLevel × 目标等级（+0→+1 扣 100，+11→+12 扣 1200）。 */
    coinCostPerTargetLevel: 100,
    /** 成功率 100%，每次等级 +1，不降级、不损毁。 */
    successRate: 1,
    levelGain: 1,
    downgrade: false,
    destroy: false,
    /**
     * 最终武器基础伤害 = 未强化基础伤害 × (1 + 0.10 × 强化等级)。
     * 始终从 base_attack 重算，禁止在已强化数值上叠乘；精度保留在
     * weapon_instances.attack_precise，最终伤害取整沿用现有战斗引擎。
     */
    attackMultiplierPerLevel: 0.10,
    /** 幸运符 / 神恩符不参与计算；物品保留，槽位置灰并说明原因。 */
    charmsEnabled: false,
    note: '每次 1 颗真强化石 + 100×目标等级金币，成功率 100%，等级 +1，不降级不损毁；基础伤害 = 未强化基础伤害 ×(1+0.10×等级)，只影响基础伤害，不改弹道/风力/爆炸/角度等属性。',
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
      guarantee: 'shuffled-pool',
      poolMode: config.rewards.poolMode,
      poolVersion: config.rewards.poolVersion,
      guaranteedStoneCards: config.rewards.guaranteedItemCards,
      weaponChance: config.rewards.weaponChance,
      weaponNameStatus: '中文品质名称待核对（使用已核实的上游名称与属性，不编造模板/素材）',
      weaponChanceNote: '正常奖励池的武器卡为单机自定义掉率，不代表官方概率；9 张整体洗牌，无固定卡位',
      note: '3x3 每场最多 3 张为单机可配置规则；保底只约束盘面内容，9 张随机洗牌落位，无固定卡位；旧奖励盘按生成时的 poolVersion 保留原结果',
    },
    forge: {
      ruleSource: config.forge.ruleSource,
      ruleLabel: config.forge.ruleLabel,
      maxLevel: config.forge.maxLevel,
      stonesPerAttempt: config.forge.stonesPerAttempt,
      coinCostPerTargetLevel: config.forge.coinCostPerTargetLevel,
      successRate: config.forge.successRate,
      levelGain: config.forge.levelGain,
      downgrade: config.forge.downgrade,
      destroy: config.forge.destroy,
      attackMultiplierPerLevel: config.forge.attackMultiplierPerLevel,
      charmsEnabled: config.forge.charmsEnabled,
      damageFormula: '最终基础伤害 = 未强化基础伤害 × (1 + 0.10 × 强化等级)',
      note: config.forge.note,
    },
  };
}
