/*
 * adapter.cpp - libopenmpt WASM Adapter
 * Bridges libopenmpt C API to JavaScript/WASM
 *
 * Copyright (C) 2025, MIT License
 */

#include <cstdint>
#include <cstring>
#include <cstdlib>
#include <cstdio>

#include "libopenmpt.h"

// Audio buffer size (frames per call, stereo)
static const int AUDIO_BUFFER_FRAMES = 1024;

// Global state
static openmpt_module* g_module = nullptr;
static int g_sampleRate = 48000;
static float* g_audioBuffer = nullptr;  // Interleaved stereo float buffer
static int g_audioBufferFrames = 0;
static int g_repeatCount = 0;  // 0 = no repeat, -1 = infinite

// Track info strings
static char g_title[256] = {0};
static char g_artist[256] = {0};
static char g_type[256] = {0};
static char g_trackInfo[1024] = {0};

extern "C" {

/**
 * Initialize the player
 * @param sampleRate Audio sample rate (e.g., 48000)
 * @return 0 on success, -1 on failure
 */
int mpt_init(int sampleRate)
{
    // Clean up any existing state
    if (g_module) {
        openmpt_module_destroy(g_module);
        g_module = nullptr;
    }
    if (g_audioBuffer) {
        free(g_audioBuffer);
        g_audioBuffer = nullptr;
    }

    g_sampleRate = sampleRate > 0 ? sampleRate : 48000;

    // Allocate audio buffer (stereo interleaved float)
    g_audioBuffer = (float*)malloc(AUDIO_BUFFER_FRAMES * 2 * sizeof(float));
    if (!g_audioBuffer) {
        return -1;
    }
    memset(g_audioBuffer, 0, AUDIO_BUFFER_FRAMES * 2 * sizeof(float));
    g_audioBufferFrames = 0;

    // Reset track info
    g_title[0] = '\0';
    g_artist[0] = '\0';
    g_type[0] = '\0';
    g_trackInfo[0] = '\0';

    return 0;
}

/**
 * Clean up and release resources
 */
void mpt_teardown()
{
    if (g_module) {
        openmpt_module_destroy(g_module);
        g_module = nullptr;
    }
    if (g_audioBuffer) {
        free(g_audioBuffer);
        g_audioBuffer = nullptr;
    }
    g_audioBufferFrames = 0;
}

/**
 * Load a music file from memory
 * @param filename File name (used for format detection)
 * @param data Pointer to file data
 * @param size Size of file data
 * @return 0 on success, -1 on failure
 */
int mpt_load_file(const char* filename, const uint8_t* data, int size)
{
    if (!data || size <= 0) {
        return -1;
    }

    // Clean up existing module
    if (g_module) {
        openmpt_module_destroy(g_module);
        g_module = nullptr;
    }

    // Create module from memory
    g_module = openmpt_module_create_from_memory2(
        data,
        (size_t)size,
        nullptr,  // log func
        nullptr,  // log user
        nullptr,  // error func
        nullptr,  // error user
        nullptr,  // error
        nullptr,  // error message
        nullptr   // ctls
    );

    if (!g_module) {
        return -1;
    }

    // Set repeat count
    openmpt_module_set_repeat_count(g_module, g_repeatCount);

    // Get track info
    const char* title = openmpt_module_get_metadata(g_module, "title");
    const char* artist = openmpt_module_get_metadata(g_module, "artist");
    const char* type = openmpt_module_get_metadata(g_module, "type_long");

    if (title) {
        strncpy(g_title, title, sizeof(g_title) - 1);
        g_title[sizeof(g_title) - 1] = '\0';
        openmpt_free_string(title);
    } else {
        g_title[0] = '\0';
    }

    if (artist) {
        strncpy(g_artist, artist, sizeof(g_artist) - 1);
        g_artist[sizeof(g_artist) - 1] = '\0';
        openmpt_free_string(artist);
    } else {
        g_artist[0] = '\0';
    }

    if (type) {
        strncpy(g_type, type, sizeof(g_type) - 1);
        g_type[sizeof(g_type) - 1] = '\0';
        openmpt_free_string(type);
    } else {
        g_type[0] = '\0';
    }

    return 0;
}

/**
 * Generate audio samples
 * Fills the audio buffer with generated samples
 * @return 0 while playing, 1 when song ends
 */
int mpt_compute_audio_samples()
{
    if (!g_module || !g_audioBuffer) {
        g_audioBufferFrames = 0;
        return 1;
    }

    // Read interleaved stereo float samples
    size_t framesRead = openmpt_module_read_interleaved_float_stereo(
        g_module,
        g_sampleRate,
        AUDIO_BUFFER_FRAMES,
        g_audioBuffer
    );

    g_audioBufferFrames = (int)framesRead;

    // Check if song ended
    if (framesRead == 0) {
        return 1;
    }

    return 0;
}

/**
 * Get pointer to audio buffer
 * @return Pointer to stereo float samples (interleaved L/R)
 */
float* mpt_get_audio_buffer()
{
    return g_audioBuffer;
}

/**
 * Get number of frames in audio buffer
 * @return Number of frames (each frame = 2 floats for stereo)
 */
int mpt_get_audio_buffer_frames()
{
    return g_audioBufferFrames;
}

/**
 * Get current playback position in seconds
 */
double mpt_get_position_seconds()
{
    if (!g_module) return 0.0;
    return openmpt_module_get_position_seconds(g_module);
}

/**
 * Get total duration in seconds
 */
double mpt_get_duration_seconds()
{
    if (!g_module) return 0.0;
    return openmpt_module_get_duration_seconds(g_module);
}

/**
 * Seek to position in seconds
 */
void mpt_set_position_seconds(double seconds)
{
    if (g_module) {
        openmpt_module_set_position_seconds(g_module, seconds);
    }
}

/**
 * Get track info as pipe-separated string
 * Format: "title|artist|type"
 */
const char* mpt_get_track_info()
{
    snprintf(g_trackInfo, sizeof(g_trackInfo), "%s|%s|%s",
             g_title, g_artist, g_type);
    return g_trackInfo;
}

/**
 * Set repeat count
 * @param count -1 = infinite, 0 = no repeat, n = repeat n times
 */
void mpt_set_repeat_count(int count)
{
    g_repeatCount = count;
    if (g_module) {
        openmpt_module_set_repeat_count(g_module, count);
    }
}

/**
 * Rewind to beginning
 */
void mpt_rewind()
{
    if (g_module) {
        openmpt_module_set_position_seconds(g_module, 0.0);
    }
}

/**
 * Get sample rate
 */
int mpt_get_sample_rate()
{
    return g_sampleRate;
}

} // extern "C"
