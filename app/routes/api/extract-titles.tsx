import { Iconv } from "iconv";

// Tracker 포맷 확장자
const TRACKER_FORMATS = ["MOD", "S3M", "XM", "IT"];

/**
 * 트래커 파일에서 제목 추출
 */
function extractTrackerTitle(buffer: Buffer, format: string): string {
  try {
    switch (format) {
      case "MOD": {
        // MOD: Title at offset 0, 20 bytes
        const title = buffer.subarray(0, 20).toString('ascii').replace(/\0/g, '').trim();
        return title;
      }
      case "S3M": {
        // S3M: Title at offset 0, 28 bytes
        const title = buffer.subarray(0, 28).toString('ascii').replace(/\0/g, '').trim();
        return title;
      }
      case "XM": {
        // XM: "Extended Module: " (17 bytes) + Title (20 bytes)
        const title = buffer.subarray(17, 37).toString('ascii').replace(/\0/g, '').trim();
        return title;
      }
      case "IT": {
        // IT: "IMPM" (4 bytes) + Title (26 bytes)
        const title = buffer.subarray(4, 30).toString('ascii').replace(/\0/g, '').trim();
        return title;
      }
      default:
        return "";
    }
  } catch {
    return "";
  }
}

/**
 * 파일 확장자에서 포맷 추출
 */
function getFormatFromFilename(filename: string): string {
  const ext = filename.split('.').pop()?.toUpperCase() || '';
  return ext;
}

/**
 * 사용자가 업로드한 IMS/Tracker 파일들의 제목을 서버에서 추출
 */
export async function action({ request }: { request: Request }) {
  try {
    const formData = await request.formData();
    const titleMap: Record<string, string> = {};
    const iconv = new Iconv('JOHAB', 'UTF-8//IGNORE');

    // FormData에서 모든 파일 추출
    const entries = Array.from(formData.entries()) as [string, FormDataEntryValue][];

    for (const [key, value] of entries) {
      if (value instanceof File) {
        const file = value as File;
        const fileName = file.name;

        // 경로 제거: "fm_music/I-OPEN1.IMS" → "I-OPEN1.IMS"
        const baseFileName = fileName.split('/').pop() || fileName;
        const format = getFormatFromFilename(baseFileName);

        try {
          // File → Buffer 변환
          const arrayBuffer = await file.arrayBuffer();
          const buffer = Buffer.from(arrayBuffer);

          // 트래커 포맷인 경우
          if (TRACKER_FORMATS.includes(format)) {
            const title = extractTrackerTitle(buffer, format);
            if (title) {
              titleMap[baseFileName] = title;
            }
          }
          // IMS 포맷인 경우
          else if (format === 'IMS') {
            // Offset 6: 곡 이름 (30바이트, Johab 인코딩)
            const songNameBytes = buffer.subarray(6, 36);

            // null 문자까지만 추출
            const nullIndex = songNameBytes.indexOf(0);
            const actualBytes = nullIndex >= 0 ? songNameBytes.subarray(0, nullIndex) : songNameBytes;

            // Johab → UTF-8 변환
            const songName = iconv.convert(actualBytes).toString('utf8').trim();

            titleMap[baseFileName] = songName || baseFileName.replace(/\.(ims|rol)$/i, '');
          }
        } catch (error) {
          // 오류 시 파일명에서 확장자만 제거
          titleMap[baseFileName] = baseFileName.replace(/\.(ims|rol|mod|s3m|xm|it)$/i, '');
        }
      }
    }

    return { titleMap };
  } catch (error) {
    return { titleMap: {}, error: String(error) };
  }
}
