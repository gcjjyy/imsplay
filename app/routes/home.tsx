import type { Route } from "./+types/home";
import MusicPlayer from "~/components/MusicPlayer";
import { readFileSync } from "fs";
import { join } from "path";
import { Iconv } from "iconv";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "ADLIB MUSIC PLAYER - IMS & ROL PLAYER" },
    { name: "description", content: "브라우저에서 OPL2 FM 신디사이저로 AdLib IMS과 ROL 음악 파일을 재생하세요" },
  ];
}

// IMS 샘플 파일 목록
const IMS_FILES = [
  "4JSTAMNT.IMS", "CUTE-LV2.IMS", "DQUEST4A.IMS", "FF5-LOGO.IMS",
  "KNIGHT-!.IMS", "NAUCIKA2.IMS", "SIDE-END.IMS", "MYSTERY-.IMS",
  "NI-ORANX.IMS", "JAM-MEZO.IMS", "AMG0002.IMS", "AMG0008.IMS",
  "AMG0011.IMS", "AMG0014.IMS", "AMG0015.IMS", "AMG0018.IMS",
  "AMG0024.IMS", "FF6-GW02.IMS", "GRAD1-1.IMS", "GRAD2-1.IMS",
  "GRAD2-2.IMS", "GRAD2-3.IMS", "GRAD2-4.IMS", "GRAD3-2.IMS",
  "JAM-FIVE.IMS", "JAM-NADI.IMS", "MACROS!!.IMS", "MACROS2.IMS",
  "P_013.IMS", "SPI0082.IMS"
];

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
