/**
 * 浏览器验收：用真实的 Chrome 打开真实的前端，点真实的按钮。
 *
 * 为什么需要它——e2e-smoke.mjs 证明了「协议对了」，但协议对了不等于
 * 「界面画得出来」。这个脚本回答的是另外几个问题：
 *   - React 有没有渲染？还是白屏？
 *   - 控制台有没有报错？有没有 404？有没有访问外网？
 *   - 点得动吗？四个人真的能在同一个大厅里互相看见吗？
 *   - 400px 宽的手机上会不会横向溢出、有没有被裁掉的元素？
 *
 * 用系统已装的 Chrome（channel: 'chrome'），不下载 Playwright 自带的浏览器。
 *
 * 用法：
 *   终端 A:  npm run build && npm start     （生产模式，一个进程搞定）
 *   终端 B:  npm run test:browser
 */
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const URL = process.env.BROWSER_TEST_URL ?? 'http://localhost:3001';
const SHOT_DIR = path.resolve('screenshots');

let failures = 0;
let checks = 0;
const problems = [];

function check(label, condition, detail = '') {
  checks += 1;
  if (condition) {
    console.log(`  ✓ ${label}`);
  } else {
    failures += 1;
    problems.push(`${label}${detail ? ` — ${detail}` : ''}`);
    console.error(`  ✗ ${label}${detail ? `  — ${detail}` : ''}`);
  }
}

/**
 * 一份独立实现的判奖参照，用于「屏幕上的点数」反推奖项。
 *
 * 故意不复用 shared/src/awards.ts —— 复用就只是把实现抄一遍，
 * 抄错的地方会跟着一起错。这里是按博饼规则另写一遍，用来互相印证。
 * 顺序即优先级，从高到低，命中即返回。
 */
function referenceAward(dice) {
  if (dice.length !== 6) return null;
  const c = [0, 0, 0, 0, 0, 0, 0];
  for (const d of dice) c[d] += 1;
  const kinds = c.slice(1).filter((k) => k > 0);
  const same = (k) => c.find((v) => v === k) ?? 0;

  if (c[4] === 4 && c[1] === 2) return '插金花';
  if (c[4] === 6) return '六杯红';
  if (c[1] === 6) return '遍地锦';
  if (same(6) === 6) return '六抔黑';
  if (c[4] === 5) return '五红';
  if (same(5) === 5) return '五子登科';
  if (c[4] === 4) return '四点红';
  if (kinds.length === 6) return '对堂';
  if (same(4) === 4) return '四进';
  if (c[4] === 3) return '三红';
  if (c[4] === 2) return '二举';
  if (c[4] === 1) return '一秀';
  return '无奖';
}

/**
 * 给一个页面装上探针：收集控制台报错、未捕获异常、失败请求、以及任何外部网络请求。
 */
function instrument(page, label) {
  const errors = [];
  const pageErrors = [];
  const failedRequests = [];
  const externalRequests = [];

  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => pageErrors.push(err.message));
  page.on('requestfailed', (req) => {
    failedRequests.push(`${req.url()} (${req.failure()?.errorText ?? 'unknown'})`);
  });
  page.on('request', (req) => {
    const url = req.url();
    if (!url.startsWith(URL) && !url.startsWith('data:') && !url.startsWith('blob:')) {
      externalRequests.push(url);
    }
  });

  return {
    label,
    page,
    errors,
    pageErrors,
    failedRequests,
    externalRequests,
    report() {
      check(`${label} · 无未捕获异常`, pageErrors.length === 0, pageErrors.join(' | '));
      check(`${label} · 控制台无报错`, errors.length === 0, errors.slice(0, 3).join(' | '));
      check(
        `${label} · 没有加载失败资源`,
        failedRequests.filter((u) => !u.includes('/socket.io/')).length === 0,
        failedRequests.slice(0, 3).join(' | '),
      );
      check(
        `${label} · 没有访问任何外部网络`,
        externalRequests.length === 0,
        externalRequests.slice(0, 3).join(' | '),
      );
    },
  };
}

/** 检查页面是否横向溢出（手机上最容易被 `overflow-x: hidden` 掩盖的问题）。 */
async function checkNoOverflow(probe, tag) {
  const result = await probe.page.evaluate(() => {
    const de = document.documentElement;
    const overflowing = [];
    for (const el of document.querySelectorAll('*')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.right > window.innerWidth + 1 || r.left < -1) {
        overflowing.push(`${el.tagName}.${(el.className || '').toString().split(' ')[0]}`);
      }
    }
    return {
      scrollWidth: de.scrollWidth,
      innerWidth: window.innerWidth,
      overflowing: [...new Set(overflowing)].slice(0, 6),
    };
  });
  check(
    `${tag} · 无横向溢出（scrollWidth ${result.scrollWidth} ≤ 视口 ${result.innerWidth}）`,
    result.scrollWidth <= result.innerWidth + 1,
    result.overflowing.length ? `溢出元素: ${result.overflowing.join(', ')}` : '',
  );
}

