/**
 * ResultPage —— 本局终章。
 *
 * 这一页是独立的结算页（不挂 TopBar），全部单列，桌面居中 760px。
 * 数据全部来自 snapshot.result / snapshot.stats —— 服务端算好，客户端只负责庄重地画出来。
 *
 * 注意用词：
 *   「状元」= 正式博饼状元（最终状元）；
 *   「榜眼风采」「探花雅赏」只是积分榜第 2、3 名的趣味彩蛋，不是博饼奖项，
 *   所以每一行都必须同时写明「积分榜第二 / 第三」，避免玩家误会。
 */
import { useState } from 'react';
import { motion } from 'framer-motion';
import { AWARD_MAP } from '@bobing/shared';
import type { ChampionOutcome, GameStats, RankingEntry } from '@bobing/shared';

import DiceFace from '../components/Dice/DiceFace';
import Seal from '../components/Common/Seal';
import SiteFooter from '../components/Common/SiteFooter';

import { durationText, awardName, diceChinese, rankLabel } from '../lib/format';
import { selectIsHost, useGameStore } from '../stores/gameStore';
import './ResultPage.css';

const EASE_SOFT: [number, number, number, number] = [0.22, 0.61, 0.36, 1];

/* ================================================================== *
 * 状元大卡片
 * ================================================================== */

interface ChampionCardProps {
  champion: ChampionOutcome;
}

function ChampionCard({ champion }: ChampionCardProps) {
  const { nickname, seat, awardId, dice, baseScore, bonus } = champion;
  const color = AWARD_MAP[awardId]?.palette.primary ?? 'var(--ink)';
  const total = baseScore + bonus;

  return (
    <motion.section
      className="scroll scroll--rod result-champ"
      aria-label="本局最终状元"
      initial={{ opacity: 0, y: 18, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.5, ease: EASE_SOFT }}
    >
      <p className="result-champ__eyebrow t-fang">正式博饼状元 · 金榜题名</p>

      <div className="result-champ__seal">
        <Seal text="状元" size="lg" tone="gold" />
      </div>

      <h2 className="result-champ__name t-kai">{nickname}</h2>

      <p className="result-champ__award" style={{ color }}>
        {awardName(awardId)}
      </p>

      <div className="result-champ__dice" aria-label={`骰子 ${diceChinese(dice)}`}>
        {dice.map((v, i) => (
          <DiceFace key={i} value={v} size={48} />
        ))}
      </div>
      <p className="result-champ__dice-text t-nums t-muted">{diceChinese(dice)}</p>

      <hr className="hairline" />

      <dl className="result-champ__scores">
        <div className="result-champ__score-row">
          <dt>基础积分</dt>
          <dd className="t-nums">+{baseScore}</dd>
        </div>
        <div className="result-champ__score-row">
          <dt>状元奖励</dt>
          <dd className="t-nums">+{bonus}</dd>
        </div>
        <div className="result-champ__score-row is-total">
          <dt>合计</dt>
          <dd className="t-nums">{total}</dd>
        </div>
      </dl>

      <p className="result-champ__seat t-muted t-nums">{seat} 号席</p>
    </motion.section>
  );
}

/**
 * 无状元卡片 —— 骰子完全随机之后约十分之一的牌局一个状元都博不出来。
 *
 * 这是正常的收席方式（五样普通饼博完了），不是数据缺失，所以不能退化成
 * 空状态或错误提示：状元那一份饼原封留在桌上，照实说明即可。
 */
function NoChampionCard() {
  return (
    <motion.section
      className="scroll scroll--plain result-champ result-champ--none"
      aria-label="本局无状元"
      initial={{ opacity: 0, y: 18, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.5, ease: EASE_SOFT }}
    >
      <p className="result-champ__eyebrow t-fang">本局终章 · 无状元</p>

      <div className="result-champ__seal">
        <Seal text="饼尽" size="lg" />
      </div>

      <h2 className="result-champ__name t-kai">饼尽月落</h2>

      <p className="result-champ__none-text t-muted">
        今夜的状元始终没有出现。状元奖 1 份仍封存于桌上，本局按「饼尽」收席。
      </p>

      <p className="result-champ__seat t-muted">积分榜第一并非正式博饼状元，请看下方金榜。</p>
    </motion.section>
  );
}

/* ================================================================== *
 * 排行榜
 * ================================================================== */

interface RankRowProps {
  entry: RankingEntry;
  index: number;
}

