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
 *  - 铁匠铺原版 UI 素材未导出，面板明确标注「单机临时界面」并保留
 *    data-asset-slot="forge-panel" 替换入口，不冒充原版界面。
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
  $('walletStonesChip')?.setAttribute('aria-label', `玄武石 ${stoneCount}`);
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
      <div class="ddt-forge-panel" data-asset-slot="forge-panel">
        <header class="ddt-forge-head">
          <h2>铁匠铺 · 武器强化</h2>
          <button class="ddt-btn ddt-btn-ghost" type="button" data-action="close-forge">关闭，返回房间</button>
        </header>
        <p class="ddt-asset-note">原版铁匠铺 UI 素材未导出 · 以下为明确标注的单机临时界面（保留替换入口），不代表原版界面或原版强化规则</p>
        <div class="ddt-forge-rule-top" id="ddtForgeRuleTop"></div>
        <div class="ddt-forge-grid">
          <div class="ddt-forge-col">
            <h3>拥有武器</h3>
            <div class="ddt-forge-weapons" id="ddtForgeWeapons"></div>
          </div>
          <div class="ddt-forge-col">
            <h3>强化材料与规则</h3>
            <div class="ddt-forge-materials" id="ddtForgeMaterials"></div>
            <div class="ddt-forge-rule" id="ddtForgeRule"></div>
          </div>
          <div class="ddt-forge-col ddt-forge-detail">
            <h3>强化预览</h3>
            <div id="ddtForgeDetail"></div>
            <button class="ddt-btn ddt-btn-start" type="button" data-action="strengthen">确认强化</button>
            <p class="ddt-forge-result" id="ddtForgeResult"></p>
          </div>
        </div>
      </div>
    </section>
  `;
  document.body.appendChild(layer);
  state.layer = layer;
  layer.addEventListener('click', onLayerClick);
}

function renderRoom(room) {
  if (!room) return;
  state.room = room;
  paintWalletChips(room.wallet);
  $('ddtPlayerName').textContent = room.playerName || '本地玩家';

  $('ddtWallet').innerHTML = `
    <span class="ddt-chip"><img src="assets/ui/icon-gold.png?v=33" alt=""><b>${fmt(room.wallet.coins)}</b><small>金币</small></span>
    <span class="ddt-chip"><img src="assets/ui/icon-stones.png?v=33" alt=""><b>${fmt(stoneTotal(room.wallet))}</b><small>玄武石</small></span>`;

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

function renderForge(forge) {
  if (!forge) return;
  state.forge = forge;
  paintWalletChips(forge.wallet);
  const selectedId = state.selectedForgeWeapon || forge.weapons.find((w) => w.equipped)?.id || forge.weapons[0]?.id;
  state.selectedForgeWeapon = selectedId;
  const weapon = forge.weapons.find((w) => w.id === selectedId) || forge.weapons[0];

  $('ddtForgeWeapons').innerHTML = forge.weapons.map((w) => `
    <button class="ddt-forge-weapon ${w.id === selectedId ? 'is-active' : ''}" type="button"
            data-action="forge-weapon" data-weapon="${esc(w.id)}">
      <span>${esc(w.label)}</span><small>+${w.level} · 攻击 ${fmt(w.attack)}</small>
    </button>`).join('');

  $('ddtForgeMaterials').innerHTML = `
    <div class="ddt-forge-balance">金币 <b>${fmt(forge.wallet.coins)}</b></div>
    <div class="ddt-mat-row">${forge.wallet.items.map((i) => {
      const compose = i.kind === 'compose-stone';
      return `<button class="ddt-mat ddt-mat-pick ${state.selectedForgeItem === i.itemKey ? 'is-active' : ''} ${compose ? 'is-compose' : ''}" type="button"
              data-action="forge-item" data-item="${esc(i.itemKey)}"
              title="${esc(i.name)} · TemplateID ${i.templateId ?? '—'} · ${esc(i.kind)}${compose ? ' · 合成材料，不能作为强化石' : ''}" ${compose ? 'disabled' : ''}>
        <img src="${esc(i.icon)}?v=33" alt="" draggable="false"><b>${fmt(i.quantity)}</b><small>${compose ? '合成石' : esc(i.name)}</small>
      </button>`;
    }).join('')}</div>
    <p class="ddt-hint">四圣兽石（玄武/青龙/白虎/朱雀）是合成材料，不能作为强化石；服务端同样拒绝。不选材料时由服务端自动挑选库存中的真强化石。</p>`;

  const isOriginal = forge.rules === 'original';
  const unported = forge.notPorted || [];
  // 顶部摘要始终可见（材料区可滚动，详细规则在材料列下方）。
  $('ddtForgeRuleTop').innerHTML = `
    <b>当前规则：${esc(forge.activeRuleLabel || forge.ruleSource)}</b>
    <span> · 规则来源 ${esc(forge.ruleSource)}</span>
    <span> · 属性成长 ${esc(forge.attackGrowthSource || '—')}</span>
    ${unported.length ? `<span> · 未还原/未接线 ${unported.length} 项（详见下方）</span>` : ''}
    <span> · 武器映射 ${esc(forge.weaponMappingStatus || '—')}</span>`;
  $('ddtForgeRule').innerHTML = `
    <div class="ddt-label">当前规则：${esc(forge.activeRuleLabel || forge.ruleSource)}</div>
    <p>${esc(forge.ruleNote)}</p>
    <p class="ddt-hint">属性成长来源：${esc(forge.attackGrowthSource || '—')}</p>
    ${unported.length ? `<p class="ddt-hint">未还原 / 未接线：${esc(unported.join('、'))}</p>` : ''}
    ${forge.weaponMappingStatus ? `<p class="ddt-hint">武器映射：${esc(forge.weaponMappingStatus)}</p>` : ''}
    ${forge.composeStoneNote ? `<p class="ddt-hint">${esc(forge.composeStoneNote)}</p>` : ''}
    ${isOriginal ? '<p class="ddt-hint">原版链路不扣金币，只消耗槽位材料（ItemStrengthenHandler.cs:113）。三强化石槽 + 幸运符 + 神恩符由服务端校验。</p>' : ''}
    <p class="ddt-asset-note">原版铁匠铺 UI 与音效尚未导出，以下为明确标注的单机临时界面（保留替换入口），不代表原版界面或原版强化规则已还原。</p>`;

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
        <dt>成功率</dt><dd>${isOriginal ? '由槽位材料决定' : `${Math.round(cost.successRate * 100)}%`}</dd>
        <dt>上限</dt><dd>+${weapon.maxLevel}</dd>
        <dt>规则版本</dt><dd>${esc(weapon.ruleVersion || 'LOCAL_RULE')}</dd>
      </dl>`;
  }
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
      renderForge(await dataApi.getForge());
      return;
    }
    if (action === 'close-forge') {
      // 关闭后回到同一个房间，不重建房间、不丢失选择。
      state.forgeOpen = false;
      $('ddtForge').hidden = true;
      $('ddtRoom').hidden = false;
      renderRoom(await dataApi.getRoom());
      return;
    }
    if (action === 'forge-weapon') {
      state.selectedForgeWeapon = target.dataset.weapon;
      renderForge(state.forge);
      return;
    }
    if (action === 'forge-item') {
      state.selectedForgeItem = state.selectedForgeItem === target.dataset.item ? '' : target.dataset.item;
      renderForge(state.forge);
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
  const weapon = forge?.weapons.find((w) => w.id === state.selectedForgeWeapon);
  if (!weapon) return;
  if (!weapon.canStrengthen) { setStatus('武器已达强化上限', true); return; }
  button.disabled = true;
  const panel = $('ddtForge');
  panel.classList.remove('is-success', 'is-fail');
  try {
    const result = await dataApi.strengthen({
      weaponInstanceId: weapon.id,
      itemKey: state.selectedForgeItem || undefined,
      requestId: dataApi.newRequestId(),
    });
    panel.classList.add(result.success ? 'is-success' : 'is-fail');
    // 站点版既有音效（原版强化音效未导出，不冒充原版音效）。
    window.__GUNNY_HOOKS__?.playSound?.(result.success ? 'win' : 'lose');
    $('ddtForgeResult').textContent = result.success
      ? `强化成功：+${result.weapon.levelBefore} → +${result.weapon.levelAfter}，攻击 ${result.weapon.attackBefore} → ${result.weapon.attackAfter}`
      : `强化失败：等级保持 +${result.weapon.levelAfter}，金币与材料已按规则扣除`;
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
    if (sumEl) sumEl.textContent = `已翻开 ${picksUsed}/${MAX} · 金币 +${fmt(tally.coins)} · 玄武石 +${fmt(tally.stones)}`;
    if (balanceEl && board.wallet) {
      balanceEl.textContent = `存档余额：金币 ${fmt(board.wallet.coins)} · 玄武石 ${fmt(stoneTotal(board.wallet))}`;
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
    state.cardTimer = window.setInterval(() => {
      remaining -= 1;
      if (timer) timer.textContent = `翻牌倒计时 ${Math.max(0, remaining)}s`;
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
      if (balanceEl) balanceEl.textContent = `存档余额：金币 ${fmt(result.wallet.coins)} · 玄武石 ${fmt(stoneTotal(result.wallet))}`;
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