async function shot(probe, name) {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  await probe.page.screenshot({ path: path.join(SHOT_DIR, `${name}.png`), fullPage: true });
}

/** 页面是否真的画出了东西（不是白屏）。 */
async function assertRendered(probe, tag) {
  const info = await probe.page.evaluate(() => {
    const root = document.getElementById('root');
    return {
      hasRoot: Boolean(root),
      childCount: root ? root.children.length : 0,
      textLength: (document.body.innerText || '').trim().length,
      visibleTop: [...document.querySelectorAll('body *')].filter((el) => {
        const r = el.getBoundingClientRect();
        const s = getComputedStyle(el);
        return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
      }).length,
    };
  });
  check(`${tag} · React 已挂载`, info.hasRoot && info.childCount > 0);
  check(`${tag} · 不是白屏（可见元素 ${info.visibleTop} 个）`, info.visibleTop > 5);
  check(`${tag} · 有实际文字内容（${info.textLength} 字）`, info.textLength > 10);
  return info;
}

/**
 * 等这次博饼演出播完（骰子停稳、奖项已显示），再把画面读出来。
 *
 * 不能像以前那样固定 sleep 2500ms 就开读：一整轮演出最长的是
 * 状元插金花，骰子 1800ms + 开奖 2600ms = 4400ms 才结束（见
 * shared/src/timing.ts 的 ROLL_TIMING）。固定等待会在状元那一把读到
 * 半截动画，属于「测试自己制造的不稳定」。
 *
 * 判稳条件：连续两次采样，骰子点数与奖项都没变，且确实是六颗。
 */
async function waitForDiceSettled(page, timeoutMs = 20_000) {
  const sample = () =>
    page.evaluate(() => {
      const pips = [];
      for (const die of document.querySelectorAll('.dice-stage__die')) {
        const circles = die.querySelectorAll('circle');
        if (circles.length > 0) pips.push(circles.length);
      }
      // 奖项从结果条上读，别去日志里捞整句话。
      // 日志那行是「苏子瞻博出（六三三二五一），月色尚浅，无奖」——
      // 紧跟在「博出」后面的是**骰子点数**，不是奖项，
      // 用正则去抓必然抓错，而且是那种「看着像通过了」的错。
      const awardEl = document.querySelector('.game-result__award');
      return {
        pips,
        awardText: awardEl ? awardEl.textContent.trim() : null,
      };
    });

  const deadline = Date.now() + timeoutMs;
  let prev = null;
  while (Date.now() < deadline) {
    const cur = await sample();
    const stable =
      prev !== null &&
      cur.awardText !== null &&
      cur.pips.length === 6 &&
      prev.pips.join() === cur.pips.join() &&
      prev.awardText === cur.awardText;
    if (stable) return cur;
    prev = cur;
    await page.waitForTimeout(300);
  }
  return prev ?? { pips: [], awardText: null };
}

