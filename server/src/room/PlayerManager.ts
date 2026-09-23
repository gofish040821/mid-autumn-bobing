/**
 * PlayerManager —— socket 与玩家身份的映射。
 *
 * 两个关键点：
 *
 * 1. **socket.id 不能当身份。** 它会因为断线重连而变化，真正的身份在 sessionToken。
 *    这里只维护 socket.id → (roomId, playerId) 的当下映射。
 *
 * 2. **playerId 只在房间内唯一。** 每个引擎都有自己的计数器，
 *    所以 A 桌和 B 桌会各自存在一个 `player_0001`。
 *    绑定关系必须带上房间码，否则 B 桌的 socket 会拿到 A 桌的 playerId，
 *    接着就会用别人的身份去掷骰子 —— 而且两边看起来都「正常」，
 *    只有积分记错了人。这是多房间改造里最隐蔽的一处。
 */
export interface SocketBinding {
  roomId: string;
  playerId: string;
}

export class PlayerManager {
  private readonly socketToBinding = new Map<string, SocketBinding>();
  private readonly playerToSocket = new Map<string, string>();

  /** 用作 playerToSocket 的复合键。 */
  private static key(roomId: string, playerId: string): string {
    return `${roomId}\u0000${playerId}`;
  }

  bind(socketId: string, roomId: string, playerId: string): void {
    const composite = PlayerManager.key(roomId, playerId);

    // 同一个座位换了新 socket（重连）→ 先摘掉旧连接，避免留下幽灵映射
    const previousSocket = this.playerToSocket.get(composite);
    if (previousSocket && previousSocket !== socketId) {
      this.socketToBinding.delete(previousSocket);
    }

    // 同一个 socket 绑到了别的座位（换房 / 换座）→ 先摘掉旧座位
    const previousBinding = this.socketToBinding.get(socketId);
    if (previousBinding) {
      const previousKey = PlayerManager.key(previousBinding.roomId, previousBinding.playerId);
      if (previousKey !== composite) this.playerToSocket.delete(previousKey);
    }

    this.socketToBinding.set(socketId, { roomId, playerId });
    this.playerToSocket.set(composite, socketId);
  }

  bindingOf(socketId: string): SocketBinding | undefined {
    return this.socketToBinding.get(socketId);
  }

  socketIdOf(roomId: string, playerId: string): string | undefined {
    return this.playerToSocket.get(PlayerManager.key(roomId, playerId));
  }

  unbindSocket(socketId: string): SocketBinding | undefined {
    const binding = this.socketToBinding.get(socketId);
    if (!binding) return undefined;
    this.socketToBinding.delete(socketId);
    const composite = PlayerManager.key(binding.roomId, binding.playerId);
    if (this.playerToSocket.get(composite) === socketId) {
      this.playerToSocket.delete(composite);
    }
    return binding;
  }

  /**
   * 摘掉某个房间里**所有** socket 的绑定，返回被摘掉的 socket id。
   *
   * 房间整体作废时用（房主离席）。少这一步的话，那些 socket 还留着
   * 「我在某某房间」的映射，之后每一条动作都会被路由到一个已经销毁的引擎上。
   */
  unbindRoom(roomId: string): string[] {
    const sockets: string[] = [];
    for (const [socketId, binding] of this.socketToBinding) {
      if (binding.roomId !== roomId) continue;
      sockets.push(socketId);
      this.socketToBinding.delete(socketId);
      const composite = PlayerManager.key(binding.roomId, binding.playerId);
      if (this.playerToSocket.get(composite) === socketId) {
        this.playerToSocket.delete(composite);
      }
    }
    return sockets;
  }

  /** 某个房间里有多少个活着的连接（用于散场判断与调试）。 */
  countInRoom(roomId: string): number {
    let n = 0;
    for (const binding of this.socketToBinding.values()) {
      if (binding.roomId === roomId) n += 1;
    }
    return n;
  }

  get size(): number {
    return this.socketToBinding.size;
  }
}
