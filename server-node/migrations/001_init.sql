-- DDT 本地服务端版 / 001 初始迁移
-- 设计要点：所有发奖、扣费、强化都在事务内完成；唯一约束防重复领取与请求重放。

CREATE TABLE IF NOT EXISTS players (
  id           TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  coins        INTEGER NOT NULL DEFAULT 0 CHECK (coins >= 0),
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);

-- 原版物品登记。TemplateID 来自 art-source/ITEM_XUANWU.md 对
-- 原版 TemplateAlllist.xml 的核对（上游 Gunny @ 057c71a 为物理/配置来源）。
-- 「神武石」未匹配项单独记录在 unmatched_items，不在此表编造。
CREATE TABLE IF NOT EXISTS item_catalog (
  item_key     TEXT PRIMARY KEY,
  template_id  INTEGER,
  name_zh      TEXT NOT NULL,
  name_source  TEXT,
  icon         TEXT NOT NULL,
  kind         TEXT NOT NULL,
  unit_value   INTEGER NOT NULL DEFAULT 1,
  note         TEXT
);

CREATE TABLE IF NOT EXISTS inventory (
  player_id  TEXT NOT NULL REFERENCES players(id),
  item_key   TEXT NOT NULL REFERENCES item_catalog(item_key),
  quantity   INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  PRIMARY KEY (player_id, item_key)
);

CREATE TABLE IF NOT EXISTS weapon_instances (
  id           TEXT PRIMARY KEY,
  player_id    TEXT NOT NULL REFERENCES players(id),
  weapon_id    TEXT NOT NULL,
  label        TEXT NOT NULL,
  level        INTEGER NOT NULL DEFAULT 0 CHECK (level >= 0),
  attack       INTEGER NOT NULL,
  version      INTEGER NOT NULL DEFAULT 0,
  equipped     INTEGER NOT NULL DEFAULT 0 CHECK (equipped IN (0, 1)),
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  UNIQUE (player_id, weapon_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_one_equipped_weapon
  ON weapon_instances(player_id) WHERE equipped = 1;

CREATE TABLE IF NOT EXISTS rooms (
  id                 TEXT PRIMARY KEY,
  player_id          TEXT NOT NULL UNIQUE REFERENCES players(id),
  map_id             TEXT NOT NULL,
  weapon_instance_id TEXT REFERENCES weapon_instances(id),
  status             TEXT NOT NULL DEFAULT 'idle',
  active_battle_id   TEXT,
  updated_at         INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS battles (
  id             TEXT PRIMARY KEY,
  player_id      TEXT NOT NULL REFERENCES players(id),
  room_id        TEXT NOT NULL REFERENCES rooms(id),
  map_id         TEXT NOT NULL,
  weapon_id      TEXT NOT NULL,
  weapon_level   INTEGER NOT NULL,
  weapon_attack  INTEGER NOT NULL,
  bot_attack     INTEGER NOT NULL,
  seed           INTEGER NOT NULL,
  status         TEXT NOT NULL,
  result         TEXT,
  winner         INTEGER,
  stats_json     TEXT,
  started_at     INTEGER NOT NULL,
  ended_at       INTEGER
);

CREATE TABLE IF NOT EXISTS reward_boards (
  id          TEXT PRIMARY KEY,
  battle_id   TEXT NOT NULL UNIQUE REFERENCES battles(id),
  player_id   TEXT NOT NULL REFERENCES players(id),
  cards_json  TEXT NOT NULL,
  max_picks   INTEGER NOT NULL DEFAULT 3,
  picks_used  INTEGER NOT NULL DEFAULT 0,
  status      TEXT NOT NULL DEFAULT 'open',
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

-- request_id UNIQUE：同一请求重试返回同一结果。
-- (board_id, card_index) UNIQUE：同一张卡不可能领两次。
CREATE TABLE IF NOT EXISTS reward_picks (
  id           TEXT PRIMARY KEY,
  board_id     TEXT NOT NULL REFERENCES reward_boards(id),
  card_index   INTEGER NOT NULL,
  request_id   TEXT NOT NULL UNIQUE,
  result_json  TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  UNIQUE (board_id, card_index)
);

CREATE TABLE IF NOT EXISTS forge_operations (
  id                  TEXT PRIMARY KEY,
  player_id           TEXT NOT NULL REFERENCES players(id),
  weapon_instance_id  TEXT NOT NULL REFERENCES weapon_instances(id),
  request_id          TEXT NOT NULL UNIQUE,
  level_before        INTEGER NOT NULL,
  level_after         INTEGER NOT NULL,
  success             INTEGER NOT NULL,
  coins_cost          INTEGER NOT NULL,
  items_json          TEXT NOT NULL,
  result_json         TEXT NOT NULL,
  created_at          INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS unmatched_items (
  query       TEXT PRIMARY KEY,
  status      TEXT NOT NULL,
  note        TEXT NOT NULL,
  checked_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS schema_migrations (
  version     INTEGER PRIMARY KEY,
  applied_at  INTEGER NOT NULL
);