/** 开一个干净的浏览器上下文（独立 localStorage），用手机视口。 */
async function newPlayer(browser, label, nickname, viewport) {
  const context = await browser.newContext({
    viewport: viewport ?? { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    locale: 'zh-CN',
  });
  const page = await context.newPage();
  const probe = instrument(page, label);
  await page.goto(URL, { waitUntil: 'networkidle' });
  // 首次进入会先看到规则页
  const understood = page.getByRole('button', { name: /我已了解/ });
  if (await understood.isVisible().catch(() => false)) {
    await understood.click();
    await page.waitForTimeout(400);
  }
  // 取雅号入席
  const input = page.getByPlaceholder(/取个雅号/);
  await input.waitFor({ state: 'visible', timeout: 10_000 });
  await input.fill(nickname);
  await page.locator('.lobby-join__submit').click();
  await page.waitForTimeout(700);
  return probe;
}

async function main() {
  console.log(`\n▸ 用系统 Chrome 打开 ${URL}\n`);

  // 和 e2e 一样，这个脚本要从零开局；房间脏了就直接说清楚，别让人对着超时发呆
  const health = await fetch(`${URL}/api/health`).then((r) => (r.ok ? r.json() : null));
  if (!health?.ok) {
    console.error(`\n❌ 连不上 ${URL}。请先在另一个终端启动服务端：\n     npm run build && npm start\n`);
    process.exit(1);
  }
  if (health.phase !== 'LOBBY' || health.players > 0) {
    console.error(
      `\n❌ 房间不是空的（phase=${health.phase}, players=${health.players}）。\n` +
        `   请先重启服务端再来：房间状态是纯内存的，重启即清空。\n`,
    );
    process.exit(1);
  }

  const browser = await chromium.launch({
    channel: 'chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });

  try {
    /* ---------------- 1. 规则页 ---------------- */
    console.log('[1] 规则页（首次进入）');
    const solo = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const rulesPage = await solo.newPage();
    const rulesProbe = instrument(rulesPage, '规则页');
    await rulesPage.goto(URL, { waitUntil: 'networkidle' });
    await rulesPage.waitForTimeout(800);
    await assertRendered(rulesProbe, '规则页');
    await checkNoOverflow(rulesProbe, '规则页');
    await shot(rulesProbe, '01-rules-mobile');

    // 规则页不该出现明示保底的文案
    const rulesText = await rulesPage.evaluate(() => document.body.innerText);
    for (const banned of ['必出', '必中', '保证', '一定', '必定', '包出']) {
      check(`规则页未出现「${banned}」`, !rulesText.includes(banned));
    }
    check('规则页未泄露概率数字（无 "20%" / "+2%"）', !/20%|\+2%|5%/.test(rulesText));
    rulesProbe.report();
    await solo.close();

    /* ---------------- 2. 桌面端大厅 ---------------- */
    console.log('\n[2] 四人入席（真实点击）');
    const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const hostPage = await desktop.newPage();
    const hostProbe = instrument(hostPage, '房主');
    await hostPage.goto(URL, { waitUntil: 'networkidle' });
    const understood = hostPage.getByRole('button', { name: /我已了解/ });
    if (await understood.isVisible().catch(() => false)) {
      await understood.click();
      await hostPage.waitForTimeout(400);
    }
    await hostPage.getByPlaceholder(/取个雅号/).fill('苏子瞻');
    await hostPage.locator('.lobby-join__submit').click();
    await hostPage.waitForTimeout(900);

    await assertRendered(hostProbe, '大厅');
    await checkNoOverflow(hostProbe, '大厅');
    await shot(hostProbe, '02-lobby-desktop');

    // 再来三个人
    const others = [];
    for (const [i, name] of ['黄鲁直', '秦少游', '晁无咎'].entries()) {
      others.push(await newPlayer(browser, `客人${i + 2}`, name));
    }

    // 房主应该看到四个人
    await hostPage.waitForTimeout(800);
    const lobbyText = await hostPage.evaluate(() => document.body.innerText);
    for (const name of ['苏子瞻', '黄鲁直', '秦少游', '晁无咎']) {
      check(`大厅里能看到「${name}」`, lobbyText.includes(name));
    }
    check('大厅显示了「4 / 15」一类的在位人数', /4\s*\/\s*15|4\s*位/.test(lobbyText), lobbyText.slice(0, 120));
    await shot(hostProbe, '03-lobby-four-players');

    /* ---------------- 3. 开局 ---------------- */
    console.log('\n[3] 开局与骰子');
    const startBtn = hostPage.locator('.lobby-start');
    check('房主能看到开始按钮', await startBtn.isVisible().catch(() => false));
    await startBtn.click();
    await hostPage.waitForTimeout(1500);

    for (const p of [hostProbe, ...others]) {
      const info = await assertRendered(p, `${p.label} 游戏页`);
      check(`${p.label} 进入了游戏页`, info.textLength > 20);
    }
    await checkNoOverflow(hostProbe, '游戏页');
    await shot(hostProbe, '04-game-desktop');

    // 骰子是否画出来了
    const diceInfo = await hostPage.evaluate(() => {
      const nodes = document.querySelectorAll('[class*="dice"], [class*="die"]');
      return { count: nodes.length, hasSvg: document.querySelectorAll('svg').length };
    });
    check(`游戏页渲染了骰子元素（${diceInfo.count} 个）`, diceInfo.count > 0);

    /* ---------------- 4. 轮到谁谁才能博 ---------------- */
    console.log('\n[4] 回合与博饼按钮');
    const rollButtons = [];
    for (const p of [hostProbe, ...others]) {
      const btn = p.page.locator('.btn-roll');
      const visible = await btn.first().isVisible().catch(() => false);
      const enabled = visible ? await btn.first().isEnabled().catch(() => false) : false;
      rollButtons.push({ label: p.label, visible, enabled });
    }
    const enabledCount = rollButtons.filter((r) => r.enabled).length;
    check(
      `恰好一个人可以博饼（${rollButtons.filter((r) => r.enabled).map((r) => r.label).join(',') || '无人'}）`,
      enabledCount === 1,
      rollButtons.map((r) => `${r.label}:${r.visible ? (r.enabled ? '可博' : '不可') : '无按钮'}`).join(' '),
    );

    // 让他博一把
    const roller = rollButtons.find((r) => r.enabled);
    if (roller) {
      const probe = [hostProbe, ...others].find((p) => p.label === roller.label);
      const before = await probe.page.evaluate(() => document.body.innerText);
      await probe.page.locator('.btn-roll').first().click();
      await waitForDiceSettled(probe.page);
      const after = await probe.page.evaluate(() => document.body.innerText);
      check(`${roller.label} 点击后页面有变化`, before !== after);
      await shot(probe, '05-after-roll');
    }

    /* ---------------- 4b. 屏幕上的点数 == 服务端判的奖 ---------------- */
    // 这一条是最关键的显示正确性检查：骰子画错点数、或者奖项文案与实际点数对不上，
    // 静态检查和单元测试都发现不了——只有真的看一眼画面才能发现。
    console.log('\n[4b] 骰面点数与奖项是否自洽');
    const pipCheck = await waitForDiceSettled(hostPage);

    check(`碗里正好六颗骰子（${pipCheck.pips.length} 颗）`, pipCheck.pips.length === 6);
    check(
      `每颗骰子都是 1~6 点（${pipCheck.pips.join(' ')}）`,
      pipCheck.pips.length === 6 && pipCheck.pips.every((p) => p >= 1 && p <= 6),
      pipCheck.pips.join(','),
    );

    // 用一份独立实现的判奖参照，从屏幕上的点数反推奖项，再和屏幕上写的奖项比对
    const expectedAward = referenceAward(pipCheck.pips);
    check(
      `屏幕点数（${pipCheck.pips.slice().sort().join('')}）推出的奖项「${expectedAward}」与结果条奖项一致`,
      pipCheck.awardText !== null && expectedAward === pipCheck.awardText,
      `结果条 .game-result__award 写的是「${pipCheck.awardText}」`,
    );

    /* ---------------- 5. 手机端游戏页 ---------------- */
    console.log('\n[5] 手机视口下的游戏页');
    const mobile = await browser.newContext({
      viewport: { width: 375, height: 667 },
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 2,
    });
    const mobilePage = await mobile.newPage();
    const mobileProbe = instrument(mobilePage, '手机375');
    await mobilePage.goto(URL, { waitUntil: 'networkidle' });
    await mobilePage.waitForTimeout(1000);
    const mUnderstood = mobilePage.getByRole('button', { name: /我已了解/ });
    if (await mUnderstood.isVisible().catch(() => false)) {
      await mUnderstood.click();
      await mobilePage.waitForTimeout(400);
    }
    await assertRendered(mobileProbe, '手机375');
    await checkNoOverflow(mobileProbe, '手机375');
    await shot(mobileProbe, '06-mobile-375');

    // 点击靶大小
    const smallTargets = await mobilePage.evaluate(() => {
      const bad = [];
      for (const btn of document.querySelectorAll('button, a[role="button"], [role="button"]')) {
        const r = btn.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        const s = getComputedStyle(btn);
        if (s.visibility === 'hidden' || s.display === 'none') continue;
        if (r.height < 40) {
          bad.push(`「${(btn.innerText || btn.getAttribute('aria-label') || '').trim().slice(0, 12)}」${Math.round(r.height)}px`);
        }
      }
      return bad;
    });
    check(
      `手机端所有按钮点击靶 ≥ 40px`,
      smallTargets.length === 0,
      smallTargets.join(', '),
    );

    mobileProbe.report();
    await mobile.close();

    /* ---------------- 6. 所有探针统一体检 ---------------- */
    console.log('\n[6] 控制台与网络体检');
    for (const p of [hostProbe, ...others]) p.report();

    /* ---------------- 收尾 ---------------- */
    await desktop.close();

    console.log(`\n${'─'.repeat(60)}`);
    console.log(`截图已保存到 ${SHOT_DIR}/`);
    if (failures === 0) {
      console.log(`✅ 浏览器验收通过：${checks} 项检查全部通过\n`);
    } else {
      console.error(`❌ 浏览器验收失败：${checks} 项检查中有 ${failures} 项未通过`);
      console.error('   问题清单：');
      for (const p of problems) console.error(`     · ${p}`);
      console.log();
      process.exitCode = 1;
    }
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(`\n❌ 浏览器验收异常终止：${err?.stack ?? err}\n`);
  process.exit(1);
});
