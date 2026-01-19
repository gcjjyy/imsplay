/**
 * libopenmpt.ts - libopenmpt WASM wrapper for browser
 *
 * Provides a clean interface for loading and playing MOD/XM/IT/S3M music files
 * using the official libopenmpt library compiled to WebAssembly.
 */

// Types for Emscripten module with libopenmpt C API
interface LibOpenMPTEmscriptenModule {
  _malloc(size: number): number;
  _free(ptr: number): void;

  // libopenmpt C API functions
  _openmpt_module_create_from_memory2(
    filedata: number,
    filesize: number,
    logfunc: number,
    loguser: number,
    errfunc: number,
    erruser: number,
    error: number,
    error_message: number,
    ctls: number
  ): number;
  _openmpt_module_destroy(mod: number): void;
  _openmpt_module_read_interleaved_float_stereo(
    mod: number,
    samplerate: number,
    count: number,
    interleaved_stereo: number
  ): number;
  _openmpt_module_get_position_seconds(mod: number): number;
  _openmpt_module_get_duration_seconds(mod: number): number;
  _openmpt_module_set_position_seconds(mod: number, seconds: number): number;
  _openmpt_module_get_metadata(mod: number, key: number): number;
  _openmpt_module_set_repeat_count(mod: number, repeat_count: number): number;
  _openmpt_module_set_render_param(mod: number, param: number, value: number): number;
  _openmpt_free_string(str: number): void;

  HEAP8: Int8Array;
  HEAP16: Int16Array;
  HEAP32: Int32Array;
  HEAPU8: Uint8Array;
  HEAPU16: Uint16Array;
  HEAPU32: Uint32Array;
  HEAPF32: Float32Array;

  UTF8ToString(ptr: number): string;
  stringToUTF8(str: string, outPtr: number, maxBytesToWrite: number): number;
  lengthBytesUTF8(str: string): number;
}

export interface TrackInfo {
  title: string;
  artist: string;
  type: string;
}

export interface PlaybackState {
  isPlaying: boolean;
  positionSeconds: number;
  durationSeconds: number;
  sampleRate: number;
  trackInfo: TrackInfo;
}

// Audio buffer size (frames per call)
const AUDIO_BUFFER_FRAMES = 1024;

// Render param indices (from libopenmpt)
const OPENMPT_MODULE_RENDER_MASTERGAIN_MILLIBEL = 1;

// Default master gain boost in millibels (100 mB = +1 dB)
const DEFAULT_MASTER_GAIN_MILLIBEL = 100;

// Module loader cache
let modulePromise: Promise<LibOpenMPTEmscriptenModule> | null = null;

/**
 * Load the libopenmpt WASM module
 */
async function loadModule(): Promise<LibOpenMPTEmscriptenModule> {
  if (modulePromise) {
    return modulePromise;
  }

  modulePromise = new Promise(async (resolve, reject) => {
    try {
      // Load the Emscripten JS file dynamically
      const script = document.createElement('script');
      script.src = '/libopenmpt.js';

      script.onload = async () => {
        // libopenmpt should be available globally after script loads
        const libopenmpt = (window as any).libopenmpt;
        if (!libopenmpt) {
          reject(new Error('libopenmpt not found after script load'));
          return;
        }

        // Initialize the module
        const module = await libopenmpt({
          locateFile: (path: string) => {
            if (path.endsWith('.wasm')) {
              return '/libopenmpt.wasm';
            }
            return path;
          }
        });

        resolve(module);
      };

      script.onerror = () => {
        reject(new Error('Failed to load libopenmpt.js'));
      };

      document.head.appendChild(script);
    } catch (err) {
      reject(err);
    }
  });

  return modulePromise;
}

/**
 * libopenmpt Player class
 * Wraps the WASM module and provides a high-level playback interface
 */
export class LibOpenMPTPlayer {
  private module: LibOpenMPTEmscriptenModule | null = null;
  private modulePtr: number = 0; // openmpt_module*
  private isInitialized = false;
  private isPlaying = false;
  private sampleRate = 48000;
  private fileLoaded = false;

