/**
 * 服务端版 UI 层：个人房间、房间内铁匠铺、战后九宫格翻牌接入。
 *
 * 这不是第二套前端：战斗画面、HUD、Canvas 渲染、手机横屏控件全部沿用
 * 现有 dist/ 站点版。本文件只叠加房间/铁匠铺覆盖层，并把结算翻牌切到
 * 统一数据访问接口 dataApi 的 server 实现。
 *
 * 素材说明：
 *  - 房间背景 / 角色 / 地图框 / 结算卡片：均为仓库已导出的原版 room.swf、
 *    gameover.swf 素材（dist/assets/ui/、dist/assets/map-*-thumb.jpg）。
 *  - 铁匠铺：阶段 9 起使用旧版对照库 store.swf 导出的原版红金色素材
 *    （dist/assets/forge/），按 store.xml 的 Strengthpoint0..5 点位摆放
 *    **真实 DOM 槽位**，支持点选 / 拖放，背景图不覆盖任何交互。
 *    界面素材为原版，但强化规则另由服务端规则版本决定（LOCAL_RULE /
 *    ORIGINAL_PARTIAL），界面明确标注，不冒充「原版强化规则已还原」。
 */
import { dataApi } from './data-api.js?v=33';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);

const state = {
  layer: null,
  room: null,
  forge: null,
  currentBattleId: null,
  selectedForgeWeapon: null,
  selectedForgeItem: '',
  /** 原版 StoreBag 槽位 0/1/2 强化石、3 神恩符、4 幸运符、5 待强化装备。 */
  forgeSlots: [null, null, null, null, null, null],
  activeSlot: null,
  forgeResult: null,
  cardTimer: 0,
  forgeOpen: false,
};

