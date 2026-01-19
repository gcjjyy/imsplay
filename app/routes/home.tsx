import type { Route } from "./+types/home";
import MusicPlayer, { MUSIC_SAMPLES } from "~/components/MusicPlayer";
import { readFileSync } from "fs";
import { join } from "path";
import { Iconv } from "iconv";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "IMS Player - AdLib Music Player" },
    { name: "description", content: "브라우저에서 OPL2 FM 신디사이저로 AdLib 음악 파일을 재생하세요" },
  ];
}

// IMS 샘플 파일 목록 (MUSIC_SAMPLES에서 추출)
const IMS_FILES = MUSIC_SAMPLES
  .filter(sample => sample.format === "IMS")
  .map(sample => sample.musicFile.replace('/', ''));

// Tracker 샘플 파일 목록 (MOD, S3M, XM, IT)
const TRACKER_FORMATS = ["MOD", "S3M", "XM", "IT"];
const TRACKER_FILES = MUSIC_SAMPLES
  .filter(sample => TRACKER_FORMATS.includes(sample.format))
  .map(sample => ({ fileName: sample.musicFile.replace('/', ''), format: sample.format }));

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
 * 서버 사이드에서 IMS/Tracker 파일의 메타데이터 추출
 */
export async function loader({ request }: Route.LoaderArgs) {
  const titleMap: Record<string, string> = {};
  const iconv = new Iconv('JOHAB', 'UTF-8//IGNORE');
  const publicDir = join(process.cwd(), 'public');

  // IMS 파일 제목 추출 (Johab → UTF-8)
  for (const fileName of IMS_FILES) {
    try {
      const filePath = join(publicDir, fileName);
      const buffer = readFileSync(filePath);

      // Offset 6: 곡 이름 (30바이트, Johab 인코딩)
      const songNameBytes = buffer.subarray(6, 36);

      // null 문자까지만 추출
      const nullIndex = songNameBytes.indexOf(0);
      const actualBytes = nullIndex >= 0 ? songNameBytes.subarray(0, nullIndex) : songNameBytes;

      // Johab → UTF-8 변환
      const songName = iconv.convert(actualBytes).toString('utf8').trim();

      titleMap[fileName] = songName || fileName.replace('.IMS', '');
    } catch (error) {
      titleMap[fileName] = fileName.replace('.IMS', '');
    }
  }

  // Tracker 파일 제목 추출 (MOD, S3M, XM, IT)
  for (const { fileName, format } of TRACKER_FILES) {
    try {
      const filePath = join(publicDir, fileName);
      const buffer = readFileSync(filePath);
      const title = extractTrackerTitle(buffer, format);

      if (title) {
        titleMap[fileName] = title;
      }
    } catch (error) {
      // 파일 읽기 실패 시 무시
    }
  }

  return { titleMap };
}

export default function Home({ loaderData }: Route.ComponentProps) {
  return (
    <div>
      <MusicPlayer titleMap={loaderData.titleMap} />
    </div>
  );
}
