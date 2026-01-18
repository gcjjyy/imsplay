/**
 * adplug.ts - AdPlug WASM wrapper for browser
 *
 * Provides a clean interface for loading and playing AdLib music files
 * using the AdPlug library compiled to WebAssembly.
 */

// Types for Emscripten module
interface AdPlugEmscriptenModule {
  _malloc(size: number): number;
  _free(ptr: number): void;
  _emu_init(sampleRate: number): number;
  _emu_teardown(): void;
  _emu_add_file(filenamePtr: number, dataPtr: number, size: number): number;
  _emu_load_file(filenamePtr: number, dataPtr: number, size: number): number;
  _emu_compute_audio_samples(): number;
  _emu_get_audio_buffer(): number;
  _emu_get_audio_buffer_length(): number;
  _emu_get_current_position(): number;
  _emu_get_max_position(): number;
  _emu_seek_position(ms: number): void;
  _emu_get_track_info(): number;
  _emu_get_subsong_count(): number;
  _emu_set_subsong(subsong: number): void;
  _emu_get_sample_rate(): number;
  _emu_rewind(): void;
  _emu_get_current_tick(): number;
  _emu_get_refresh_rate(): number;
  _emu_set_loop_enabled(enabled: number): void;
  _emu_get_loop_enabled(): number;

  HEAP8: Int8Array;
  HEAP16: Int16Array;
  HEAP32: Int32Array;
  HEAPU8: Uint8Array;
  HEAPU16: Uint16Array;
  HEAPU32: Uint32Array;

  UTF8ToString(ptr: number): string;
  stringToUTF8(str: string, outPtr: number, maxBytesToWrite: number): void;
}

export interface TrackInfo {
  title: string;
  author: string;
  type: string;
  description: string;
}

export interface PlaybackState {
  isPlaying: boolean;
  currentPosition: number; // ms
  maxPosition: number; // ms
  sampleRate: number;
  subsongCount: number;
  currentSubsong: number;
  trackInfo: TrackInfo;
}

// Module loader cache
let modulePromise: Promise<AdPlugEmscriptenModule> | null = null;
// Track if emulator has been initialized at least once (to know if teardown is needed)
let hasEverInitialized = false;

/**
 * Load the AdPlug WASM module
 */
async function loadModule(): Promise<AdPlugEmscriptenModule> {
  if (modulePromise) {
    return modulePromise;
  }

  modulePromise = new Promise(async (resolve, reject) => {
    try {
      // Load the Emscripten JS file dynamically
      const script = document.createElement('script');
      script.src = '/adplug.js';

      script.onload = async () => {
        // AdPlugModule should be available globally after script loads
        const AdPlugModule = (window as any).AdPlugModule;
        if (!AdPlugModule) {
          reject(new Error('AdPlugModule not found after script load'));
          return;
        }

        // Initialize the module
        const module = await AdPlugModule({
          locateFile: (path: string) => {
            if (path.endsWith('.wasm')) {
              return '/adplug.wasm';
            }
            return path;
          }
        });

        resolve(module);
      };

      script.onerror = () => {
        reject(new Error('Failed to load adplug.js'));
      };

      document.head.appendChild(script);
    } catch (err) {
      reject(err);
    }
  });

  return modulePromise;
}

/**
 * AdPlug Player class
 * Wraps the WASM module and provides a high-level playback interface
 */
export class AdPlugPlayer {
  private module: AdPlugEmscriptenModule | null = null;
  private isInitialized = false;
  private isPlaying = false;
  private currentSubsong = 0;
  private sampleRate = 49716;
  private fileLoaded = false;
  private sampleBuffer: Int16Array | null = null; // 버퍼 재사용으로 메모리 할당 최소화

  /**
   * Initialize the player with specified sample rate
   */
  async init(sampleRate: number = 49716): Promise<void> {
    this.sampleRate = sampleRate;

    // Load the WASM module
    this.module = await loadModule();

    // 이전 상태 정리 (이전에 초기화된 적이 있을 때만)
    if (hasEverInitialized) {
      this.module._emu_teardown();
    }

    // Initialize the emulator
    const result = this.module._emu_init(sampleRate);
    if (result !== 0) {
      throw new Error("Failed to initialize AdPlug emulator");
    }

    this.isInitialized = true;
    hasEverInitialized = true;
  }

