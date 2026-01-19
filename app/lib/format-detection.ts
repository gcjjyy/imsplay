/**
 * format-detection.ts - 음악 파일 포맷 감지 및 플레이어 라우팅
 *
 * libopenmpt와 AdPlug 간의 포맷 우선순위를 결정합니다.
 */

import { LIBOPENMPT_EXTENSIONS } from "./libopenmpt/libopenmpt";
import { ADPLUG_EXTENSIONS } from "./adplug/adplug";

export type PlayerType = 'libopenmpt' | 'adplug' | null;

/**
 * AdPlug 전용 포맷 (libopenmpt가 처리하지 않음)
 * 이 포맷들은 항상 AdPlug로 재생됩니다.
 */
const ADPLUG_ONLY_EXTENSIONS = [
  // Korean DOS / IMS
  '.ims',
  // AdLib Visual Composer
  '.rol',
  // VGM (Video Game Music)
  '.vgm', '.vgz',
  // OPL capture formats
  '.cmf', '.dro', '.raw', '.laa',
  // AdLib specific formats
  '.imf', '.a2m', '.adl', '.amd', '.bam', '.cff', '.d00', '.dfm',
  '.dmo', '.dtm', '.got', '.hsc', '.hsp', '.hsq', '.jbm', '.ksm',
  '.lds', '.m', '.mad', '.mdi', '.mid', '.mkj', '.msc', '.mtk',
  '.mtr', '.mus', '.pis', '.plx', '.rad', '.rix', '.sa2', '.sat',
  '.sci', '.sdb', '.sng', '.sop', '.sqx', '.xad', '.xms', '.xsm',
  '.ha2', '.agd',
];

/**
 * 파일 확장자에 따라 적절한 플레이어 타입을 반환합니다.
 *
 * 우선순위:
 * 1. AdPlug 전용 포맷 → AdPlug
 * 2. libopenmpt 지원 포맷 → libopenmpt
 * 3. 기타 AdPlug 지원 포맷 → AdPlug
 * 4. 지원하지 않는 포맷 → null
 *
 * @param filename 파일명
 * @returns 플레이어 타입 또는 null
 */
export function getPlayerType(filename: string): PlayerType {
  const ext = filename.toLowerCase().substring(filename.lastIndexOf('.'));

  // 1. AdPlug 전용 포맷 체크 (IMS, ROL, VGM 등)
  if (ADPLUG_ONLY_EXTENSIONS.includes(ext)) {
    return 'adplug';
  }

  // 2. libopenmpt 지원 포맷 체크 (MOD, XM, IT, S3M 등)
  if (LIBOPENMPT_EXTENSIONS.includes(ext)) {
    return 'libopenmpt';
  }

  // 3. 기타 AdPlug 지원 포맷 체크
  if (ADPLUG_EXTENSIONS.includes(ext)) {
    return 'adplug';
  }

  // 4. 지원하지 않는 포맷
  return null;
}

/**
 * 파일이 지원되는 포맷인지 확인합니다.
 */
export function isSupportedFormat(filename: string): boolean {
  return getPlayerType(filename) !== null;
}

/**
 * 지원되는 모든 확장자 목록을 반환합니다.
 */
export function getAllSupportedExtensions(): string[] {
  const combined = new Set([...ADPLUG_EXTENSIONS, ...LIBOPENMPT_EXTENSIONS]);
  return Array.from(combined).sort();
}
