# PROGRESS

> 세션이 끊기면 이 파일부터 읽고 "다음 작업"부터 이어간다. 설계 기준은 `DESIGN.md`.

## 현재 단계
6단계 — AI 연결·검수 / 완료 · 지시서의 P0·P1 전부, P2 대부분 완료 (남은 것은 "미완료" 참고)

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

- [x] 고수준 생성기 14종(재시공 가능): createBuilding, createFoundation(석축 경사), createFloor(구멍·테두리·층 등록), createWall(루프/직선, 문·창문 자동 배열, 띠, 모서리), createRoof(gable/hip/pyramid/shed/flat/irimoya, 경사 블록 자동 선택, 처마 휨), createTower(lattice/shell/solid, 곡선 테이퍼), createCylinder, createArch, createTruss(경로·폭 테이퍼·X 브레이싱·강조선), createLine, createPillar, createStairs, createTerrain, createTree
- [x] 앵커 참조 `{"ref":"walls","anchor":"top"}`, 면적 `{"on":{"ref":"base","inset":1}}`, 건물 기준 상대 좌표
- [x] 구조물 작업: rebuildStructure, modifyStructure(인자 일부만 바꿔 그 구조물만 재시공 + 연쇄), duplicateStructure(회전·대칭·반복, 원본을 따라감), moveBuilding
- [x] executePlan: 자산 → 건물별 구조물 → after 순서, 한 번의 되돌리기, dryRun, 실패 시 어느 구조물인지 표시 + 전체 롤백
- [x] 예제 플랜 4종(`examples/*.plan.json`, `npm run examples`로 생성): A 에펠탑 121,892블록 · B 일본 성곽 · C 비대칭 모던하우스 · D AI 테스트 하우스 — `test/plans.test.ts`
- [x] 예제 D 검증: JSON만으로 집 제작, 새 경사 블록 생성·등록·지붕에 사용, 지붕만 수정(다른 구조물 블록 동일), 되돌리기, 저장·불러오기, 재실행 일치
- [x] 트러스·잎 블록 경량화(서브복셀 면 병합): 트러스 1008→304, 창살 464→64, 잎 1188→84 삼각형

- [x] 영역 묶음 렌더링: 청크 2×2×2(32³칸)를 버킷별 1개 메시 + 형상별 1개 InstancedMesh로 합침 → 에펠탑 메시 578→235개
- [x] 팔레트는 명령이 실행됐을 때만 다시 계산(매 프레임 계산 제거), 오래된 팔레트에 새 재질이 와도 안전
- [x] 벤치마크 3종: `npm run bench:engine`(CPU), `npm run bench:browser`(Playwright), 사용자 PC용 `bench.bat` / `?bench=1`(본인 브라우저·GPU로 FPS 실측, 결과 표 + JSON 저장)
- [x] 검토 결과 정리: InstancedMesh(사용), 청크 관리(사용), 프러스텀 컬링(영역 단위, Three 기본), 지오메트리 배칭(영역 묶음), 숨은 면 제거(사용), 증분 업데이트(사용), Greedy Meshing(보류 — 아래 결정 기록), Web Worker(보류 — 메시 생성이 충분히 빨라 프레임 예산으로 분산)

- [x] 자동 검수 `inspectProject` / `inspectStructure`: 떠 있는 블록(26방향 연결), MISSING_CELLS(생성기 기준 대비 사라진 칸 + 누가 가져갔는지), 빈 구조물, 깨진 자산 참조, 좌우 대칭 점수. 문제마다 fixHint 명령 — `test/ai-tools.test.ts`
  - 검수기가 실제로 찾아 고친 것: 일본 성 1층 벽이 좁아지는 석축 바깥에 떠 있던 문제, 에펠탑 대칭 61%→99.9%(반올림 방향·짝수 폭), 나무 잎 구멍으로 생긴 떠 있는 블록
