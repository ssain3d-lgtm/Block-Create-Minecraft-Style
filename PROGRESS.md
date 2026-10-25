# PROGRESS

> 세션이 끊기면 이 파일부터 읽고 "다음 작업"부터 이어간다. 설계 기준은 `DESIGN.md`.

## 현재 단계
1단계 — 뼈대 (엔진 코어·명령·저장·CLI) / 완료

## 완료
- [x] World/Chunk(16³, 희소 저장, 구조물 인덱스, dirty 청크 표시) — `test/engine.test.ts`
- [x] 명령 실행기: zod 검증, 오류 시 `hint` 반환, 트랜잭션 롤백 — `rolls back a failed batch completely`
- [x] Undo/Redo(명령 단위 diff, 최근 200개/400만 칸) — `fills, undoes and redoes`
- [x] 명령: newProject, setProjectInfo, getState, listCommands, describeCommand, getBlock, editBlocks, fillRegion, removeRegion, replaceInRegion, deleteStructure, undo, redo, runBatch, saveProject, loadProject, verifyReplay
- [x] 저장/불러오기(블록 스냅샷 RLE 압축 + 명령 로그), 로그만 있는 파일은 재실행으로 복원 — `round-trips through a file`
- [x] 결정적 재실행 검증 `verifyReplay`
- [x] 손 편집 → 구조물 overrides 기록
- [x] CLI `npm run vox -- ...`
- [x] 내장 자산 목록(재질 33종, 형상 17종 정의) — 형상 메시 생성은 3단계

## 진행 중
- (없음)

## 미완료
- [ ] 2단계 화면 / 3단계 형상 메시·자산 / 4단계 생성기·플랜 / 5단계 성능 / 6단계 AI 연결·검수

## 실행 방법
```
npm install
npm test
npm run vox -- commands
npm run vox -- cmd "{\"cmd\":\"fillRegion\",\"args\":{\"from\":[0,0,0],\"to\":[9,0,9],\"material\":\"stone\"}}" --project projects/test.vox.json --quiet
```

## 실측 기록
(아직 없음 — 추정치는 쓰지 않는다)

## 다음 작업 (재개 시 여기부터)
1. 2단계: Vite + Three.js 스튜디오(레퍼런스 `docs/ref/` 배치), 청크 메시, 블록 편집, 카메라 버튼, 상태바, 저장/불러오기

## 결정 기록
- 2026-10-26: npm workspaces 대신 **단일 패키지 + 폴더 분리**(`src/engine`, `src/render`, `src/studio`, `src/cli`, `src/node`, `src/server`). Windows에서 설치·실행이 단순해서. `src/engine`은 three/node 모듈을 import하지 않는다(브라우저·Node 공용).
- 2026-10-26: 회전은 8방향(4방위 × 뒤집기). 지붕·계단·경사에 충분. 24방향은 필요해지면 확장.
- 2026-10-26: 셀 키는 36비트 정수(좌표 ±2048), 기본 경계 x,z ±1024 / y -64~1023.
- 2026-10-26: zod v4 사용, JSON Schema는 `z.toJSONSchema`로 생성.
