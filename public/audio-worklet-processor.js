/**
 * AudioWorkletProcessor for AdPlug playback
 *
 * Uses a queue-based buffer to receive samples from the main thread
 * and outputs them with consistent timing.
 */

class AdPlugProcessor extends AudioWorkletProcessor {
  constructor() {
    super();

    // 샘플 큐 (Float32Array 배열)
    this.sampleQueue = [];
    this.totalQueuedFrames = 0;  // 큐에 있는 총 프레임 수 추적 (O(1) 연산용)
    this.currentBuffer = null;
    this.currentOffset = 0;
    this.totalSamplesOutput = 0;  // 총 출력 샘플 수 (ISS 동기화용)
    this.lastPositionUpdate = 0;  // 마지막 위치 업데이트 시점

    // Receive samples from main thread
    this.port.onmessage = (event) => {
      if (event.data.type === 'samples') {
        // 큐 크기 제한 (최대 2초 분량 = 88200 프레임)
        // 너무 많이 쌓이면 오래된 것 버림 (메모리 누수 방지)
        const MAX_QUEUE_FRAMES = 88200;
        if (this.totalQueuedFrames > MAX_QUEUE_FRAMES) {
          // 큐가 너무 크면 새 샘플 무시 (이미 충분함)
          return;
        }

        // 큐에 추가 (복사해서 저장)
        const samples = new Float32Array(event.data.samples);
        this.sampleQueue.push(samples);
        // O(1)로 프레임 수 업데이트
        this.totalQueuedFrames += samples.length / 2;
      } else if (event.data.type === 'clear') {
        // Clear buffer
        this.sampleQueue = [];
        this.totalQueuedFrames = 0;
        this.currentBuffer = null;
        this.currentOffset = 0;
        this.totalSamplesOutput = 0;
        this.lastPositionUpdate = 0;
        // 클리어 완료 알림
        this.port.postMessage({ type: 'cleared' });
      }
    };
  }

  process(inputs, outputs, parameters) {
    const output = outputs[0];
    const outputL = output[0];
    const outputR = output[1];

    if (!outputL || !outputR) {
      return true;
    }

    const frameCount = outputL.length;

    for (let i = 0; i < frameCount; i++) {
      // 현재 버퍼가 없거나 다 읽었으면 다음 버퍼 가져오기
      if (!this.currentBuffer || this.currentOffset >= this.currentBuffer.length) {
        if (this.sampleQueue.length > 0) {
          const nextBuffer = this.sampleQueue.shift();
          // O(1)로 프레임 수 감소
          this.totalQueuedFrames -= nextBuffer.length / 2;
          this.currentBuffer = nextBuffer;
          this.currentOffset = 0;
        } else {
          // 버퍼 없음 - 무음 출력
          outputL[i] = 0;
          outputR[i] = 0;
          continue;
        }
      }

      // 스테레오 샘플 출력
      outputL[i] = this.currentBuffer[this.currentOffset];
      outputR[i] = this.currentBuffer[this.currentOffset + 1];
      this.currentOffset += 2;
      this.totalSamplesOutput++;  // 프레임 카운트 (샘플 쌍)

      // 카운터 오버플로우 방지 (약 6시간마다 리셋)
      // Number.MAX_SAFE_INTEGER에 도달하기 전에 리셋
      if (this.totalSamplesOutput > 1000000000) {
        this.totalSamplesOutput = 0;
        this.lastPositionUpdate = 0;
      }
    }

    // 큐가 거의 비었으면 더 요청 (O(1) 추적 변수 사용)
    const currentRemaining = this.currentBuffer ? (this.currentBuffer.length - this.currentOffset) / 2 : 0;
    const totalFrames = this.totalQueuedFrames + currentRemaining;

    // 16384 프레임 미만이면 추가 요청 (~370ms at 44100Hz)
    if (totalFrames < 16384) {
      this.port.postMessage({
        type: 'needSamples',
        frames: totalFrames,
        samplesOutput: this.totalSamplesOutput
      });
      this.lastPositionUpdate = this.totalSamplesOutput;
    }

    // 주기적 위치 업데이트 (~30fps = 매 1470 프레임, ~33ms at 44100Hz)
    // needSamples와 별개로 UI가 항상 최신 위치를 받도록 함
    if (this.totalSamplesOutput - this.lastPositionUpdate >= 1470) {
      this.port.postMessage({
        type: 'position',
        samplesOutput: this.totalSamplesOutput
      });
      this.lastPositionUpdate = this.totalSamplesOutput;
    }

    return true;
  }
}

registerProcessor('adplug-processor', AdPlugProcessor);
