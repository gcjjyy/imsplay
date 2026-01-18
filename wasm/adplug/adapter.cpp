/*
 * adapter.cpp - AdPlug WASM Adapter
 * Bridges adplug C++ library to JavaScript/WASM
 *
 * Copyright (C) 2025, MIT License
 */

#include <cstdint>
#include <cstring>
#include <string>
#include <map>

#include "adplug.h"
#include "nemuopl.h"
#include "binstr.h"

// Audio buffer size (samples per channel)
static const int AUDIO_BUFFER_SIZE = 512;

// Global state
static CNemuopl* g_opl = nullptr;
static CPlayer* g_player = nullptr;
static int g_sampleRate = 49716;
static int16_t* g_audioBuffer = nullptr;
static int g_audioBufferLength = 0;
static unsigned long g_currentPosition = 0;
static unsigned long g_maxPosition = 0;
static float g_sampleAccumulator = 0.0f;
static unsigned long g_totalSamplesGenerated = 0;
static unsigned long g_currentTick = 0; // ISS 가사 동기화용 틱 카운터

// Track info strings
static char g_title[256] = {0};
static char g_author[256] = {0};
static char g_type[256] = {0};
static char g_desc[1024] = {0};

// Multi-file storage for BNK files etc.
struct FileData {
    uint8_t* data;
    size_t size;
};
static std::map<std::string, FileData> g_files;

// Loop enabled flag (accessible from vgm.cpp)
bool g_loopEnabled = false;

// Convert filename to lowercase for case-insensitive matching
static std::string toLower(const std::string& s) {
    std::string result = s;
    for (size_t i = 0; i < result.length(); i++) {
        if (result[i] >= 'A' && result[i] <= 'Z') {
            result[i] = result[i] - 'A' + 'a';
        }
    }
    return result;
}

// Extract just the filename from a path
static std::string getFilename(const std::string& path) {
    size_t pos = path.find_last_of("/\\");
    if (pos != std::string::npos) {
        return path.substr(pos + 1);
    }
    return path;
}

// Memory file provider for loading from buffer
// Tracks allocated buffers to properly free them in close()
class CProvider_Memory : public CFileProvider
{
private:
    // Map from binistream pointer to its data buffer for proper cleanup
    mutable std::map<binistream*, uint8_t*> m_streamBuffers;

public:
    CProvider_Memory() {}

    virtual binistream* open(std::string filename) const override
    {
        // Try exact match first
        auto it = g_files.find(filename);
        if (it == g_files.end()) {
            // Try just the filename (no path)
            std::string justName = getFilename(filename);
            it = g_files.find(justName);
        }
        if (it == g_files.end()) {
            // Try case-insensitive match
            std::string lowerName = toLower(getFilename(filename));
            for (auto& pair : g_files) {
                if (toLower(getFilename(pair.first)) == lowerName) {
                    it = g_files.find(pair.first);
                    break;
                }
            }
        }

        if (it == g_files.end()) {
            return nullptr;
        }

        // Create a copy of the data for the stream
        uint8_t* dataCopy = new uint8_t[it->second.size];
        memcpy(dataCopy, it->second.data, it->second.size);
        binistream* stream = new binisstream(dataCopy, it->second.size);

        // Track the buffer so we can free it in close()
        m_streamBuffers[stream] = dataCopy;

        return stream;
    }

    virtual void close(binistream* f) const override
    {
        if (f) {
            // Free the data buffer associated with this stream
            auto it = m_streamBuffers.find(f);
            if (it != m_streamBuffers.end()) {
                delete[] it->second;
                m_streamBuffers.erase(it);
            }
            delete f;
        }
    }

    // Clean up any remaining buffers (called during teardown)
    void clearBuffers()
    {
        for (auto& pair : m_streamBuffers) {
            delete[] pair.second;
        }
        m_streamBuffers.clear();
    }
};

static CProvider_Memory g_memProvider;

// Helper to calculate samples per tick
static float getSamplesPerTick()
{
    if (!g_player) return 0;
    float refreshRate = g_player->getrefresh();
    if (refreshRate <= 0) refreshRate = 70.0f; // Default

    return static_cast<float>(g_sampleRate) / refreshRate;
}