function RankRow({ entry, index }: RankRowProps) {
  const podium = entry.rank <= 3;
  const tierLabel =
    entry.rank === 1 ? '积分榜第一' : entry.rank === 2 ? '积分榜第二' : entry.rank === 3 ? '积分榜第三' : null;

  const cls = [
    'rank',
    podium ? 'rank--podium' : 'rank--normal',
    `rank--r${Math.min(entry.rank, 4)}`,
    entry.isFinalChampion ? 'rank--champion' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <motion.li
      className={cls}
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.38, delay: 0.1 + index * 0.06, ease: EASE_SOFT }}
    >
      <div className="rank__top">
        <span className="rank__rank t-kai">{rankLabel(entry.rank)}</span>
        {tierLabel && <span className="rank__tier">{tierLabel}</span>}
        {entry.funTitle && <span className="rank__fun">{entry.funTitle}</span>}
        {entry.isFinalChampion && <Seal text="状元" size="sm" />}
        <span className="rank__score t-nums">{entry.score} 分</span>
      </div>

      <div className="rank__mid">
        <span className="rank__name t-kai">{entry.nickname}</span>
        <span className="rank__meta t-muted t-nums">
          {entry.seat} 号席 · 博饼 {entry.rollCount} 次
        </span>
      </div>

      <ul className="rank__prizes">
        {entry.prizes.length === 0 ? (
          <li className="rank__prize rank__prize--none t-muted">未得奖品</li>
        ) : (
          entry.prizes.map((p) => (
            <li key={p.key} className="rank__prize">
              {p.name} ×{p.count}
            </li>
          ))
        )}
      </ul>
    </motion.li>
  );
}

/* ================================================================== *
 * 本局数据
 * ================================================================== */

interface StatCellProps {
  label: string;
  value: string;
}

function StatCell({ label, value }: StatCellProps) {
  return (
    <div className="result-stats__cell">
      <dt className="result-stats__label t-muted">{label}</dt>
      <dd className="result-stats__value t-nums">{value}</dd>
    </div>
  );
}

interface StatsCardProps {
  stats: GameStats;
}

function StatsCard({ stats }: StatsCardProps) {
  return (
    <section className="scroll scroll--plain result-stats" aria-label="本局数据">
      <h2 className="section-label">本局数据</h2>
      <dl className="result-stats__grid">
        <StatCell label="总博饼次数" value={`${stats.totalRolls} 次`} />
        <StatCell label="本局用时" value={durationText(stats.durationMs)} />
        <StatCell
          label="首个状元"
          value={stats.firstChampionRollIndex === null ? '—' : `第 ${stats.firstChampionRollIndex} 次`}
        />
        <StatCell label="状元易主" value={`${stats.championReplacements} 次`} />
        <StatCell label="系统代掷" value={`${stats.autoRolls} 次`} />
      </dl>
    </section>
  );
}

/* ================================================================== *
 * 再来一局
 * ================================================================== */

interface RestartBlockProps {
  isHost: boolean;
  pending: boolean;
  onRestart: () => void;
}

function RestartBlock({ isHost, pending, onRestart }: RestartBlockProps) {
  return (
    <div className="result-actions">
      {isHost ? (
        <button
          type="button"
          className="btn btn--primary btn--block result-actions__btn"
          onClick={onRestart}
          disabled={pending}
          aria-label="再来一局"
        >
          {pending ? '开局中…' : '再 来 一 局'}
        </button>
      ) : (
        <p className="result-actions__wait t-muted">等待房主开启新的一局……</p>
      )}
      <p className="result-actions__note t-muted">
        新的一局会清空积分与奖品，座位与昵称保留。
      </p>
    </div>
  );
}

/* ================================================================== *
 * 页面
 * ================================================================== */

export default function ResultPage(): JSX.Element {
  const snapshot = useGameStore((s) => s.snapshot);
  const isHost = useGameStore(selectIsHost);
  const restartGame = useGameStore((s) => s.restartGame);
  const [restarting, setRestarting] = useState(false);

  const result = snapshot?.result ?? null;
  const stats = snapshot?.stats ?? null;

  const handleRestart = (): void => {
    if (restarting) return;
    setRestarting(true);
    void restartGame().finally(() => setRestarting(false));
  };

  const head = (
    <header className="result__head">
      <p className="result__eyebrow t-fang">本局终章</p>
      <h1 className="result__title t-kai">月满中秋</h1>
      <hr className="hairline" />
    </header>
  );

  if (!result) {
    return (
      <div className="page result">
        {head}
        <section className="scroll scroll--plain result__fallback" aria-label="结算数据未就绪">
          <p className="result__fallback-text">
            结算数据尚未同步到本机，稍候片刻即可看到完整金榜；若本局确已结束，可请房主开启新的一局。
          </p>
        </section>
        <RestartBlock isHost={isHost} pending={restarting} onRestart={handleRestart} />
        <SiteFooter />
      </div>
    );
  }

  return (
    <div className="page result">
      {head}

      {result.champion ? (
        <ChampionCard champion={result.champion} />
      ) : (
        <NoChampionCard />
      )}

      <section className="scroll scroll--plain result-rank" aria-label="单局积分排行榜">
        <h2 className="section-label">单局积分排行榜</h2>
        <p className="result-rank__hint t-muted">
          「榜眼风采」「探花雅赏」只是积分榜的趣味称号，不是博饼奖项。
        </p>
        <ol className="result-rank__list">
          {result.ranking.map((entry, i) => (
            <RankRow key={entry.playerId} entry={entry} index={i} />
          ))}
        </ol>
      </section>

      {stats && <StatsCard stats={stats} />}

      <RestartBlock isHost={isHost} pending={restarting} onRestart={handleRestart} />

      <SiteFooter />
    </div>
  );
}
