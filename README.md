# IMS Play - 레트로 음악 플레이어

브라우저에서 레거시 AdLib 음악 및 트래커 음악 파일을 재생하는 웹 기반 음악 플레이어입니다. OPL2/OPL3 FM 신디사이저 에뮬레이션과 libopenmpt 기반 트래커 재생을 지원합니다.

## 주요 기능

### 🎵 음악 재생
- **AdPlug 2.4 기반** - 60개 이상의 AdLib 음악 포맷 지원 (WASM으로 컴파일)
- **libopenmpt 기반** - MOD, S3M, XM, IT 등 트래커 음악 포맷 지원 (WASM으로 컴파일)
- **IMS (Iyagi Music Sound)** - 한국에서 개발된 이벤트 기반 음악 형식 (49개 샘플 포함)
- **ROL (AdLib Visual Composer)** - AdLib Visual Composer 음악 형식 (6개 샘플 포함)
- **VGM (Video Game Music)** - 비디오 게임 음악 포맷 지원 (40개 샘플 포함)
- **BNK (Instrument Bank)** - 악기 정의 파일 (STANDARD.BNK + 13개 커스텀 뱅크)
- 9채널 멜로딕 또는 11채널 멜로딕+타악기 모드
- 루프 재생 (전체/한곡/셔플)

### 🎛️ 재생 제어
- 재생/정지
- 이전/다음 곡
- 마스터 볼륨 조절 (0-200)
- 템포 조절 (50%-200%)
- 키 조옮김 (-13 ~ +13, ROL 전용)
- 채널별 볼륨 및 뮤트

### 📊 시각화
- 실시간 채널 볼륨 미터 (Impulse Tracker 스타일, 피크 인디케이터)
- 88건반 피아노 롤 시각화
- 채널별 악기 이름 표시
- BPM 표시가 포함된 재생 진행 바
- ISS 가사 싱크 표시

### 💾 사용자 경험
- DOS 레트로 스타일 UI (VGA 16색 팔레트)
- DungGeunMo 픽셀 폰트
- 드래그 앤 드롭 파일/폴더 로딩
- 반응형 레이아웃 (모바일 지원)
- Media Session API 통합 (시스템 미디어 컨트롤)
- Safari 자동재생 정책 준수
- 다크/라이트 모드 지원 (Anysphere Dark 테마)

## 기술 스택

- **프론트엔드**: React 19 + React Router v7 (SSR)
- **언어**: TypeScript 5
- **스타일링**: Tailwind CSS 4
- **빌드**: Vite 7
- **오디오 엔진**:
  - AdPlug 2.4 (WASM) - AdLib/OPL 음악 재생
  - libopenmpt (WASM) - 트래커 음악 재생 (MOD, S3M, XM, IT 등)
  - Nuked-OPL3 (WASM) - 정밀한 OPL3 에뮬레이션
- **오디오 출력**: Web Audio API + AudioWorklet (@ain1084/audio-worklet-stream)
- **배포**: Docker 멀티 스테이지 빌드

## 시작하기

### 설치

```bash
npm install
```

### 개발 서버 실행

```bash
npm run dev
```

개발 서버가 `http://localhost:5173`에서 실행됩니다.

### TypeScript 타입 체킹

```bash
npm run typecheck
```

## 프로덕션 빌드

### 일반 빌드

```bash
npm run build
npm start
```

빌드된 애플리케이션이 `http://localhost:3000`에서 실행됩니다.

### Docker 배포

```bash
# 이미지 빌드
docker build -t imsplay .

# 컨테이너 실행
docker run -p 3000:3000 imsplay
```

Docker 이미지는 다음 플랫폼에 배포 가능합니다:
- AWS ECS
- Google Cloud Run
- Azure Container Apps
- Fly.io
- Railway
- Digital Ocean App Platform

## 프로젝트 구조

