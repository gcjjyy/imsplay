import { Iconv } from "iconv";

/**
 * 사용자가 업로드한 IMS 파일들의 제목을 서버에서 Johab → UTF-8로 변환
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

        try {
          // File → Buffer 변환
          const arrayBuffer = await file.arrayBuffer();
          const buffer = Buffer.from(arrayBuffer);

          // Offset 6: 곡 이름 (30바이트, Johab 인코딩)
          const songNameBytes = buffer.subarray(6, 36);

          // null 문자까지만 추출
          const nullIndex = songNameBytes.indexOf(0);
          const actualBytes = nullIndex >= 0 ? songNameBytes.subarray(0, nullIndex) : songNameBytes;

          // Johab → UTF-8 변환
          const songName = iconv.convert(actualBytes).toString('utf8').trim();

          titleMap[baseFileName] = songName || baseFileName.replace(/\.(ims|rol)$/i, '');
        } catch (error) {
          titleMap[baseFileName] = baseFileName.replace(/\.(ims|rol)$/i, '');
        }
      }
    }

    return { titleMap };
  } catch (error) {
    return { titleMap: {}, error: String(error) };
  }
}
