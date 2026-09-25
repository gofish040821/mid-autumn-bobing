/**
 * Socket.IO 事件契约（双向强类型）。
 *
 * 设计原则：
 *  - 客户端只能表达「意图」（我要博饼 / 我要开始），永远不提交 dice / award / score / inventory。
 *  - 服务端所有广播都携带完整 GameSnapshot，任何一次丢包都能被下一次广播自愈。
 */
import type {
  Ack,
  CreateRoomResult,
  GameSnapshot,
  JoinResult,
  PlayerState,
  RollAck,
  RollRecord,
  SiteStats,
} from './types.js';
import type { RoomConfigInput } from './schemas.js';

/* ------------------------------------------------------------------ *
 * Payloads
 * ------------------------------------------------------------------ */

export interface JoinPayload {
  guestId: string;
  /** 断线重连时携带；首次加入为 null */
  sessionToken?: string | null;
  nickname: string;
  /**
   * 要进哪一桌。
   *
   * 房间不存在时**不会**顺手建一个 —— 打错一个字母就凭空多出一间空房，
   * 而且人会坐在里面等一个永远不会来的朋友。建桌必须走 room:create。
   */
  roomId: string;
}

export interface SyncPayload {
  sessionToken: string;
}

export interface SetNicknamePayload {
  nickname: string;
}

export interface RollPayload {
  /** 服务端下发的回合 id，形如 turn_000023 */
  turnId: string;
  /** 客户端生成的一次性动作 id，用于幂等与双击保护 */
  actionId: string;
}

/* ------------------------------------------------------------------ *
 * Event maps
 * ------------------------------------------------------------------ */

export interface ClientToServerEvents {
  /** 开一张新桌，返回房间码。房间码由服务端生成，客户端不能指定。可携带自定义奖品配置。 */
  'room:create': (
    payload: RoomConfigInput | undefined,
    ack: (res: Ack<CreateRoomResult>) => void,
  ) => void;
  'room:join': (payload: JoinPayload, ack: (res: Ack<JoinResult>) => void) => void;
  'room:sync': (payload: SyncPayload, ack: (res: Ack<GameSnapshot>) => void) => void;
  'player:setNickname': (payload: SetNicknamePayload, ack: (res: Ack<PlayerState>) => void) => void;
  'game:start': (payload: undefined, ack: (res: Ack<GameSnapshot>) => void) => void;
  'game:roll': (payload: RollPayload, ack: (res: Ack<RollAck>) => void) => void;
  'game:restart': (payload: undefined, ack: (res: Ack<GameSnapshot>) => void) => void;
}

export interface ServerToClientEvents {
  'room:snapshot': (payload: { snapshot: GameSnapshot }) => void;
  'room:playerJoined': (payload: { snapshot: GameSnapshot; player: PlayerState }) => void;
  'room:playerLeft': (payload: { snapshot: GameSnapshot; playerId: string }) => void;
  'room:playerDisconnected': (payload: { snapshot: GameSnapshot; playerId: string }) => void;
  'room:playerReconnected': (payload: { snapshot: GameSnapshot; playerId: string }) => void;
  'game:started': (payload: { snapshot: GameSnapshot }) => void;
  'turn:changed': (payload: { snapshot: GameSnapshot }) => void;
  'roll:started': (payload: {
    snapshot: GameSnapshot;
    turnId: string;
    playerId: string;
    seat: number;
    auto: boolean;
  }) => void;
  'roll:result': (payload: { snapshot: GameSnapshot; roll: RollRecord }) => void;
  'inventory:updated': (payload: { snapshot: GameSnapshot }) => void;
  'score:updated': (payload: { snapshot: GameSnapshot }) => void;
  'champion:started': (payload: { snapshot: GameSnapshot }) => void;
  'champion:updated': (payload: {
    snapshot: GameSnapshot;
    replaced: boolean;
    previousNickname: string | null;
  }) => void;
  'champion:queueUpdated': (payload: { snapshot: GameSnapshot }) => void;
  'game:finished': (payload: { snapshot: GameSnapshot }) => void;
  /**
   * 这一桌散伙了，收到的人请退出去。
   *
   * 目前只有一个触发条件：**房主离席**。房主是开这张桌的人，他走了，
   * 这桌就没有下一任主人（我们刻意不做房主移交），整桌作废。
   *
   * 收到这条之后，客户端那边的座位凭证也一并作废了 —— 刷新页面不会再
   * 拿着旧 token 去进一个已经不存在的房间。要接着玩就重新开一张桌。
   */
  'room:closed': (payload: {
    roomId: string;
    reason: 'HOST_LEFT';
    message: string;
  }) => void;
  /**
   * 站点统计变化。全局广播，与房间无关——所以不走 snapshot 那套。
   * 连接建立、有人首次到访、有人断开时各推一次。
   */
  'stats:updated': (payload: { stats: SiteStats }) => void;
}

export interface InterServerEvents {
  ping: () => void;
}

export interface SocketData {
  playerId?: string;
  roomId?: string;
}

/** 服务端到客户端的全部事件名，供客户端做类型安全的 on()。 */
export const SERVER_EVENTS: readonly (keyof ServerToClientEvents)[] = [
  'room:snapshot',
  'room:playerJoined',
  'room:playerLeft',
  'room:playerDisconnected',
  'room:playerReconnected',
  'game:started',
  'turn:changed',
  'roll:started',
  'roll:result',
  'inventory:updated',
  'score:updated',
  'champion:started',
  'champion:updated',
  'champion:queueUpdated',
  'game:finished',
  'room:closed',
  'stats:updated',
] as const;
