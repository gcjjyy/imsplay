/**
 * ISS (IMPlay Song Script) 파싱 API 엔드포인트
 *
 * POST /api/parse-iss
 * - ISS 파일 바이너리를 받아서 파싱
 * - Johab → UTF-8 변환
 * - JSON 형태로 반환
 *
 * Based on: imsplayer_1.0_build_2_source/Iss.cpp
 */

import { Iconv } from "iconv";

export interface ISSRecord {
  kasaTick: number;   // Tick timing (actual tick / 8)
  line: number;       // Line number (0-indexed)
  startX: number;     // Highlighting start position
  widthX: number;     // Highlighting width
}

export interface ISSData {
  writer: string;      // 작사가
  composer: string;    // 작곡가
  singer: string;      // 가수
  editor: string;      // ISS 편집자
  records: ISSRecord[];
  scripts: string[];   // 가사 라인들
}

/**
 * POST handler - ISS 파일 파싱
 */
export async function action({ request }: { request: Request }) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;

    if (!file) {
      return Response.json({ error: 'No file provided' }, { status: 400 });
    }

    // File을 ArrayBuffer로 읽기
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // ISS 파싱
    const issData = parseISS(buffer);

    return Response.json(issData);
  } catch (error) {
    console.error('ISS parsing error:', error);
    return Response.json(
      { error: 'Failed to parse ISS file' },
      { status: 500 }
    );
  }
}

/**
 * ISS 파일 파싱 함수
 *
 * ISS File Structure:
 * - Header (154 bytes):
 *   - Offset 0-19: Signature "IMPlay Song V2.0    "
 *   - Offset 20-29: Reserved
 *   - Offset 30-59: Writer (작사가, Johab encoding)
 *   - Offset 60-89: Composer (작곡가, Johab encoding)
 *   - Offset 90-119: Singer (가수, Johab encoding)
 *   - Offset 120-149: Editor (ISS 편집자, Johab encoding)
 *   - Offset 150-151: rec_count (uint16 LE)
 *   - Offset 152-153: line_count (uint16 LE)
 * - Records (rec_count × 5 bytes each)
 * - Scripts (line_count × 64 bytes each)
 */
function parseISS(buffer: Buffer): ISSData {
  const iconv = new Iconv('JOHAB', 'UTF-8//IGNORE');
  let offset = 0;

  // Parse header (154 bytes)
  const signature = buffer.toString('ascii', offset, offset + 20).trim();
  offset += 30; // Skip signature + reserved (20 + 10)

  // Read Johab-encoded strings
  const writerBytes = readNullTerminated(buffer, offset, 30);
  const writer = safeJohabToUtf8(iconv, writerBytes).trim();
  offset += 30;

  const composerBytes = readNullTerminated(buffer, offset, 30);
  const composer = safeJohabToUtf8(iconv, composerBytes).trim();
  offset += 30;

  const singerBytes = readNullTerminated(buffer, offset, 30);
  const singer = safeJohabToUtf8(iconv, singerBytes).trim();
  offset += 30;

  const editorBytes = readNullTerminated(buffer, offset, 30);
  const editor = safeJohabToUtf8(iconv, editorBytes).trim();
  offset += 30;

  // Read counts
  const recCount = buffer.readUInt16LE(offset);
  offset += 2;
  const lineCount = buffer.readUInt16LE(offset);
  offset += 2;

  // Parse records (5 bytes each)
  const records: ISSRecord[] = [];
  for (let i = 0; i < recCount; i++) {
    records.push({
      kasaTick: buffer.readUInt16LE(offset),
      line: buffer.readInt8(offset + 2),
      startX: buffer.readInt8(offset + 3),
      widthX: buffer.readInt8(offset + 4),
    });
    offset += 5;
  }

  // Parse scripts (64 bytes each)
  const scripts: string[] = [];
  for (let i = 0; i < lineCount; i++) {
    const scriptBytes = readNullTerminated(buffer, offset, 64);
    const script = safeJohabToUtf8(iconv, scriptBytes);
    scripts.push(script);
    offset += 64;
  }

  return {
    writer,
    composer,
    singer,
    editor,
    records,
    scripts,
  };
}

/**
 * Read null-terminated string from buffer
 */
function readNullTerminated(buffer: Buffer, offset: number, maxLength: number): Buffer {
  const slice = buffer.subarray(offset, offset + maxLength);
  const nullIndex = slice.indexOf(0);
  return nullIndex >= 0 ? slice.subarray(0, nullIndex) : slice;
}

/**
 * Safely convert Johab bytes to UTF-8 string
 * Handles incomplete character sequences by truncating if necessary
 */
function safeJohabToUtf8(iconv: Iconv, bytes: Buffer): string {
  if (bytes.length === 0) return '';

  try {
    return iconv.convert(bytes).toString('utf8');
  } catch (error) {
    // If conversion fails due to incomplete sequence, try removing last byte(s)
    // Johab characters are at most 2 bytes, so try removing up to 2 bytes
    for (let i = 1; i <= Math.min(2, bytes.length); i++) {
      try {
        const truncated = bytes.subarray(0, bytes.length - i);
        return iconv.convert(truncated).toString('utf8');
      } catch {
        continue;
      }
    }
    // If all attempts fail, return empty string
    return '';
  }
}