function esc(text) {
  return String(text ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function fmt(n) { return Number(n || 0).toLocaleString('zh-CN'); }

function stoneTotal(wallet) {
  return (wallet?.items || []).reduce((sum, i) => sum + Number(i.quantity || 0), 0);
}

/** 顶部钱包 chip 始终显示服务端余额（刷新/重启后一致）。 */
export function paintWalletChips(wallet) {
  if (!wallet) return;
  const coins = $('walletCoins');
  const stones = $('walletStones');
  const coinCount = Number(wallet.coins || 0);
  const stoneCount = stoneTotal(wallet);
  if (coins) coins.textContent = fmt(coinCount);
  if (stones) stones.textContent = fmt(stoneCount);
  $('walletCoinsChip')?.setAttribute('aria-label', `金币 ${coinCount}`);
  $('walletStonesChip')?.setAttribute('aria-label', `材料 ${stoneCount}`);
  dataApi.wallet = wallet;
}

function buildLayer() {
  const layer = document.createElement('div');
  layer.id = 'ddtServerLayer';
  layer.className = 'ddt-layer';
  layer.innerHTML = `
    <section class="ddt-room" id="ddtRoom" aria-label="个人房间">
      <img class="ddt-room-bg" src="assets/ui/load-bg.jpg?v=33" alt="" draggable="false">
      <div class="ddt-room-shade"></div>
      <header class="ddt-room-head">
        <div>
          <h1>个人房间 <span class="ddt-badge">服务端版</span></h1>
          <p>原版 room.swf 背景素材 · 房间布局为服务端版新增（非原版房间界面）</p>
        </div>
        <div class="ddt-wallet" id="ddtWallet"></div>
      </header>
      <div class="ddt-room-grid">
        <section class="ddt-panel ddt-player-panel">
          <div class="ddt-portrait">
            <img class="ddt-portrait-bg" src="assets/ui/load-char-blue.png?v=33" alt="" draggable="false">
            <img class="ddt-portrait-figure" src="assets/ui/hero-figure.png?v=33" alt="玩家角色" draggable="false">
          </div>
          <h2 id="ddtPlayerName">本地玩家</h2>
          <div class="ddt-equipped" id="ddtEquipped"></div>
          <div class="ddt-materials" id="ddtMaterials"></div>
        </section>
        <section class="ddt-panel ddt-map-panel">
          <div class="ddt-panel-title"><img src="assets/ui/load-field.png?v=33" alt=""><span>选择地图</span></div>
          <div class="ddt-map-grid" id="ddtMapGrid"></div>
          <p class="ddt-hint">点击地图后按需加载该地图资源；其余地图仅显示缩略图。</p>
        </section>
        <section class="ddt-panel ddt-action-panel">
          <div class="ddt-bot" id="ddtBot"></div>
          <div class="ddt-weapon-list" id="ddtWeaponList"></div>
          <div class="ddt-actions">
            <button class="ddt-btn ddt-btn-forge" type="button" data-action="open-forge">铁匠铺 · 强化武器</button>
            <button class="ddt-btn ddt-btn-continue" type="button" data-action="continue-cards" hidden>继续翻牌</button>
            <button class="ddt-btn ddt-btn-start" type="button" data-action="start-battle">开始战斗</button>
          </div>
          <p class="ddt-status" id="ddtStatus"></p>
        </section>
      </div>
    </section>

    <section class="ddt-forge" id="ddtForge" aria-label="铁匠铺" hidden>
      <div class="ddt-forge-frame" data-asset-slot="forge-panel">
        <header class="ddt-forge-head">
          <div><h2>铁匠铺 · 武器强化</h2>
            <p class="ddt-asset-note">原版 store.swf 红金色素材 · 槽位/按钮为真实可交互 DOM · 规则版本见下方，不代表原版强化规则已还原</p></div>
          <div class="ddt-forge-head-actions">
            <button class="ddt-btn ddt-btn-ghost" type="button" data-action="forge-volume" data-volume="0.12">音量 低</button>
            <button class="ddt-btn ddt-btn-ghost" type="button" data-action="forge-volume" data-volume="0.22">音量 中</button>
            <button class="ddt-btn ddt-btn-ghost" type="button" data-action="forge-volume" data-volume="0">静音</button>
            <button class="ddt-btn ddt-btn-ghost" type="button" data-action="close-forge">关闭，返回房间</button>
          </div>
        </header>
        <div class="ddt-forge-rule-top" id="ddtForgeRuleTop"></div>
        <div class="ddt-forge-body">
          <div class="ddt-strength-stage" id="ddtStrengthStage">
            <img class="ddt-strength-bg" src="assets/forge/store-strength-bg.jpg?v=34" alt="原版强化台背景" draggable="false">
            <div class="ddt-strength-cells" id="ddtStrengthCells"></div>
            <div class="ddt-success-rate" id="ddtSuccessRate"></div>
            <button class="ddt-strength-btn" type="button" data-action="strengthen" id="ddtStrengthBtn"
                    aria-label="确认强化" title="确认强化（原版 store.StrengthBtn）">
              <img src="assets/forge/btn-strength.png?v=34" alt="">
            </button>
            <div class="ddt-forge-result-art" id="ddtForgeResultArt" hidden></div>
          </div>
          <aside class="ddt-forge-side">
            <div class="ddt-forge-col">
              <h3><img src="assets/forge/tab-equip.png?v=34" alt="">装备栏（点击放入 5 号槽）</h3>
              <div class="ddt-forge-weapons" id="ddtForgeWeapons"></div>
            </div>
            <div class="ddt-forge-col">
              <h3><img src="assets/forge/tab-prop.png?v=34" alt="">道具栏（点击放入选中槽 / 拖到槽位）</h3>
              <div class="ddt-forge-bag" id="ddtForgeBag"></div>
            </div>
            <div class="ddt-forge-col ddt-forge-detail">
              <h3>强化预览</h3>
              <div id="ddtForgeDetail"></div>
              <div class="ddt-forge-rule" id="ddtForgeRule"></div>
            </div>
          </aside>
        </div>
        <p class="ddt-forge-result" id="ddtForgeResult"></p>
      </div>
    </section>
  `;
  document.body.appendChild(layer);
  state.layer = layer;
  layer.addEventListener('click', onLayerClick);
  // 原版 StoreDragInArea / DragManager：道具栏可拖放到槽位。
  layer.addEventListener('dragstart', (event) => {
    const item = event.target.closest('[data-action="forge-bag-item"], [data-action="forge-weapon"]');
    if (!item || item.disabled) { event.preventDefault(); return; }
    const payload = item.dataset.action === 'forge-weapon'
      ? { kind: 'weapon', key: item.dataset.weapon }
      : { kind: item.dataset.kind, key: item.dataset.item };
    event.dataTransfer.setData('text/plain', JSON.stringify(payload));
    event.dataTransfer.effectAllowed = 'move';
  });
  layer.addEventListener('dragover', (event) => {
    const slot = event.target.closest('.ddt-slot');
    if (!slot) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    slot.classList.add('is-drop-target');
  });
  layer.addEventListener('dragleave', (event) => {
    event.target.closest('.ddt-slot')?.classList.remove('is-drop-target');
  });
  layer.addEventListener('drop', (event) => {
    const slotEl = event.target.closest('.ddt-slot');
    if (!slotEl) return;
    event.preventDefault();
    slotEl.classList.remove('is-drop-target');
    let payload;
    try { payload = JSON.parse(event.dataTransfer.getData('text/plain')); } catch { return; }
    const index = Number(slotEl.dataset.slot);
    if (!slotAccepts(index, payload.kind)) {
      setStatus('该道具不能放入此槽位（槽位类型不匹配）', true);
      return;
    }
    if (!placeIntoS(index, payload.key, state.forge)) {
      setStatus('放入槽位失败', true);
      return;
    }
    if (payload.kind === 'weapon') state.selectedForgeWeapon = payload.key;
    setStatus(`已拖入 ${SLOT_LAYOUT[index].label}：${payload.key}`);
  });
}

function renderRoom(room) {
  if (!room) return;
  state.room = room;
  paintWalletChips(room.wallet);
  $('ddtPlayerName').textContent = room.playerName || '本地玩家';

  $('ddtWallet').innerHTML = `
    <span class="ddt-chip"><img src="assets/ui/icon-gold.png?v=33" alt=""><b>${fmt(room.wallet.coins)}</b><small>金币</small></span>
    <span class="ddt-chip"><img src="assets/ui/icon-stones.png?v=33" alt=""><b>${fmt(stoneTotal(room.wallet))}</b><small>材料</small></span>`;

  $('ddtEquipped').innerHTML = `
    <div class="ddt-label">当前武器</div>
    <div class="ddt-equipped-name">${esc(room.equipped.label)} <span>+${room.equipped.level}</span></div>
    <div class="ddt-attr">攻击 ${fmt(room.equipped.attack)} · 强化等级 ${room.equipped.level}</div>`;

  $('ddtMaterials').innerHTML = `
    <div class="ddt-label">主要材料</div>
    <div class="ddt-mat-row">${room.wallet.items.map((i) => `
      <span class="ddt-mat" title="TemplateID ${i.templateId ?? '—'}">
        <img src="${esc(i.icon)}?v=33" alt="" draggable="false"><b>${fmt(i.quantity)}</b><small>${esc(i.name)}</small>
      </span>`).join('')}</div>`;

  $('ddtMapGrid').innerHTML = room.maps.map((m) => `
    <button class="ddt-map ${m.id === room.mapId ? 'is-active' : ''}" type="button"
            data-action="map" data-map="${esc(m.id)}" aria-label="选择地图 ${esc(m.name)}">
      <img src="${esc(m.thumb)}?v=33" alt="" loading="lazy" draggable="false">
      <span>${esc(m.name)}</span><small>${esc(m.trait)}</small>
    </button>`).join('');

  $('ddtBot').innerHTML = `
    <div class="ddt-label">弱机器人（服务端固定规则）</div>
    <div class="ddt-bot-row"><img src="assets/ui/load-char-red.png?v=33" alt="" draggable="false">
      <div><b>${esc(room.bot.label)}</b><small>角度 ${room.bot.angle}° · 力度 ${room.bot.force} · 攻击倍率 ${room.bot.attackScale}</small>
      <small>不接大模型 · 无必中与额外伤害</small></div></div>`;

  $('ddtWeaponList').innerHTML = `
    <div class="ddt-label">房间内选择武器</div>
    <div class="ddt-weapon-row">${room.weapons.map((w) => `
      <button class="ddt-weapon ${w.equipped ? 'is-active' : ''}" type="button"
              data-action="weapon" data-weapon="${esc(w.id)}" title="${esc(w.label)} 强化 +${w.level}">
        ${esc(w.label)}<small>+${w.level}</small></button>`).join('')}</div>`;

  const continueBtn = state.layer.querySelector('[data-action="continue-cards"]');
  if (continueBtn) {
    const pending = room.pendingReward;
    continueBtn.hidden = !pending || pending.picksUsed >= pending.maxPicks;
    if (pending) continueBtn.textContent = `继续翻牌（${pending.picksUsed}/${pending.maxPicks}）`;
  }
  $('ddtStatus').textContent = room.status === 'result' && room.pendingReward
    ? '上一局奖励尚未翻完，回房间后可继续领取'
    : `当前地图：${esc(room.mapName)} · ${room.maps.length} 张可选`;
}

/**
 * store.xml:215-220 的 Strengthpoint0..5（相对 StoreIIStrengthBG x=65 y=30）。
 * 0/1/2 强化石、3 神恩符、4 幸运符、5 待强化装备 —— 与
 * StoreIIStrengthBG.as:133-158 的 StoreCell 创建顺序完全一致。
 * 坐标是原版实测值，不是按截图目测摆放。
 */
const SLOT_LAYOUT = [
  { index: 0, x: 106, y: -6, kind: 'strength-stone', label: '强化石 1', frame: 'slot-strength.png' },
  { index: 1, x: 206, y: 95, kind: 'strength-stone', label: '强化石 2', frame: 'slot-strength.png' },
  { index: 2, x: 106, y: 195, kind: 'strength-stone', label: '强化石 3', frame: 'slot-strength.png' },
  { index: 3, x: 6, y: 141, kind: 'god-charm', label: '神恩符', frame: 'slot-god.png' },
  { index: 4, x: 6, y: 49, kind: 'lucky-charm', label: '幸运符', frame: 'slot-lucky.png' },
  { index: 5, x: 123, y: 111, kind: 'weapon', label: '待强化装备', frame: 'slot-equip.png' },
];

/** 把 forge.materials 的 rate/property2 等原版字段并回钱包条目。 */
function forgeItemLookup(forge) {
  const m = forge.materials || {};
  const decorated = [
    ...(m.strengthStones || []), ...(m.luckyCharms || []),
    ...(m.godCharms || []), ...(m.composeStones || []),
  ];
  const byKey = new Map(decorated.map((i) => [i.itemKey, i]));
  return (key) => {
    const base = (forge.wallet?.items || []).find((i) => i.itemKey === key);
    return base ? { ...base, ...(byKey.get(key) || {}) } : null;
  };
}

function slotAccepts(index, kind) {
  return SLOT_LAYOUT[index]?.kind === kind;
}

function placeIntoS(index, key, forge) {
  if (!forge || !key) return false;
  const item = forgeItemLookup(forge)(key);
  if (item && !slotAccepts(index, item.kind)) return false;
  state.forgeSlots[index] = key;
  state.activeSlot = null;
  renderForge(forge);
  return true;
}

function renderSlots(forge) {
  const get = forgeItemLookup(forge);
  $('ddtStrengthCells').innerHTML = SLOT_LAYOUT.map((s) => {
    const val = state.forgeSlots[s.index];
    let inner = '<span class="ddt-slot-empty">空</span>';
    if (val && s.kind === 'weapon') {
      const w = forge.weapons.find((x) => x.id === val);
      inner = `<span class="ddt-slot-weapon">${esc(w?.label || '装备')}<small>+${w?.level ?? 0}</small></span>`;
    } else if (val) {
      const item = get(val);
      if (item) inner = `<img src="${esc(item.icon)}?v=34" alt=""><span>${esc(item.name)}</span>`;
    }
    return `<button class="ddt-slot ${val ? 'is-filled' : ''} ${state.activeSlot === s.index ? 'is-active' : ''}"
        type="button" data-action="forge-slot" data-slot="${s.index}" data-accept="${s.kind}"
        style="--sx:${s.x}px;--sy:${s.y}px"
        title="${esc(s.label)} · store.xml Strengthpoint${s.index} (${s.x}, ${s.y})"
        aria-label="${esc(s.label)}${val ? '（已放入，点击移除）' : '（点击选中后可放入道具）'}">
        <img class="ddt-slot-frame" src="assets/forge/${s.frame}?v=34" alt="" draggable="false">
        <span class="ddt-slot-content">${inner}</span>
        <span class="ddt-slot-tag">${esc(s.label)}</span>
      </button>`;
  }).join('');
}

function renderBag(forge) {
  const compose = (i) => i.kind === 'compose-stone';
  $('ddtForgeBag').innerHTML = (forge.wallet.items || []).map((i) => `
    <button class="ddt-bag-item ${compose(i) ? 'is-compose' : ''}" type="button"
            data-action="forge-bag-item" data-item="${esc(i.itemKey)}" data-kind="${esc(i.kind)}"
            draggable="${compose(i) ? 'false' : 'true'}" ${compose(i) ? 'disabled' : ''}
            title="${esc(i.name)} · TemplateID ${i.templateId ?? '—'} · ${esc(i.kind)}${compose(i) ? ' · 合成石，不能作为强化材料' : ''}">
      <img src="${esc(i.icon)}?v=34" alt="" draggable="false"><b>${fmt(i.quantity)}</b>
      <small>${compose(i) ? '合成石' : esc(i.name)}</small>
    </button>`).join('');
}

function renderSuccessRate(forge, weapon) {
  const isOriginal = forge.rules === 'original';
  let headline;
  let detail;
  if (isOriginal) {
    const get = forgeItemLookup(forge);
    const stones = state.forgeSlots.slice(0, 3).filter(Boolean).map(get).filter(Boolean);
    const probability = stones.reduce((sum, i) => sum + Number(i.rate || 0), 0);
    const lucky = state.forgeSlots[4] ? get(state.forgeSlots[4]) : null;
    // 与 services.ts originalRuleFor() 同公式：C# 整数除法 property2/100。
    const num2 = lucky ? probability + Math.trunc(Number(lucky.property2 || 0) / 100) : 0;
    const rock = Number(weapon?.cost?.rock
      || (forge.levelTable || []).find((r) => r.level === Number(weapon?.level || 0) + 1)?.rock || 0);
    const pct = rock ? Math.min(100, Math.max(0, (probability + num2) / rock * 100)) : 0;
    headline = `${pct.toFixed(1)}%`;
    detail = `材料 ${fmt(probability)} + 幸运 ${fmt(num2)} / Rock ${fmt(rock)} · 服务端同公式预览`;
  } else {
    headline = `${Math.round(Number(weapon?.cost?.successRate || 0) * 100)}%`;
    detail = `LOCAL_RULE 固定成功率 · 金币 ${fmt(weapon?.cost?.coins || 0)}`;
  }
  $('ddtSuccessRate').innerHTML = `
    <img src="assets/forge/rate-label.png?v=34" alt="">
    <div class="ddt-rate-body"><span>成功率</span><b>${headline}</b><small>${esc(detail)}</small></div>`;
}

function renderForge(forge) {
  if (!forge) return;
  state.forge = forge;
  paintWalletChips(forge.wallet);
  const selectedId = state.forgeSlots[5] || state.selectedForgeWeapon
    || forge.weapons.find((w) => w.equipped)?.id || forge.weapons[0]?.id;
  state.selectedForgeWeapon = selectedId;
  // 装备槽默认显示当前选中的武器（真实槽位，不是文字说明）。
  if (!state.forgeSlots[5] && selectedId) state.forgeSlots[5] = selectedId;
  const weapon = forge.weapons.find((w) => w.id === state.forgeSlots[5]) || forge.weapons[0];

  $('ddtForgeWeapons').innerHTML = forge.weapons.map((w) => `
    <button class="ddt-forge-weapon ${w.id === state.forgeSlots[5] ? 'is-active' : ''}" type="button"
            data-action="forge-weapon" data-weapon="${esc(w.id)}" draggable="true">
      <span>${esc(w.label)}</span><small>+${w.level} · 攻击 ${fmt(w.attack)}</small>
    </button>`).join('');

  renderSlots(forge);
  renderBag(forge);
  renderSuccessRate(forge, weapon);

  const isOriginal = forge.rules === 'original';
  const unported = forge.notPorted || [];
  $('ddtForgeRuleTop').innerHTML = `
    <b>当前规则：${esc(forge.activeRuleLabel || forge.ruleSource)}</b>
    <span> · 规则来源 ${esc(forge.ruleSource)}</span>
    <span> · 属性成长 ${esc(forge.attackGrowthSource || '—')}</span>
    ${unported.length ? `<span> · 未还原/未接线 ${unported.length} 项（详见下方）</span>` : ''}
    <span> · 武器映射 ${esc(forge.weaponMappingStatus || '—')}</span>`;
  $('ddtForgeRule').innerHTML = `
    <div class="ddt-label">规则证据（不是原版强化已完成）</div>
    <p>${esc(forge.ruleNote)}</p>
    <p class="ddt-hint">属性成长来源：${esc(forge.attackGrowthSource || '—')}</p>
    ${unported.length ? `<p class="ddt-hint">未还原 / 未接线：${esc(unported.join('、'))}</p>` : ''}
    ${forge.weaponMappingStatus ? `<p class="ddt-hint">武器映射：${esc(forge.weaponMappingStatus)}</p>` : ''}
    ${forge.composeStoneNote ? `<p class="ddt-hint">${esc(forge.composeStoneNote)}</p>` : ''}
    ${isOriginal ? '<p class="ddt-hint">原版链路不扣金币，只消耗槽位材料（ItemStrengthenHandler.cs:113）。三强化石槽 + 幸运符 + 神恩符由服务端校验。</p>' : ''}
    <p class="ddt-asset-note">界面素材来自旧版对照库 store.swf（见 docs/FORGE_UI_EVIDENCE.md）；槽位与按钮为真实 DOM，原版强化规则仍未还原完成。</p>`;

  if (weapon) {
    const cost = weapon.cost;
    $('ddtForgeDetail').innerHTML = `
      <div class="ddt-detail-name">${esc(weapon.label)}</div>
      <dl>
        <dt>当前等级</dt><dd>+${weapon.level}</dd>
        <dt>当前攻击</dt><dd>${fmt(weapon.attack)}</dd>
        <dt>强化后攻击</dt><dd class="is-good">${fmt(cost.nextAttack)}（成功时）</dd>
        <dt>消耗金币</dt><dd>${fmt(cost.coins)}</dd>
        <dt>材料要求</dt><dd>${isOriginal ? `${fmt(cost.requiredUnits)} 个槽位（1~3 颗强化石，Rock ${fmt(cost.rock ?? 0)}）` : `${fmt(cost.requiredUnits)} 点`}</dd>
        <dt>上限</dt><dd>+${weapon.maxLevel}</dd>
        <dt>规则版本</dt><dd>${esc(weapon.ruleVersion || 'LOCAL_RULE')}</dd>
      </dl>`;
  }
  const btn = $('ddtStrengthBtn');
  if (btn) btn.disabled = !weapon?.canStrengthen;
}

async function onLayerClick(event) {
  const target = event.target.closest('[data-action]');
  if (!target) return;
  const action = target.dataset.action;
  try {
    if (action === 'map') {
      const mapId = target.dataset.map;
      await dataApi.setMap(mapId);
      // 站点版显示层按 ?map= 加载资源，整页重载让前后端地图一致。
      const next = new URL(location.href);
      next.searchParams.set('map', mapId);
      next.searchParams.set('mode', 'server');
      location.assign(next.href);
      return;
    }
    if (action === 'weapon') {
      renderRoom(await dataApi.equipWeapon(target.dataset.weapon));
      return;
    }
    if (action === 'open-forge') {
      state.forgeOpen = true;
      $('ddtRoom').hidden = true;
      $('ddtForge').hidden = false;
      // 原版 BaseStoreView 进商店 pauseMusic()，没有独立铁匠铺 BGM。
      window.__GUNNY_HOOKS__?.audioPause?.();
      renderForge(await dataApi.getForge());
      return;
    }
    if (action === 'close-forge') {
      // 关闭后回到同一个房间，不重建房间、不丢失选择。
      state.forgeOpen = false;
      $('ddtForge').hidden = true;
      $('ddtRoom').hidden = false;
      window.__GUNNY_HOOKS__?.audioResume?.();
      renderRoom(await dataApi.getRoom());
      return;
    }
    if (action === 'forge-weapon') {
      // 装备栏点击 = 放入 5 号槽（原版 StreangthItemCell）。
      state.selectedForgeWeapon = target.dataset.weapon;
      state.forgeSlots[5] = target.dataset.weapon;
      renderForge(state.forge);
      return;
    }
    if (action === 'forge-slot') {
      const index = Number(target.dataset.slot);
      if (state.forgeSlots[index]) {
        state.forgeSlots[index] = null; // 已放入 -> 点击移除
      } else {
        state.activeSlot = state.activeSlot === index ? null : index;
      }
      renderForge(state.forge);
      return;
    }
    if (action === 'forge-bag-item') {
      const key = target.dataset.item;
      const kind = target.dataset.kind;
      let slot = state.activeSlot;
      if (slot == null || !slotAccepts(slot, kind)) {
        slot = SLOT_LAYOUT.findIndex((s) => s.index < 5 && s.kind === kind && !state.forgeSlots[s.index]);
      }
      if (slot >= 0 && placeIntoS(slot, key, state.forge)) {
        setStatus(`已放入 ${SLOT_LAYOUT[slot].label}：${key}`);
      } else {
        setStatus('该道具不能放入当前槽位（合成石不可用于强化）', true);
      }
      return;
    }
    if (action === 'forge-volume') {
      const v = Number(target.dataset.volume);
      window.__GUNNY_HOOKS__?.audioVolume?.(v);
      setStatus(v === 0 ? '背景音乐已静音' : `背景音乐音量 ${Math.round(v * 100)}%`);
      return;
    }
    if (action === 'strengthen') {
      await doStrengthen(target);
      return;
    }
    if (action === 'start-battle') {
      await startBattle(target);
      return;
    }
    if (action === 'continue-cards') {
      await reopenSettlement();
      return;
    }
  } catch (error) {
    setStatus(`操作失败：${error.message}`, true);
  }
}

function setStatus(text, alert = false) {
  const el = $('ddtStatus');
  if (el) { el.textContent = text; el.classList.toggle('is-alert', alert); }
}

async function doStrengthen(button) {
  const forge = state.forge;
  const slots = state.forgeSlots;
  const weaponId = slots[5] || state.selectedForgeWeapon;
  const weapon = forge?.weapons.find((w) => w.id === weaponId);
  if (!weapon) return;
  if (!weapon.canStrengthen) { setStatus('武器已达强化上限', true); return; }
  const strengthSlots = slots.slice(0, 3).filter(Boolean);
  button.disabled = true;
  const panel = $('ddtForge');
  panel.classList.remove('is-success', 'is-fail');
  try {
    const result = await dataApi.strengthen({
      weaponInstanceId: weapon.id,
      // LOCAL_RULE 用 itemKey 折算单位；ORIGINAL 用三个真实槽位。
      itemKey: strengthSlots[0] || state.selectedForgeItem || undefined,
      slots: strengthSlots,
      luckyCharm: slots[4] || undefined,
      godCharm: slots[3] || undefined,
      requestId: dataApi.newRequestId(),
    });
    panel.classList.add(result.success ? 'is-success' : 'is-fail');
    // 强化结果沿用原版 063/064（StoreTips 内部封装，源码未提供，标注未确认）。
    window.__GUNNY_HOOKS__?.playSound?.(result.success ? 'win' : 'lose');
    const art = $('ddtForgeResultArt');
    if (art) {
      art.hidden = false;
      art.style.backgroundImage = `url("assets/forge/${result.success ? 'result-success' : 'result-fail'}.png?v=34")`;
      // 原版结果特效只作短暂反馈，1.6s 后移除，避免长期遮挡槽位交互。
      window.clearTimeout(state.forgeResult);
      state.forgeResult = window.setTimeout(() => { art.hidden = true; }, 1600);
    }
    $('ddtForgeResult').textContent = result.success
      ? `强化成功：+${result.weapon.levelBefore} → +${result.weapon.levelAfter}，攻击 ${result.weapon.attackBefore} → ${result.weapon.attackAfter}`
      : `强化失败：等级保持 +${result.weapon.levelAfter}，金币与材料已按规则扣除`;
    // 材料已被消耗，清空材料槽；装备槽保留当前武器。
    state.forgeSlots = [null, null, null, null, null, weapon.id];
    state.activeSlot = null;
    state.selectedForgeWeapon = weapon.id;
    renderForge(await dataApi.getForge());
    renderRoom(await dataApi.getRoom());
  } catch (error) {
    // 服务端拒绝（金币/材料不足、上限、版本冲突）必须明确显示，不能静默。
    const message = error?.message || '服务端拒绝该请求';
    panel.classList.add('is-fail');
    $('ddtForgeResult').textContent = `强化未完成：${message}`;
    setStatus(`强化未完成：${message}`, true);
  } finally {
    button.disabled = false;
  }
}

async function startBattle(button) {
  button.disabled = true;
  try {
    const result = await dataApi.startBattle();
    state.currentBattleId = result.battleId;
    // 原版 GameViewBase 按 LoadMapsItems.xml 的 BackMusic 播放战斗音乐；
    // 地图编号 ≠ 音乐编号（如 1157 -> 1071），映射见 audio-scenes.js。
    window.__GUNNY_HOOKS__?.audioScene?.('battle', state.room?.mapId);
    hideLayer();
    setStatus('', false);
    window.__GUNNY_HOOKS__?.playSound?.('008');
  } finally {
    button.disabled = false;
  }
}

function showLayer() {
  if (!state.layer) return;
  state.layer.hidden = false;
  $('ddtForge').hidden = true;
  $('ddtRoom').hidden = false;
  state.forgeOpen = false;
  // 原版 BaseRoomState.as: playMusic("065")。
  window.__GUNNY_HOOKS__?.audioScene?.('room');
}

function hideLayer() {
  if (state.layer) state.layer.hidden = true;
}

/** 结算弹窗「再战一局」在服务端模式下改为返回房间。 */
export async function returnToRoom() {
  const modal = $('modal');
  if (modal) { modal.hidden = true; modal.classList.remove('is-result'); }
  window.clearInterval(state.cardTimer);
  state.cardTimer = 0;
  try {
    const room = await dataApi.leaveBattle();
    renderRoom(room);
  } catch (error) {
    console.warn('[ddt] 返回房间失败', error);
  }
  showLayer();
}

/** 刷新页面后，从房间入口恢复未翻完的奖励盘。 */
export async function reopenSettlement() {
  const room = await dataApi.getRoom();
  const pending = room?.pendingReward;
  const last = room?.lastResult;
  if (!pending || !last) { setStatus('没有可继续领取的奖励盘', true); return; }
  state.currentBattleId = pending.battleId;
  const hooks = window.__GUNNY_HOOKS__;
  if (!hooks?.showResult) { setStatus('结算界面尚未就绪，请稍后重试', true); return; }
  hideLayer();
  hooks.showResult({
    winner: last.winner,
    stats: last.stats || {},
    round: last.stats?.round || 1,
    battleId: pending.battleId,
  });
}

// ---------------------------------------------------------------- 战后九宫格翻牌

function cardHtml(card) {
  return `
    <button class="result-card ${card.revealed ? 'is-flipped' : ''}" type="button"
            data-card="${card.index}" aria-label="第 ${card.index + 1} 张卡">
      <span class="card-inner">
        <span class="card-back"><img src="assets/ui/card-back.png?v=33" alt="" draggable="false"></span>
        <span class="card-flip" aria-hidden="true"></span>
        <span class="card-face">
          <img class="card-face-bg" src="assets/ui/card-face.png?v=33" alt="" draggable="false">
          <img class="card-frame" src="assets/ui/card-selected.png?v=33" alt="" draggable="false">
          <span class="ddt-card-prize"></span>
        </span>
      </span>
    </button>`;
}

function fillPrize(cardEl, reward) {
  const slot = cardEl.querySelector('.ddt-card-prize');
  if (!slot || !reward) return;
  const isCoin = reward.kind === 'coin';
  slot.innerHTML = `
    ${isCoin ? '<img class="card-gold-label" src="assets/ui/card-gold-label.png?v=33" alt="Gold" draggable="false">' : ''}
    <img class="card-icon" src="${esc(reward.icon)}?v=33" alt="" draggable="false">
    <b>+${fmt(reward.amount)}</b><small>${esc(reward.label)}</small>`;
}

/**
 * 由 main.js 的 setupResultCards 在 server 模式下调用。
 * 复用原版九宫格 DOM/CSS/卡背素材；奖励内容只有服务端翻牌后才下发。
 */
export async function renderServerCards({ resultData, sound, showToast }) {
  const row = $('cardsRow');
  const timer = $('cardsCountdown');
  const claimBtn = $('claimReward');
  const sumEl = $('rewardSum');
  const balanceEl = $('rewardBalance');
  if (!row) return;
  window.clearInterval(state.cardTimer);

  let battleId = resultData?.battleId || state.currentBattleId;
  if (!battleId) {
    try {
      const room = await dataApi.getRoom();
      battleId = room?.pendingReward?.battleId || room?.lastResult?.battleId;
    } catch { /* handled below */ }
  }
  if (!battleId) {
    row.innerHTML = '<p class="ddt-cards-error">奖励盘尚未就绪，请返回房间后重试</p>';
    return;
  }
  state.currentBattleId = battleId;

  let board;
  try { board = await dataApi.getRewards(battleId); } catch (error) {
    row.innerHTML = `<p class="ddt-cards-error">读取奖励盘失败：${esc(error.message)}</p>`;
    return;
  }

  let picksUsed = board.picksUsed;
  let closed = board.status === 'closed';
  let busy = false;
  const tally = { coins: 0, stones: 0 };
  const MAX = board.maxPicks;

  row.style.setProperty('--card-columns', '3');
  row.innerHTML = board.cards.map(cardHtml).join('');
  const cards = [...row.querySelectorAll('.result-card')];
  for (const card of cards) {
    const info = board.cards[Number(card.dataset.card)];
    if (!info?.revealed) continue;
    fillPrize(card, info.reward);
    if (info.reward?.kind === 'coin') tally.coins += Number(info.reward.amount || 0);
    else tally.stones += Number(info.reward?.amount || 0);
  }

  const refresh = () => {
    if (sumEl) sumEl.textContent = `已翻开 ${picksUsed}/${MAX} · 金币 +${fmt(tally.coins)} · 材料 +${fmt(tally.stones)}`;
    if (balanceEl && board.wallet) {
      balanceEl.textContent = `存档余额：金币 ${fmt(board.wallet.coins)} · 材料 ${fmt(stoneTotal(board.wallet))}`;
    }
  };

  const finish = (auto) => {
    window.clearInterval(state.cardTimer);
    state.cardTimer = 0;
    for (const card of cards) if (!card.classList.contains('is-flipped')) card.classList.add('is-disabled');
    if (timer) timer.textContent = auto ? '翻牌时间到 · 剩余次数可在房间继续领取' : '翻牌结束';
    showToast?.(auto ? '倒计时结束，未翻卡片可在房间继续领取' : '翻牌完成', { duration: 2200 });
  };

  if (claimBtn) {
    claimBtn.disabled = false;
    claimBtn.textContent = '返回房间 / 稍后继续翻牌';
    claimBtn.onclick = () => { returnToRoom(); };
  }
  refresh();

  if (closed) {
    for (const card of cards) card.classList.add('is-disabled');
    if (timer) timer.textContent = '本局翻牌已完成';
  } else {
    let remaining = 5;
    if (timer) timer.textContent = `翻牌倒计时 ${remaining}s`;
    // 原版 CardCountDown.as：067 起始提示 + 014 每秒滴答。
    sound?.play?.('067');
    state.cardTimer = window.setInterval(() => {
      remaining -= 1;
      if (timer) timer.textContent = `翻牌倒计时 ${Math.max(0, remaining)}s`;
      if (remaining > 0) sound?.play?.('014');
      if (remaining <= 0) finish(true);
    }, 1000);
  }

  row.onclick = async (event) => {
    const card = event.target.closest('.result-card');
    if (!card || busy || closed || card.classList.contains('is-flipped') || card.classList.contains('is-disabled')) return;
    const cardIndex = Number(card.dataset.card);
    busy = true;
    card.classList.add('is-disabled');
    const requestId = dataApi.newRequestId();
    try {
      sound?.play?.('008');
      const result = await dataApi.claimCard(battleId, cardIndex, requestId);
      sound?.play?.('048');
      card.classList.remove('is-disabled');
      card.classList.add('is-flipped');
      fillPrize(card, result.reward);
      if (result.reward?.kind === 'coin') tally.coins += Number(result.reward.amount || 0);
      else tally.stones += Number(result.reward?.amount || 0);
      picksUsed = result.picksUsed;
      closed = result.status === 'closed' || picksUsed >= MAX;
      board.wallet = result.wallet;
      paintWalletChips(result.wallet);
      refresh();
      if (balanceEl) balanceEl.textContent = `存档余额：金币 ${fmt(result.wallet.coins)} · 材料 ${fmt(stoneTotal(result.wallet))}`;
      if (closed) {
        for (const c of cards) if (!c.classList.contains('is-flipped')) c.classList.add('is-disabled');
        window.clearInterval(state.cardTimer);
        if (timer) timer.textContent = '本局翻牌已完成';
      }
    } catch (error) {
      card.classList.remove('is-disabled');
      showToast?.(`翻牌失败：${error.message}`, { alert: true });
      // 重试或并发导致的已领卡：重新同步服务端盘面，避免界面与存档不一致。
      try {
        const fresh = await dataApi.getRewards(battleId);
        const info = fresh.cards[cardIndex];
        if (info?.revealed) {
          card.classList.add('is-flipped', 'is-disabled');
          fillPrize(card, info.reward);
        }
        picksUsed = fresh.picksUsed;
        closed = fresh.status === 'closed';
        refresh();
      } catch { /* keep current view */ }
    } finally {
      busy = false;
    }
  };
}

// ---------------------------------------------------------------- 初始化

function createHooks() {
  const hooks = {
    isServerMode: () => dataApi.isServer(),
    getWallet: () => dataApi.getCachedWallet(),
    get currentBattleId() { return state.currentBattleId; },
    renderServerCards,
    returnToRoom,
    reopenSettlement,
  };
  window.__GUNNY_SERVER_UI__ = hooks;
  return hooks;
}

export async function initServerMode() {
  createHooks();
  if (!dataApi.isServer()) return; // 站点版：保持原样，不叠加任何 UI

  buildLayer();

  dataApi.on('wallet', (wallet) => paintWalletChips(wallet));
  dataApi.on('room', (room) => {
    if (!state.layer?.hidden && !state.forgeOpen && $('ddtRoom') && !$('ddtRoom').hidden) renderRoom(room);
  });
  dataApi.on('battle_start', (data) => {
    state.currentBattleId = data.battleId;
    hideLayer();
  });
  dataApi.on('battle_end', (data) => {
    state.currentBattleId = data.battleId;
  });
  dataApi.on('forge', (forge) => {
    if (state.forgeOpen) renderForge(forge);
  });

  try {
    const room = await dataApi.getRoom();
    // 前端显示层由 ?map= 决定，服务端房间状态是权威：二者不一致时统一到房间。
    const urlMap = params.get('map');
    if ((urlMap && urlMap !== room.mapId) || (!urlMap && room.mapId !== '1156')) {
      const next = new URL(location.href);
      next.searchParams.set('map', room.mapId);
      location.replace(next.href);
      return;
    }
    renderRoom(room);
    showLayer();
  } catch (error) {
    console.error('[ddt] 房间初始化失败', error);
    setStatus(`房间加载失败：${error.message}`, true);
    showLayer();
  }
}

export default { initServerMode, renderServerCards, returnToRoom, paintWalletChips };