```
imsplay/
├── app/                              # React 애플리케이션
│   ├── components/                   # UI 컴포넌트
│   │   ├── MusicPlayer.tsx          # 메인 플레이어
│   │   ├── ChannelVisualizer.tsx    # 채널 볼륨 시각화
│   │   ├── PianoRoll.tsx            # 피아노 롤 시각화
│   │   └── dos-ui/                  # DOS 스타일 UI 컴포넌트
│   ├── lib/                         # 핵심 음악 엔진
│   │   ├── adplug/                  # AdPlug WASM 래퍼
│   │   │   └── adplug.ts           # AdPlug TypeScript 인터페이스
│   │   └── hooks/                   # React 훅
│   │       └── useAdPlugPlayer.ts  # AdPlug 플레이어 훅
│   └── routes/                      # React Router 라우트
│       └── home.tsx                # 메인 페이지 (SSR)
├── wasm/                            # WASM 빌드
│   ├── adplug/                      # AdPlug 2.4 소스 및 빌드
│   │   ├── src/                    # AdPlug 소스 코드
│   │   └── dist/                   # 빌드된 WASM 파일
│   └── libopenmpt/                  # libopenmpt 소스 및 빌드
├── public/                          # 정적 파일
│   ├── adplug.wasm                 # AdPlug 에뮬레이터 (WASM)
│   ├── adplug.js                   # AdPlug 로더
│   ├── libopenmpt.wasm             # libopenmpt 트래커 플레이어 (WASM)
│   ├── libopenmpt.js               # libopenmpt 로더
│   ├── nuked-opl3.wasm             # Nuked-OPL3 에뮬레이터 (WASM)
│   ├── STANDARD.BNK                # 메인 악기 뱅크
│   ├── *.IMS                       # IMS 음악 파일 (49개)
│   ├── *.ROL                       # ROL 음악 파일 (6개)
│   ├── *.vgm                       # VGM 음악 파일 (40개)
│   └── *.BNK                       # BNK 악기 파일 (14개)
└── CLAUDE.md                       # 개발자 문서
```

## 지원 파일 형식 상세

### IMS (Iyagi Music Sound)

한국에서 개발된 이벤트 기반 음악 형식으로, 다음과 같은 특징이 있습니다:

- 32KB 페이징 시스템으로 대용량 파일 지원
- MIDI 스타일 러닝 스테이터스
- Johab 인코딩 한글 제목 (서버 측에서 UTF-8로 자동 변환)
- 이벤트 타입: 노트 온/오프, 볼륨, 악기, 피치, 템포
- 루프 마커 지원 (0xFC)

### ROL (AdLib Visual Composer)

AdLib Visual Composer에서 생성한 타임 인덱스 기반 음악 형식:

- TPB (Ticks Per Beat) 기반 타이밍
- 멀티 채널 이벤트 (노트, 볼륨, 피치 벤드, 악기 변경)
- 타악기 모드 지원
- BNK 파일로 커스텀 악기 정의

### BNK (Instrument Bank)

악기 정의 파일:

- 28바이트 오퍼레이터 파라미터 (FM 신디사이저 설정)
- 웨이브폼, ADSR 엔벨로프, 진폭/주파수 변조 설정
- 대소문자 구분 없는 악기 이름

### VGM (Video Game Music)

비디오 게임 음악 로그 형식:

- YM3812 (OPL2) 칩 기반 음악 지원
- 루프 재생 지원 (loop_ofs 기반)
- Nuked-OPL3 에뮬레이터로 정밀한 재생

### 트래커 포맷 (libopenmpt)

MOD, S3M, XM, IT 등 트래커 음악 형식:

- libopenmpt 라이브러리 기반 (WASM으로 컴파일)
- 70개 이상의 트래커 포맷 지원
- 패턴 기반 시퀀싱
- 샘플 기반 사운드

## 기술적 특징

### 오디오 파이프라인

```
Player.generateSamples() → WASM 호출 (AdPlug/libopenmpt/Nuked-OPL3)
  ↓
WASM 엔진 → Float32Array 스테레오 샘플 생성
  ↓
@ain1084/audio-worklet-stream → 스트리밍 버퍼링
  ↓
AudioWorklet → 오디오 처리
  ↓
GainNode → 마스터 볼륨 적용
  ↓
스피커 출력
```

### 서버 사이드 인코딩 처리

IMS 파일의 조합형 인코딩 한글 제목을 React Router v7의 SSR loader에서 iconv를 사용하여 UTF-8로 변환합니다.

### 성능 최적화

- UI 업데이트: 20fps (50ms 인터벌)
- 오디오 생성: 시스템 네이티브 샘플레이트 (보통 48000Hz)
- AudioWorklet 기반 오디오 처리로 메인 스레드 부하 감소
- @ain1084/audio-worklet-stream 라이브러리로 안정적인 오디오 스트리밍
- 백그라운드 탭 전환 시 UI 프리징 방지
- 블루투스 장치 변경 시 자동 재생 복구

## 라이선스

이 프로젝트는 레거시 AdLib 음악과 트래커 음악의 보존 및 교육 목적으로 개발되었습니다.