  /**
   * Add a file to the virtual filesystem (for BNK files etc.)
   * Call this before load() to make auxiliary files available
   */
  addFile(filename: string, data: Uint8Array): boolean {
    if (!this.module || !this.isInitialized) {
      throw new Error("Player not initialized. Call init() first.");
    }

    // Allocate memory for filename
    const filenameBytes = new TextEncoder().encode(filename + "\0");
    const filenamePtr = this.module._malloc(filenameBytes.length);
    this.module.HEAPU8.set(filenameBytes, filenamePtr);

    // Allocate memory for file data
    const dataPtr = this.module._malloc(data.length);
    this.module.HEAPU8.set(data, dataPtr);

    // Add the file
    const result = this.module._emu_add_file(filenamePtr, dataPtr, data.length);

    // Free allocated memory
    this.module._free(filenamePtr);
    this.module._free(dataPtr);

    return result === 0;
  }

  /**
   * Load a music file from Uint8Array
   */
  load(filename: string, data: Uint8Array): boolean {
    if (!this.module || !this.isInitialized) {
      throw new Error("Player not initialized. Call init() first.");
    }

    // Allocate memory for filename
    const filenameBytes = new TextEncoder().encode(filename + "\0");
    const filenamePtr = this.module._malloc(filenameBytes.length);
    this.module.HEAPU8.set(filenameBytes, filenamePtr);

    // Allocate memory for file data
    const dataPtr = this.module._malloc(data.length);
    this.module.HEAPU8.set(data, dataPtr);

    // Load the file
    const result = this.module._emu_load_file(filenamePtr, dataPtr, data.length);

    // Free allocated memory
    this.module._free(filenamePtr);
    this.module._free(dataPtr);

    if (result !== 0) {
      this.fileLoaded = false;
      return false;
    }

    this.fileLoaded = true;
    this.isPlaying = true;
    this.currentSubsong = 0;
    return true;
  }

  /**
   * Generate audio samples
   * Returns Int16Array of stereo samples (interleaved L/R)
   */
  generateSamples(): { samples: Int16Array; finished: boolean } {
    if (!this.module || !this.fileLoaded) {
      return { samples: new Int16Array(0), finished: true };
    }

    // Generate samples
    const finished = this.module._emu_compute_audio_samples() !== 0;

    // Get buffer info
    const bufferPtr = this.module._emu_get_audio_buffer();
    const bufferLength = this.module._emu_get_audio_buffer_length();

    // Calculate number of samples (buffer is in bytes, each sample is 2 bytes)
    const numSamples = bufferLength / 2;

    // 버퍼 재사용 (크기가 다르면 재할당)
    if (!this.sampleBuffer || this.sampleBuffer.length !== numSamples) {
      this.sampleBuffer = new Int16Array(numSamples);
    }

    // Copy samples from WASM memory
    const startOffset = bufferPtr / 2; // Convert byte offset to Int16 offset
    this.sampleBuffer.set(this.module.HEAP16.subarray(startOffset, startOffset + numSamples));

    if (finished) {
      this.isPlaying = false;
    }

    return { samples: this.sampleBuffer, finished };
  }

  /**
   * Seek to position in milliseconds
   */
  seek(ms: number): void {
    if (this.module && this.fileLoaded) {
      this.module._emu_seek_position(ms);
    }
  }

  /**
   * Rewind to beginning
   */
  rewind(): void {
    if (this.module && this.fileLoaded) {
      this.module._emu_rewind();
      this.isPlaying = true;
    }
  }

  /**
   * Get current tick count (for ISS lyrics synchronization)
   */
  getCurrentTick(): number {
    if (!this.module || !this.fileLoaded) {
      return 0;
    }
    return this.module._emu_get_current_tick();
  }

  /**
   * Get refresh rate (ticks per second)
   */
  getRefreshRate(): number {
    if (!this.module || !this.fileLoaded) {
      return 70.0;
    }
    return this.module._emu_get_refresh_rate();
  }

