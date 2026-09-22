/**
 * PlayerManager —— socket 与玩家身份的映射。
 *
 * 关键点：socket.id 会因为断线重连而变化，**永远不能**作为玩家身份。
 * 这里只维护 socket.id → playerId 的当下映射，真正的身份在 sessionToken。
 */
export class PlayerManager {
  private readonly socketToPlayer = new Map<string, string>();
  private readonly playerToSocket = new Map<string, string>();

  bind(socketId: string, playerId: string): void {
    const previousSocket = this.playerToSocket.get(playerId);
    if (previousSocket && previousSocket !== socketId) {
      this.socketToPlayer.delete(previousSocket);
    }
    const previousPlayer = this.socketToPlayer.get(socketId);
    if (previousPlayer && previousPlayer !== playerId) {
      this.playerToSocket.delete(previousPlayer);
    }
    this.socketToPlayer.set(socketId, playerId);
    this.playerToSocket.set(playerId, socketId);
  }

  playerIdOf(socketId: string): string | undefined {
    return this.socketToPlayer.get(socketId);
  }

  socketIdOf(playerId: string): string | undefined {
    return this.playerToSocket.get(playerId);
  }

  unbindSocket(socketId: string): string | undefined {
    const playerId = this.socketToPlayer.get(socketId);
    if (!playerId) return undefined;
    this.socketToPlayer.delete(socketId);
    if (this.playerToSocket.get(playerId) === socketId) {
      this.playerToSocket.delete(playerId);
    }
    return playerId;
  }

  get size(): number {
    return this.socketToPlayer.size;
  }
}