  // Audio buffer allocated in WASM heap
  private audioBufferPtr: number = 0;
  private audioBufferSize: number = 0;

  /**
   * Initialize the player with specified sample rate
   */
  async init(sampleRate: number = 48000): Promise<void> {
    this.sampleRate = sampleRate;

    // Load the WASM module
    this.module = await loadModule();

    // Clean up previous module if exists
    if (this.modulePtr !== 0) {
      this.module._openmpt_module_destroy(this.modulePtr);
      this.modulePtr = 0;
    }

    // Free previous audio buffer
    if (this.audioBufferPtr !== 0) {
      this.module._free(this.audioBufferPtr);
      this.audioBufferPtr = 0;
    }

    // Allocate audio buffer for stereo float samples
    this.audioBufferSize = AUDIO_BUFFER_FRAMES * 2; // stereo
    this.audioBufferPtr = this.module._malloc(this.audioBufferSize * 4); // 4 bytes per float

    this.isInitialized = true;
  }

  /**
   * Load a music file from Uint8Array
   */
  load(filename: string, data: Uint8Array): boolean {
    if (!this.module || !this.isInitialized) {
      throw new Error("Player not initialized. Call init() first.");
    }

    // Clean up previous module
    if (this.modulePtr !== 0) {
      this.module._openmpt_module_destroy(this.modulePtr);
      this.modulePtr = 0;
    }

    // Allocate memory for file data
    const dataPtr = this.module._malloc(data.length);
    this.module.HEAPU8.set(data, dataPtr);

    // Create module from memory
    this.modulePtr = this.module._openmpt_module_create_from_memory2(
      dataPtr,
      data.length,
      0, // logfunc (null)
      0, // loguser (null)
      0, // errfunc (null)
      0, // erruser (null)
      0, // error (null)
      0, // error_message (null)
      0  // ctls (null)
    );

    // Free file data memory
    this.module._free(dataPtr);

    if (this.modulePtr === 0) {
      this.fileLoaded = false;
      return false;
    }

    // Set default repeat count to 0 (no loop) - important for track end detection
    this.module._openmpt_module_set_repeat_count(this.modulePtr, 0);

    // Apply master gain boost for consistent volume with other players
    this.module._openmpt_module_set_render_param(
      this.modulePtr,
      OPENMPT_MODULE_RENDER_MASTERGAIN_MILLIBEL,
      DEFAULT_MASTER_GAIN_MILLIBEL
    );

    this.fileLoaded = true;
    this.isPlaying = true;
    return true;
  }

  /**
   * Generate audio samples
   * Returns Float32Array of stereo samples (interleaved L/R)
   */
  generateSamples(): { samples: Float32Array; finished: boolean } {
    if (!this.module || !this.fileLoaded || this.modulePtr === 0) {
      return { samples: new Float32Array(0), finished: true };
    }

    // Read interleaved stereo float samples
    const framesRead = this.module._openmpt_module_read_interleaved_float_stereo(
      this.modulePtr,
      this.sampleRate,
      AUDIO_BUFFER_FRAMES,
      this.audioBufferPtr
    );

    // Calculate number of float samples
    const numSamples = framesRead * 2; // stereo

    // Copy samples from WASM memory
    const samples = new Float32Array(numSamples);
    const startOffset = this.audioBufferPtr / 4; // byte offset to float32 offset
    samples.set(this.module.HEAPF32.subarray(startOffset, startOffset + numSamples));

    // Check if song ended
    const finished = framesRead === 0;
    if (finished) {
      this.isPlaying = false;
    }

    return { samples, finished };
  }

  /**
   * Get metadata string
   */
  private getMetadata(key: string): string {
    if (!this.module || this.modulePtr === 0) {
      return "";
    }

    // Allocate memory for key string
    const keyLen = this.module.lengthBytesUTF8(key) + 1;
    const keyPtr = this.module._malloc(keyLen);
    this.module.stringToUTF8(key, keyPtr, keyLen);

    // Get metadata
    const resultPtr = this.module._openmpt_module_get_metadata(this.modulePtr, keyPtr);

    // Free key memory
    this.module._free(keyPtr);

    if (resultPtr === 0) {
      return "";
    }

    // Read result string
    const result = this.module.UTF8ToString(resultPtr);

    // Free result string
    this.module._openmpt_free_string(resultPtr);

    return result;
  }

