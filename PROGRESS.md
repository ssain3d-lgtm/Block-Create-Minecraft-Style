# PROGRESS

> 세션이 끊기면 이 파일부터 읽고 "다음 작업"부터 이어간다. 설계 기준은 `DESIGN.md`.

## 현재 단계
3단계 — 자산 팩토리 / 완료 (다음: 4단계 생성기·플랜)

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

- [x] 형상 레시피 → 3D 메시(box/extrude/lathe/curve/subvoxel/composite/mesh) — `test/geometry.test.ts` (원래 3단계였으나 화면에 필요해서 앞당김)
- [x] 렌더러: 청크별 큐브 병합 메시 + 숨은 면 제거 + 정점 AO + 블록별 색 흔들림, 그 외 형상은 InstancedMesh, dirty 청크만 다시 메시(프레임당 10ms 예산)
- [x] 절차적 픽셀 텍스처 아틀라스(이미지 파일 없음)
- [x] 스튜디오 UI(레퍼런스 배치): 둘러보기 5종, 빛과 분위기 3종, 천천히 회전/그림자/격자, 감상·추가·삭제·칠하기, 형상 선택, R 회전, 재료 팔레트, 구조물 트리(보기/숨김/잠금/삭제), AI 명령창, 나침반, 사진 저장, 상태바
- [x] 자동 저장(IndexedDB) → 새로고침 후 복원, 파일 저장/열기(.vox.json)
- [x] 브라우저 실동작 검사 `npm run check:studio` (Chromium + Playwright): 추가/삭제 클릭, Ctrl+Z, AI 명령, 새로고침 복원 모두 통과
- [x] `run.bat`(ASCII 전용)

- [x] 자산 명령: searchAssets, describeAsset, createShape, createMaterial, createCustomBlock, createComponent, placeComponent(회전·반복), registerAsset — `test/assets.test.ts`
- [x] 공용 라이브러리: Node는 `library/{shapes,materials,components}/*.json`, 브라우저는 localStorage. 프로젝트는 사용한 자산 사본을 저장(라이브러리 없이도 열림)
- [x] AI 테스트 D 일부: 새 경사 블록 생성 → 등록 → 다른 프로젝트에서 검색·재사용 → 수정(v2) → 원래 프로젝트는 v1 유지 → 재실행 검증
- [x] 형상 검증: 칸 밖 좌표·NaN·삼각형 수 초과 거부(hint 포함), 곡선은 칸 안으로 자동 맞춤, solidFaces 자동 감지(box/subvoxel)
- [x] 스튜디오 예제 "형상·재질 견본" — 내장 형상 17종 × 4방향 + AI 곡선 기와·둥근 기둥

## 진행 중
- (없음)

## 미완료
- [ ] 4단계 생성기·플랜 / 5단계 성능 / 6단계 AI 연결·검수

## 실행 방법
- Windows: `run.bat` 더블클릭 → 브라우저에서 http://localhost:5173
```
npm install
npm test
npm run vox -- commands
npm run vox -- cmd "{\"cmd\":\"fillRegion\",\"args\":{\"from\":[0,0,0],\"to\":[9,0,9],\"material\":\"stone\"}}" --project projects/test.vox.json --quiet
```

## 실측 기록
(아직 없음 — 추정치는 쓰지 않는다)

## 다음 작업 (재개 시 여기부터)
1. 4단계: 고수준 생성기(createBuilding/Foundation/Floor/Wall/Roof/Tower/Arch/Truss/Pillar/Beam/Stairs/Terrain/Tree), 앵커 참조, executePlan(dry-run), modify/rebuild/duplicate, 예제 D(집)·A(에펠탑)

## 결정 기록
- 2026-10-26: npm workspaces 대신 **단일 패키지 + 폴더 분리**(`src/engine`, `src/render`, `src/studio`, `src/cli`, `src/node`, `src/server`). Windows에서 설치·실행이 단순해서. `src/engine`은 three/node 모듈을 import하지 않는다(브라우저·Node 공용).
- 2026-10-26: 회전은 8방향(4방위 × 뒤집기). 지붕·계단·경사에 충분. 24방향은 필요해지면 확장.
- 2026-10-26: 셀 키는 36비트 정수(좌표 ±2048), 기본 경계 x,z ±1024 / y -64~1023.
- 2026-10-26: Greedy Meshing은 보류. 블록마다 색 흔들림·텍스처 변형이 있어 합칠 수 있는 면이 적고, 숨은 면 제거만으로 면 수가 크게 줄어든다. 5단계 실측 후 필요하면 같은 색 면만 합치는 방식으로 추가.
- 2026-10-26: 브라우저 검사는 시스템 Chromium + SwiftShader(소프트웨어 GL)로 돈다. 이 환경의 FPS는 GPU 성능이 아니므로 성능 수치로 쓰지 않는다.
- 2026-10-26: 자산 버전은 프로젝트 기준으로 매긴다(재실행 시 결정적). 재실행 엔진은 라이브러리에 쓰지 않는다.
- 2026-10-26: zod v4 사용, JSON Schema는 `z.toJSONSchema`로 생성.