  /**
   * Set current subsong
   */
  setSubsong(subsong: number): void {
    if (this.module && this.fileLoaded) {
      this.module._emu_set_subsong(subsong);
      this.currentSubsong = subsong;
      this.isPlaying = true;
    }
  }

  /**
   * Get track information
   */
  getTrackInfo(): TrackInfo {
    if (!this.module || !this.fileLoaded) {
      return { title: "", author: "", type: "", description: "" };
    }

    const infoPtr = this.module._emu_get_track_info();
    const infoStr = this.module.UTF8ToString(infoPtr);
    const parts = infoStr.split("|");

    return {
      title: parts[0] || "",
      author: parts[1] || "",
      type: parts[2] || "",
      description: parts[3] || "",
    };
  }

  /**
   * Get current playback state
   */
  getState(): PlaybackState {
    if (!this.module || !this.fileLoaded) {
      return {
        isPlaying: false,
        currentPosition: 0,
        maxPosition: 0,
        sampleRate: this.sampleRate,
        subsongCount: 0,
        currentSubsong: 0,
        trackInfo: { title: "", author: "", type: "", description: "" },
      };
    }

    return {
      isPlaying: this.isPlaying,
      currentPosition: this.module._emu_get_current_position(),
      maxPosition: this.module._emu_get_max_position(),
      sampleRate: this.module._emu_get_sample_rate(),
      subsongCount: this.module._emu_get_subsong_count(),
      currentSubsong: this.currentSubsong,
      trackInfo: this.getTrackInfo(),
    };
  }

  /**
   * Check if player is currently playing
   */
  getIsPlaying(): boolean {
    return this.isPlaying;
  }

  /**
   * Set playing state (for external control)
   */
  setIsPlaying(playing: boolean): void {
    this.isPlaying = playing;
  }

  /**
   * Check if file is loaded
   */
  isFileLoaded(): boolean {
    return this.fileLoaded;
  }

  /**
   * Set loop enabled flag (for VGM native loop support)
   */
  setLoopEnabled(enabled: boolean): void {
    if (this.module) {
      this.module._emu_set_loop_enabled(enabled ? 1 : 0);
    }
  }

  /**
   * Get loop enabled flag
   */
  getLoopEnabled(): boolean {
    if (!this.module) {
      return false;
    }
    return this.module._emu_get_loop_enabled() !== 0;
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    // _emu_teardown()은 init()에서 처리하므로 여기서 호출하지 않음
    // (여러 player 인스턴스가 같은 WASM 모듈을 공유하기 때문에
    //  한 인스턴스의 destroy가 다른 인스턴스의 상태를 날릴 수 있음)
    this.isInitialized = false;
    this.fileLoaded = false;
    this.isPlaying = false;
    this.sampleBuffer = null; // 메모리 해제
  }
}

/**
 * Supported file extensions by AdPlug
 */
export const ADPLUG_EXTENSIONS = [
  // Most common formats
  '.ims', '.rol', '.vgm', '.vgz',
  // AdPlug supported formats
  '.a2m', '.a2t', '.adl', '.agd', '.amd', '.bam', '.bmf', '.cff', '.cmf',
  '.d00', '.dfm', '.dmo', '.dro', '.dtm', '.got', '.ha2', '.hsc', '.hsp',
  '.hsq', '.imf', '.jbm', '.ksm', '.laa', '.lds', '.m', '.mad', '.mdi',
  '.mid', '.mkj', '.msc', '.mtk', '.mtr', '.mus', '.pis', '.plx', '.rad',
  '.raw', '.rix', '.s3m', '.sa2', '.sat', '.sci', '.sdb', '.sng', '.sop',
  '.sqx', '.xad', '.xms', '.xsm',
];

/**
 * Check if a filename is supported by AdPlug
 */
export function isAdPlugSupported(filename: string): boolean {
  const ext = filename.toLowerCase().substring(filename.lastIndexOf('.'));
  return ADPLUG_EXTENSIONS.includes(ext);
}