  /**
   * Seek to position in seconds
   */
  seek(seconds: number): void {
    if (this.module && this.modulePtr !== 0) {
      this.module._openmpt_module_set_position_seconds(this.modulePtr, seconds);
    }
  }

  /**
   * Rewind to beginning
   */
  rewind(): void {
    if (this.module && this.modulePtr !== 0) {
      this.module._openmpt_module_set_position_seconds(this.modulePtr, 0.0);
      this.isPlaying = true;
    }
  }

  /**
   * Set loop enabled
   * @param enabled true for infinite loop, false for no loop
   */
  setLoopEnabled(enabled: boolean): void {
    if (this.module && this.modulePtr !== 0) {
      this.module._openmpt_module_set_repeat_count(this.modulePtr, enabled ? -1 : 0);
    }
  }

  /**
   * Get track information
   */
  getTrackInfo(): TrackInfo {
    if (!this.module || this.modulePtr === 0) {
      return { title: "", artist: "", type: "" };
    }

    return {
      title: this.getMetadata("title"),
      artist: this.getMetadata("artist"),
      type: this.getMetadata("type_long"),
    };
  }

  /**
   * Get current position in seconds
   */
  getPositionSeconds(): number {
    if (!this.module || this.modulePtr === 0) {
      return 0;
    }
    return this.module._openmpt_module_get_position_seconds(this.modulePtr);
  }

  /**
   * Get total duration in seconds
   */
  getDurationSeconds(): number {
    if (!this.module || this.modulePtr === 0) {
      return 0;
    }
    return this.module._openmpt_module_get_duration_seconds(this.modulePtr);
  }

  /**
   * Get current playback state
   */
  getState(): PlaybackState {
    if (!this.module || this.modulePtr === 0) {
      return {
        isPlaying: false,
        positionSeconds: 0,
        durationSeconds: 0,
        sampleRate: this.sampleRate,
        trackInfo: { title: "", artist: "", type: "" },
      };
    }

    return {
      isPlaying: this.isPlaying,
      positionSeconds: this.module._openmpt_module_get_position_seconds(this.modulePtr),
      durationSeconds: this.module._openmpt_module_get_duration_seconds(this.modulePtr),
      sampleRate: this.sampleRate,
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
   * Clean up resources
   */
  destroy(): void {
    if (this.module) {
      if (this.modulePtr !== 0) {
        this.module._openmpt_module_destroy(this.modulePtr);
        this.modulePtr = 0;
      }
      if (this.audioBufferPtr !== 0) {
        this.module._free(this.audioBufferPtr);
        this.audioBufferPtr = 0;
      }
    }
    this.isInitialized = false;
    this.fileLoaded = false;
    this.isPlaying = false;
  }
}

/**
 * Supported file extensions by libopenmpt
 * These take priority over AdPlug
 */
export const LIBOPENMPT_EXTENSIONS = [
  // Most common tracker formats
  '.mod', '.xm', '.it', '.s3m', '.mptm',
  // Other tracker formats
  '.stm', '.mtm', '.far', '.669', '.okt', '.ult', '.med',
  '.ptm', '.mdl', '.dmf', '.dsm', '.amf', '.ams', '.dbm',
  '.mo3', '.umx', '.j2b', '.gdm', '.sfx', '.wow',
  // Note: .imf is NOT included (AdPlug handles it better for AdLib)
];

/**
 * Check if a filename is supported by libopenmpt
 */
export function isLibOpenMPTSupported(filename: string): boolean {
  const ext = filename.toLowerCase().substring(filename.lastIndexOf('.'));
  return LIBOPENMPT_EXTENSIONS.includes(ext);
}
