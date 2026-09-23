/** WebXR初期化系の呼び出し(requestSession等)がこの時間内に終わらなければタイムアウトとして中断する。 */
export const INIT_TIMEOUT_MS = 15000;

export class InitTimeoutError extends Error {}

export function withTimeout<T>(promise: Promise<T>, ms: number = INIT_TIMEOUT_MS): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new InitTimeoutError(`${ms}ms以内に完了しませんでした`)), ms);
    }),
  ]);
}
