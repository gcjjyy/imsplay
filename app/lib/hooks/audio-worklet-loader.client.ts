/**
 * audio-worklet-loader.client.ts
 *
 * .client.ts 확장자로 SSR 빌드에서 완전히 제외됨
 * @ain1084/audio-worklet-stream 모듈은 브라우저 전용이므로 클라이언트에서만 로드
 */

/**
 * SharedArrayBuffer 지원 여부 확인
 */
export function isSharedArrayBufferSupported(): boolean {
  return typeof SharedArrayBuffer !== 'undefined';
}

export async function createStreamNodeFactory(audioContext: AudioContext) {
  // SharedArrayBuffer 지원 여부 확인
  if (!isSharedArrayBufferSupported()) {
    throw new Error(
      '이 브라우저는 SharedArrayBuffer를 지원하지 않습니다. ' +
      'Chrome, Edge, Firefox 등 최신 브라우저를 사용해주세요.'
    );
  }

  const { StreamNodeFactory } = await import("@ain1084/audio-worklet-stream");
  return StreamNodeFactory.create(audioContext);
}
