/**
 * App —— 页面路由与全局浮层。
 *
 * 页面完全由服务端 snapshot 的 phase 决定，因此刷新页面、断线重连
 * 都会自动回到正确的位置，不会把人踢回大厅。
 */
import { lazy, Suspense, useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useGameStore } from './stores/gameStore';

import Background from './components/Scenery/Background';
import ToastStack from './components/Common/ToastStack';
import ConnectionBanner from './components/Common/ConnectionBanner';
import RuleModal from './components/RuleModal/RuleModal';
import CelebrationLayer from './components/AwardCelebration/CelebrationLayer';
import ChampionFlash from './components/ChampionFlash/ChampionFlash';

import RulesPage from './pages/RulesPage';
import LobbyPage from './pages/LobbyPage';
import GamePage from './pages/GamePage';
import ResultPage from './pages/ResultPage';

const AdminTestPage = import.meta.env.DEV ? lazy(() => import('./pages/AdminTestPage')) : null;

export default function App() {
  if (AdminTestPage && new URLSearchParams(window.location.search).get('admin') === '1') {
    return <Suspense fallback={<p>正在打开测试台…</p>}><AdminTestPage /></Suspense>;
  }
  return <>
    <GameApp />
    {import.meta.env.DEV && <a className="admin-test-entry" href="/?admin=1">管理员测试</a>}
  </>;
}

function GameApp() {
  const initSocket = useGameStore((s) => s.initSocket);
  const resync = useGameStore((s) => s.resync);
  const hasJoined = useGameStore((s) => s.hasJoined);
  const rulesSeen = useGameStore((s) => s.rulesSeen);
  const connection = useGameStore((s) => s.connection);
  const phase = useGameStore((s) => s.snapshot?.phase ?? null);
  const snapshot = useGameStore((s) => s.snapshot);
  const identity = useGameStore((s) => s.identity);

  useEffect(() => {
    initSocket();
  }, [initSocket]);

  // 刷新页面 / 重连成功之后，主动拉一次完整快照，恢复昵称、座位、积分、奖品
  useEffect(() => {
    if (hasJoined && identity.sessionToken && connection === 'connected') {
      void resync();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasJoined, identity.sessionToken, connection]);

  const pageKey = !rulesSeen
    ? 'rules'
    : !hasJoined || !snapshot
      ? 'lobby'
      : phase === 'LOBBY'
        ? 'lobby'
        : phase === 'FINISHED'
          ? 'result'
          : 'game';

  return (
    <div className="app-root">
      <Background />

      <ConnectionBanner />

      <AnimatePresence mode="wait">
        <motion.div
          key={pageKey}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.34, ease: [0.22, 0.61, 0.36, 1] }}
          style={{ display: 'flex', flexDirection: 'column', flex: '1 1 auto', minHeight: 0 }}
        >
          {pageKey === 'rules' && <RulesPage />}

          {pageKey === 'lobby' && (
            <LobbyPage />
          )}

          {pageKey === 'game' && <GamePage />}

          {pageKey === 'result' && <ResultPage />}
        </motion.div>
      </AnimatePresence>

      {/* 游戏页与大厅页顶部工具条由各自页面渲染，这里只挂全局浮层 */}
      <RuleModal />
      <CelebrationLayer />
      <ChampionFlash />
      <ToastStack />

      {/* 无障碍：给屏幕阅读器一个当前阶段提示。
          必须以 hasJoined 打头 —— 被房主赶出来之后快照还留着上一局的残影
          （见 gameStore 里 room:closed 的注释），只看 phase 会一直念上一局的阶段。 */}
      <span className="sr-only" aria-live="polite">
        {hasJoined && phase ? `当前阶段：${phase}` : '尚未入席'}
      </span>
    </div>
  );
}
