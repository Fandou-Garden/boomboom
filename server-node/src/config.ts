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
import { ORIGINAL_CONSTANTS, ORIGINAL_RULE_TRACE } from './original-data.js';

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
 * 单机临时规则每级攻击点数。原版武器攻击成长公式未还原（见 original-data.ts），
 * 两套规则共用该点数，但 original 分支会在结果里明确标注为 LOCAL_RULE_SUPPLEMENT。
 */
const LOCAL_ATTACK_PER_LEVEL = 25;

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
     * 单机保底规则（LOCAL_RULE）：盘面保证至少含 2 张材料卡，
     * 但 9 张卡在服务端整体随机洗牌后落位——**不是固定卡位**，
     * 玩家点固定位置不会必得固定奖励，也不存在「按领取次序」派发。
     * 保底只约束「盘面内容构成」，不约束「哪个位置是什么」。
     */
    guaranteedItemCards: 2,
    stoneChance: numEnv('DDT_REWARD_STONE_CHANCE', 0.34),
    /**
     * 正常奖励池**不含**高阶品质武器候选。
     * 原因：上游越南服物品表无中文「极」命名，中文品质映射待确认，
     * 按验收要求不把推测武器加入正常掉落。默认 0，且仅 test 池可生成该卡。
     */
    extremeChance: 0,
    /** normal 为正常奖励池；test 为独立的测试奖励池，只用于自动化验证掉落。 */
    poolMode: (process.env.DDT_REWARD_POOL === 'test' ? 'test' : 'normal') as 'normal' | 'test',
    /** 奖励池配置版本：写入 reward_boards.pool_version，旧盘不因规则变更重抽。 */
    poolVersion: 'v3-2026-11-28',
    testPoolNote: '测试奖励池：强制包含 1 张「高阶品质武器候选」卡，仅用于自动化验证发放防重；中文品质映射待确认，不代表任何官方概率，也不改变正常掉落规则。',
    win: { coins: [80, 260] as [number, number], stoneAmount: [1, 2] as [number, number] },
    lose: { coins: [30, 90] as [number, number], stoneAmount: [1, 1] as [number, number] },
    /** 真正的原版强化石 Đá cường hóa 1..6（002 迁移登记），不再是四圣兽合成石。 */
    stoneItemKeys: ['strength1', 'strength2', 'strength3', 'strength4', 'strength5', 'strength6'],
    ruleSource: 'LOCAL_RULE',
    guaranteeNote: '前若干张固定构成的设计已移除；保底只保证盘面至少含 2 张材料卡，9 张全部随机洗牌落位（单机保底规则）。',
  },

  /**
   * 铁匠铺：原版规则与单机临时规则分开配置。
   *  - rules='original'：按 ItemStrengthenHandler / StrengthenMgr / ItemStrengthenList.xml
   *    移植的核心链路（三强化石槽 + 幸运符 + 神恩符 + 概率 + 等级上限 + 失败后果）。
   *  - rules='local'：闭合稳定的单机临时规则，保留供对比与回归。
   * 两套规则共用同一张存档表，历史装备数据由 002/003 迁移兼容。
   */
  forge: {
    /**
     * 默认 LOCAL_RULE：原版完整链路尚未还原（属性计算未找到、模板进阶/损毁/VIP/公会/开孔未接线），
     * 按验收要求不能默认启用并报告「原版强化完成」。设置 DDT_FORGE_RULES=original 时才走
     * 已核对的原版核心链路（ORIGINAL_PARTIAL），两套规则分开、界面明确显示当前采用哪套。
     */
    rules: (process.env.DDT_FORGE_RULES === 'original' ? 'original' : 'local') as 'original' | 'local',
    /**
     * 可注入随机源，仅用于自动化测试精确控制成功/失败，不靠反复运行碰概率。
     * 支持：always-success | always-fail | fixed:<0..1> | sequence:a,b,c；未设置时用单局种子。
     */
    randomSource: process.env.DDT_FORGE_RANDOM || '',
    original: {
      maxLevel: ORIGINAL_CONSTANTS.maxStrengthenLevel,
      /**
       * 原版武器攻击成长公式**未还原**（ORIGINAL_CONSTANTS.weaponAttackGrowth=null）：
       * itemstrengthendata.xml 只含副手 17003/17004，ItemStrengthenData.xml 在仓库中不存在；
       * 真正计算在 EquipBag.UpdatePlayerProperties()，本轮未导出。
       * 为让「强化后下一局属性生效」可验证，此处借用 LOCAL_RULE 的点数，
       * 并在结果中标记 attackGrowthSource='LOCAL_RULE_SUPPLEMENT'，不声称是原版数值。
       */
      attackPerLevel: LOCAL_ATTACK_PER_LEVEL,
      ruleSource: 'ORIGINAL_PARTIAL',
      note: '核心链路（三强化石槽/幸运符/神恩符/概率/等级表/失败保护）已按源码移植；属性成长未还原、进阶换模板/损毁/VIP/公会/开孔/绑定未接线。标记为 PARTIAL，不报告「原版强化完成」。',
    },
    /** 以下为 LOCAL_RULE，默认生效。 */
    maxLevel: 12,
    /** 每级增加的 attack 属性点数，直接进入 MakeDamage 公式。 */
    attackPerLevel: LOCAL_ATTACK_PER_LEVEL,
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
      guarantee: 'shuffled-pool',
      poolMode: config.rewards.poolMode,
      poolVersion: config.rewards.poolVersion,
      extremeChance: config.rewards.extremeChance,
      weaponMappingStatus: 'UNCONFIRMED',
      extremeChanceNote: '正常奖励池不含高阶品质武器候选：上游无中文「极」命名，中文品质映射待确认；仅测试池可生成，且不代表官方概率',
      note: '3x3 每场最多 3 张为单机可配置规则；保底只约束盘面内容，9 张随机洗牌落位，无固定卡位；旧奖励盘按生成时的 poolVersion 保留原结果',
    },
    forge: {
      rules: config.forge.rules,
      maxLevel: config.forge.rules === 'original' ? config.forge.original.maxLevel : config.forge.maxLevel,
      attackPerLevel: config.forge.rules === 'original' ? config.forge.original.attackPerLevel : config.forge.attackPerLevel,
      ruleSource: config.forge.rules === 'original' ? config.forge.original.ruleSource : config.forge.ruleSource,
      attackGrowthSource: config.forge.rules === 'original' ? 'LOCAL_RULE_SUPPLEMENT（原版属性成长未还原）' : 'LOCAL_RULE',
      notPorted: config.forge.rules === 'original'
        ? ORIGINAL_RULE_TRACE.filter((r) => r.status !== 'PORTED').map((r) => `${r.item}: ${r.status}`)
        : [],
      mechanics: config.forge.rules === 'original' ? ORIGINAL_RULE_TRACE : [],
      note: config.forge.rules === 'original' ? config.forge.original.note : '单机临时规则（LOCAL_RULE），与原版规则分开配置；不代表原版成功率与消耗',
    },
  };
}
