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

/**
 * 서버 사이드에서 IMS 파일의 제목을 Johab → UTF-8로 변환
 */
export async function loader({ request }: Route.LoaderArgs) {
  const titleMap: Record<string, string> = {};
  const iconv = new Iconv('JOHAB', 'UTF-8//IGNORE');
  const publicDir = join(process.cwd(), 'public');

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

  return { titleMap };
}

export default function Home({ loaderData }: Route.ComponentProps) {
  return (
    <div>
      <MusicPlayer titleMap={loaderData.titleMap} />
    </div>
  );
}
