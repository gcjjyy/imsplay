/**
 * audio-worklet-loader.client.ts
 *
 * .client.ts 확장자로 SSR 빌드에서 완전히 제외됨
 * @ain1084/audio-worklet-stream 모듈은 브라우저 전용이므로 클라이언트에서만 로드
 */

export async function createStreamNodeFactory(audioContext: AudioContext) {
  const { StreamNodeFactory } = await import("@ain1084/audio-worklet-stream");
  return StreamNodeFactory.create(audioContext);
}
