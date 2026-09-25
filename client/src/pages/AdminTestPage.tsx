import { useCallback, useEffect, useRef, useState } from 'react';
import { AWARDS, diceMsFor, evaluateDice } from '@bobing/shared';
import type { AwardId, RollRecord } from '@bobing/shared';
import Background from '../components/Scenery/Background';
import DiceStage from '../components/Dice/DiceStage';
import AwardCelebration from '../components/AwardCelebration/AwardCelebration';
import { orderDiceForAward } from '../lib/diceOrder';
import './AdminTestPage.css';

const PRESETS: Record<AwardId, number[]> = {
  CHAMPION_FLOWER: [1, 4, 4, 1, 4, 4],
  SIX_FOUR: [4, 4, 4, 4, 4, 4],
  BROCADE: [1, 1, 1, 1, 1, 1],
  SIX_BLACK: [6, 6, 6, 6, 6, 6],
  FIVE_FOUR: [4, 2, 4, 4, 4, 4],
  FIVE_SCHOLAR: [3, 4, 3, 3, 3, 3],
  FOUR_FOUR: [4, 2, 4, 6, 4, 4],
  DUITANG: [6, 2, 4, 1, 5, 3],
  FOUR_ADVANCE: [4, 2, 2, 1, 2, 2],
  THREE_RED: [2, 4, 6, 4, 1, 4],
  TWO_LIFT: [2, 4, 6, 3, 1, 4],
  ONE_SHOW: [2, 3, 6, 4, 1, 2],
  NONE: [2, 3, 6, 2, 1, 5],
};

export default function AdminTestPage(): JSX.Element {
  const [input, setInput] = useState<number[]>(PRESETS.THREE_RED);
  const [roll, setRoll] = useState<RollRecord | null>(null);
  const [rolling, setRolling] = useState(false);
  const [celebrate, setCelebrate] = useState(false);
  const [animations, setAnimations] = useState(true);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const sequence = useRef(0);
  const finishCelebration = useCallback(() => setCelebrate(false), []);

  useEffect(() => () => clearTimeout(timer.current), []);

  function testDice(dice: number[]): void {
    clearTimeout(timer.current);
    setInput([...dice]);
    setCelebrate(false);
    const award = evaluateDice(dice);
    const key = ++sequence.current;
    setRoll({
      id: 'admin-' + key, rollIndex: key, playerId: 'admin-preview',
      nickname: '管理员测试', seat: 1, dice: [...dice], awardId: award.id,
      tier: award.tier, isChampionTier: award.tier === 'CHAMPION',
      prizeKey: award.prizeKey, prizeGranted: award.tier === 'NORMAL',
      inventoryExhausted: false, scoreGained: award.tier === 'NORMAL' ? award.score : 0,
      auto: false, kind: 'NORMAL', replacedChampion: false,
      becameFirstChampion: award.tier === 'CHAMPION', at: Date.now(),
    });
    setRolling(animations);
    if (animations) {
      timer.current = setTimeout(() => {
        setRolling(false);
        setCelebrate(true);
      }, diceMsFor(award.id));
    }
  }

  const result = roll ? evaluateDice(roll.dice) : null;

  return (
    <div className="app-root">
      <Background />
      <main className="admin-test panel">
        <header>
          <span className="badge">本地开发 · 测试模式</span>
          <h1>管理员测试台</h1>
          <p>指定点数或点击奖项，直接查看骰子排序与开奖效果。测试结果不计入正式牌局。</p>
          <a href="/">返回游戏</a>
        </header>
        <DiceStage dice={roll?.dice ?? null} awardId={roll?.awardId}
          rolling={rolling} durationMs={roll ? diceMsFor(roll.awardId) : 1200}
          animKey={roll?.rollIndex ?? 0} highlight={roll?.isChampionTier} />
        <div className="admin-test__result" role="status">
          {rolling ? '骰子翻滚中…' : result && roll ? (
            <>
              <strong>{result.name}</strong>
              <p>{result.rule}</p>
              <p>掷出顺序：{roll.dice.join(' ')}</p>
              <p>展示顺序：{orderDiceForAward(roll.dice, roll.awardId).join(' ')}</p>
            </>
          ) : '选择一个奖项开始测试'}
        </div>
        <fieldset>
          <legend>自定义六颗骰子</legend>
          <div className="admin-test__faces">
            {input.map((value, index) => (
              <label key={index}>第 {index + 1} 颗
                <select value={value} onChange={(event) => setInput(input.map((d, i) =>
                  i === index ? Number(event.target.value) : d))}>
                  {[1, 2, 3, 4, 5, 6].map((face) => <option key={face} value={face}>{face}</option>)}
                </select>
              </label>
            ))}
          </div>
          <div className="admin-test__actions">
            <button className="btn" onClick={() => testDice(input)}>测试这组点数</button>
            <button className="btn" onClick={() => testDice(Array.from({ length: 6 }, () =>
              1 + Math.floor(Math.random() * 6)))}>随机博一次</button>
            <label><input type="checkbox" checked={animations}
              onChange={(event) => setAnimations(event.target.checked)} /> 播放掷骰与开奖动画</label>
          </div>
        </fieldset>
        <fieldset>
          <legend>一键测试所有奖项</legend>
          <div className="admin-test__presets">
            {AWARDS.map((award) => (
              <button className="btn" key={award.id} onClick={() => testDice(PRESETS[award.id])}>
                {award.name}
              </button>
            ))}
          </div>
        </fieldset>
        {celebrate && roll && <div className="cel-root">
          <AwardCelebration key={roll.id} roll={roll} onDone={finishCelebration} />
        </div>}
      </main>
    </div>
  );
}
