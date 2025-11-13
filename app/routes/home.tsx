import type { Route } from "./+types/home";
import MusicPlayer from "~/components/MusicPlayer";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "ADLIB MUSIC PLAYER - IMS & ROL PLAYER" },
    { name: "description", content: "브라우저에서 OPL2 FM 신디사이저로 AdLib IMS과 ROL 음악 파일을 재생하세요" },
  ];
}

export default function Home() {
  return (
    <div>
      <MusicPlayer />
    </div>
  );
}