- [x] `renderScene`: 정면·후면·좌·우·위·사선, 구조물 id 라벨, isolate(특정 구조물만), 카메라·라벨 위치 메타 → `shots/<시각>/` 저장. 열린 스튜디오 탭이 있으면 그 탭(GPU)으로, 없으면 헤드리스 브라우저로 렌더
- [x] HTTP 서버 + 스튜디오를 한 주소로(`npm run serve` / `run.bat`, http://127.0.0.1:7878): `/api/command`(명령·배열·플랜), `/api/guide`, `/api/commands`, `/api/state`, `/api/project`, `/api/events`(SSE)
- [x] 실시간 연동: AI가 서버에 보낸 명령이 열린 스튜디오에 바로 반영, 스튜디오 편집·되돌리기도 서버로. 매 명령 후 월드 해시를 비교해 어긋나면 서버 기준으로 자동 재동기화
- [x] MCP 서버(`mcp.bat` / `npm run mcp`, 도구 15개). 서버가 켜져 있으면 그 서버를 쓰고, 없으면 스스로 서버를 띄움 — `scripts/check-ai.ts`로 원격·내장 두 방식 모두 검증
- [x] `getGuide`: LLM용 한 페이지 안내서(단위·좌표·앵커·플랜 형식·작업 순서·재질·형상·모든 명령 예시)
- [x] GLB 내보내기(`exportGLB`, 스튜디오 GLB 버튼, `vox glb`): 미터 단위, 정점 색, 숨은 면 제거, 일부 구조물만도 가능
- [x] CLI 추가: `vox inspect`, `vox render`, `vox glb`
- [x] executePlan dryRun: 새 프로젝트용 플랜은 빈 임시 프로젝트에서 검사
- [x] 모든 명령의 예시가 스키마를 통과하는지 테스트

## 진행 중
- (없음)

## 미완료
- [ ] **GPU FPS 실측** — 이 작업 환경에는 GPU가 없음. 사용자 PC에서 `bench.bat` 실행 후 결과 JSON을 `bench/results/`에 추가
- [ ] 외부 Vision LLM 자동 루프 — API(renderScene 이미지 + 라벨 위치 + modifyStructure)는 준비됨. 특정 비전 모델을 호출하는 반복 실행기는 만들지 않음(특정 AI 서비스에 묶이지 않기 위해)
- [ ] 타임랩스(명령 기록 단계별 이미지/영상), Schematic(.schem) 내보내기 — 지시서 P2, 미착수
- [ ] Greedy Meshing, Web Worker 메시 생성 — 측정 결과 필요성이 낮아 보류(결정 기록 참고). GPU 실측에서 병목이 보이면 착수
- [ ] 형상 footprint 다칸(최대 4×4×4) — 현재 모든 형상은 1칸. 큰 부품은 component로 대신함

## 실행 방법
- Windows: `run.bat` 더블클릭 → 브라우저에서 http://127.0.0.1:7878 (스튜디오 + AI API, 작업은 `projects/current.vox.json`에 자동 저장)
- AI 클라이언트: `mcp.bat` (설정 예시는 README.md)
- 검사: `npm test` · `npm run check:studio` · `npm run check:ai`
```
npm install
npm test
npm run vox -- commands
npm run vox -- run examples/eiffel.plan.json --project projects/eiffel.vox.json --quiet
npm run vox -- cmd "{\"cmd\":\"fillRegion\",\"args\":{\"from\":[0,0,0],\"to\":[9,0,9],\"material\":\"stone\"}}" --project projects/test.vox.json --quiet
```

## 실측 기록
**CPU (Node, 클라우드 작업 환경: Intel(R) Xeon(R) Processor @ 2.10GHz, 2코어)** — `bench/results/engine-2026-10-25.json`

| 장면 | 블록 | 짓기 ms | 전체 메시 ms | 큐브 삼각형 | 인스턴스 | 파일 | 저장/불러오기 ms | 1000블록 편집 ms (명령+재메시) |
|---|---|---|---|---|---|---|---|---|
| synthetic-100k | 100,216 | 183 | 286 | 284,416 | 30,228 | 1,151 KB | 88 / 43 | 10.7 + 6.4 |
| synthetic-300k | 300,112 | 370 | 583 | 856,880 | 89,232 | 3,435 KB | 319 / 65 | 6.8 + 6.6 |
| eiffel | 121,892 | 341 | 334 | 355,848 | 10,991 | 1,985 KB | 162 / 89 | 7.2 + 9.9 |

**브라우저 구조 수치 (SwiftShader 소프트웨어 GL)** — `bench/results/browser-swiftshader-2026-10-26.json`
이 환경에는 GPU가 없어서 **FPS는 기록하지 않는다**(1 FPS 미만, GPU 성능과 무관). 아래는 GPU와 상관없는 구조 값(그림자 패스 포함 draw call 등)이다.

| 장면 | draw calls/프레임 | 메시 수 | 삼각형/프레임 | 표시 블록 |
|---|---|---|---|---|
| synthetic-100k | 441 | 235 | 3.05M | 100,216 |
| synthetic-300k | 1191 | 635 | 8.97M | 300,112 |
| eiffel | 469 | 235 | 1.40M | 111,235 |

**GPU FPS: 아직 미측정.** 사용자 PC에서 `bench.bat` 실행 → 결과 표의 "결과 JSON 저장"으로 받아 `bench/results/`에 넣는다.

## 다음 작업 (재개 시 여기부터)
1. 사용자 PC에서 `bench.bat`으로 GPU FPS 실측 → `bench/results/`에 기록, 병목에 따라 Greedy/Worker 결정
2. 로컬 LLM(Qwen 등)으로 MCP 실사용 테스트: "에펠탑 만들어 줘" → 실패하는 지점을 guide·오류 hint·도구 설명에 반영
3. 타임랩스, Schematic 내보내기(P2)

## 결정 기록
- 2026-10-26: npm workspaces 대신 **단일 패키지 + 폴더 분리**(`src/engine`, `src/render`, `src/studio`, `src/cli`, `src/node`, `src/server`). Windows에서 설치·실행이 단순해서. `src/engine`은 three/node 모듈을 import하지 않는다(브라우저·Node 공용).
- 2026-10-26: 회전은 8방향(4방위 × 뒤집기). 지붕·계단·경사에 충분. 24방향은 필요해지면 확장.
- 2026-10-26: 셀 키는 36비트 정수(좌표 ±2048), 기본 경계 x,z ±1024 / y -64~1023.
- 2026-10-26: Web Worker 메시 생성 보류 — 에펠탑 전체 메시가 CPU에서 약 0.3초(청크당 0.7ms), 프레임당 10ms 예산으로 나눠 처리하면 화면이 멈추지 않는다.
- 2026-10-26: Greedy Meshing은 보류. 블록마다 색 흔들림·텍스처 변형이 있어 합칠 수 있는 면이 적고, 숨은 면 제거만으로 면 수가 크게 줄어든다. 5단계 실측 후 필요하면 같은 색 면만 합치는 방식으로 추가.
- 2026-10-26: 브라우저 검사는 시스템 Chromium + SwiftShader(소프트웨어 GL)로 돈다. 이 환경의 FPS는 GPU 성능이 아니므로 성능 수치로 쓰지 않는다.
- 2026-10-26: 스튜디오와 서버 연동은 "로컬 우선 + 미러링 + 해시 검증" 방식. 명령이 결정적이라 같은 명령을 양쪽에서 실행하면 같은 결과가 나오고, 어긋나면 서버 기준으로 다시 불러온다.
- 2026-10-26: renderScene은 엔진이 아니라 서버가 처리(화면이 필요해서). 엔진 단독 호출 시 NO_VIEWER 오류와 방법(hint)을 돌려준다.
- 2026-10-26: 자산 버전은 프로젝트 기준으로 매긴다(재실행 시 결정적). 재실행 엔진은 라이브러리에 쓰지 않는다.
- 2026-10-26: zod v4 사용, JSON Schema는 `z.toJSONSchema`로 생성.