extern "C" {

/**
 * Initialize the emulator
 * @param sampleRate Audio sample rate (e.g., 49716)
 * @return 0 on success, -1 on failure
 */
int emu_init(int sampleRate)
{
    // Clean up any existing state
    if (g_player) {
        delete g_player;  // This should close all streams via file provider
        g_player = nullptr;
    }
    if (g_opl) {
        delete g_opl;
        g_opl = nullptr;
    }
    if (g_audioBuffer) {
        delete[] g_audioBuffer;
        g_audioBuffer = nullptr;
    }

    // Note: Don't call clearBuffers() here - close() handles buffer cleanup
    // Calling clearBuffers() while streams might still be open causes garbage audio

    // Clear file storage
    for (auto& pair : g_files) {
        delete[] pair.second.data;
    }
    g_files.clear();

    g_sampleRate = sampleRate > 0 ? sampleRate : 49716;

    // Create OPL emulator
    g_opl = new CNemuopl(g_sampleRate);
    if (!g_opl) {
        return -1;
    }
    g_opl->init();

    // Allocate audio buffer (stereo) - zero-initialized to prevent garbage audio
    g_audioBuffer = new int16_t[AUDIO_BUFFER_SIZE * 2]();
    g_audioBufferLength = 0;

    // Reset position and timing
    g_currentPosition = 0;
    g_maxPosition = 0;
    g_sampleAccumulator = 0.0f;
    g_totalSamplesGenerated = 0;
    g_currentTick = 0;

    return 0;
}

/**
 * Clean up and release resources
 */
void emu_teardown()
{
    if (g_player) {
        delete g_player;  // This should close all streams via file provider
        g_player = nullptr;
    }
    if (g_opl) {
        delete g_opl;
        g_opl = nullptr;
    }
    if (g_audioBuffer) {
        delete[] g_audioBuffer;
        g_audioBuffer = nullptr;
    }

    // Note: Don't call clearBuffers() here - close() handles buffer cleanup

    // Clear file storage
    for (auto& pair : g_files) {
        delete[] pair.second.data;
    }
    g_files.clear();

    g_audioBufferLength = 0;
    g_currentPosition = 0;
    g_maxPosition = 0;
}

/**
 * Add a file to the virtual filesystem
 * Use this to add BNK files before loading the main music file
 * @param filename File name (e.g., "STANDARD.BNK")
 * @param data Pointer to file data
 * @param size Size of file data
 * @return 0 on success
 */
int emu_add_file(const char* filename, const uint8_t* data, int size)
{
    if (!filename || !data || size <= 0) {
        return -1;
    }

    // Remove existing file with same name
    auto it = g_files.find(filename);
    if (it != g_files.end()) {
        delete[] it->second.data;
        g_files.erase(it);
    }

    // Copy and store the file data
    uint8_t* dataCopy = new uint8_t[size];
    memcpy(dataCopy, data, size);
    g_files[filename] = { dataCopy, static_cast<size_t>(size) };

    return 0;
}

/**
 * Load a music file from memory
 * @param filename File name (used for format detection)
 * @param data Pointer to file data
 * @param size Size of file data
 * @return 0 on success, -1 on failure
 */
int emu_load_file(const char* filename, const uint8_t* data, int size)
{
    if (!g_opl || !filename || !data || size <= 0) {
        return -1;
    }

    // Clean up existing player
    if (g_player) {
        delete g_player;
        g_player = nullptr;
    }

    // Re-initialize OPL
    g_opl->init();

    // Reset timing state
    g_sampleAccumulator = 0.0f;
    g_totalSamplesGenerated = 0;
    g_currentTick = 0;

    // Add main file to storage
    emu_add_file(filename, data, size);

    // Use AdPlug factory to create appropriate player
    g_player = CAdPlug::factory(std::string(filename), g_opl,
                                 CAdPlug::players, g_memProvider);

    if (!g_player) {
        return -1;
    }

    // Get track info
    strncpy(g_title, g_player->gettitle().c_str(), sizeof(g_title) - 1);
    strncpy(g_author, g_player->getauthor().c_str(), sizeof(g_author) - 1);
    strncpy(g_type, g_player->gettype().c_str(), sizeof(g_type) - 1);
    strncpy(g_desc, g_player->getdesc().c_str(), sizeof(g_desc) - 1);

    // Calculate song length
    g_maxPosition = g_player->songlength();
    g_currentPosition = 0;

    return 0;
}

/**
 * Generate audio samples
 * Fills the audio buffer with generated samples
 * @return 0 while playing, 1 when song ends
 */
int emu_compute_audio_samples()
{
    if (!g_player || !g_opl || !g_audioBuffer) {
        return 1;
    }

    int samplesGenerated = 0;
    int maxSamples = AUDIO_BUFFER_SIZE;

    while (samplesGenerated < maxSamples) {
        // Generate samples for current tick
        int samplesToGenerate = static_cast<int>(g_sampleAccumulator);
        if (samplesToGenerate > 0) {
            int remaining = maxSamples - samplesGenerated;
            int toGenerate = samplesToGenerate < remaining ? samplesToGenerate : remaining;

            // Generate audio through OPL
            g_opl->update(&g_audioBuffer[samplesGenerated * 2], toGenerate);

            samplesGenerated += toGenerate;
            g_sampleAccumulator -= static_cast<float>(toGenerate);
        }

        // Process next tick
        if (samplesGenerated < maxSamples) {
            bool stillPlaying = g_player->update();
            g_currentTick++; // ISS 가사 동기화용 틱 증가

            if (!stillPlaying) {
                // Song ended
                g_audioBufferLength = samplesGenerated * 2 * sizeof(int16_t);
                return 1;
            }

            // Get samples per tick AFTER update (refresh rate may change)
            float samplesPerTick = getSamplesPerTick();
            g_sampleAccumulator += samplesPerTick;
        }
    }

    // Update position estimate (in ms)
    g_totalSamplesGenerated += samplesGenerated;
    g_currentPosition = static_cast<unsigned long>(
        (static_cast<double>(g_totalSamplesGenerated) / g_sampleRate) * 1000.0
    );

    g_audioBufferLength = samplesGenerated * 2 * sizeof(int16_t);
    return 0;
}

/**
 * Get pointer to audio buffer
 * @return Pointer to stereo int16 samples
 */
int16_t* emu_get_audio_buffer()
{
    return g_audioBuffer;
}

/**
 * Get length of audio buffer in bytes
 * @return Buffer length in bytes
 */
int emu_get_audio_buffer_length()
{
    return g_audioBufferLength;
}

/**
 * Get current playback position in milliseconds
 */
unsigned long emu_get_current_position()
{
    return g_currentPosition;
}

/**
 * Get maximum position (song length) in milliseconds
 */
unsigned long emu_get_max_position()
{
    return g_maxPosition;
}

/**
 * Seek to position in milliseconds
 */
void emu_seek_position(unsigned long ms)
{
    if (g_player) {
        g_player->seek(ms);
        g_currentPosition = ms;
    }
}

/**
 * Get track info as pipe-separated string
 * Format: "title|author|type|desc"
 */
const char* emu_get_track_info()
{
    static char info[2048];
    snprintf(info, sizeof(info), "%s|%s|%s|%s",
             g_title, g_author, g_type, g_desc);
    return info;
}

/**
 * Get number of subsongs
 */
int emu_get_subsong_count()
{
    return g_player ? g_player->getsubsongs() : 0;
}

/**
 * Set current subsong
 */
void emu_set_subsong(int subsong)
{
    if (g_player) {
        g_player->rewind(subsong);
        g_maxPosition = g_player->songlength(subsong);
        g_currentPosition = 0;
    }
}

/**
 * Get sample rate
 */
int emu_get_sample_rate()
{
    return g_sampleRate;
}

/**
 * Rewind to beginning
 */
void emu_rewind()
{
    if (g_player) {
        g_player->rewind(-1);
        g_currentPosition = 0;
        g_currentTick = 0;
        g_sampleAccumulator = 0.0f;
        g_totalSamplesGenerated = 0;
    }
}

/**
 * Get current tick count (for ISS lyrics synchronization)
 * @return Current tick count
 */
unsigned long emu_get_current_tick()
{
    return g_currentTick;
}

/**
 * Get refresh rate (ticks per second)
 * @return Refresh rate in Hz (e.g., 70.0 for 70 ticks/sec)
 */
float emu_get_refresh_rate()
{
    if (!g_player) return 70.0f;
    float rate = g_player->getrefresh();
    return rate > 0 ? rate : 70.0f;
}

/**
 * Set loop enabled flag
 * @param enabled 1 to enable loop, 0 to disable
 */
void emu_set_loop_enabled(int enabled)
{
    g_loopEnabled = (enabled != 0);
}

/**
 * Get loop enabled flag
 * @return 1 if loop enabled, 0 if disabled
 */
int emu_get_loop_enabled()
{
    return g_loopEnabled ? 1 : 0;
}

} // extern "C"
