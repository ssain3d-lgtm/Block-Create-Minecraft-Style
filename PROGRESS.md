# PROGRESS

> 세션이 끊기면 이 파일부터 읽고 "다음 작업"부터 이어간다. 설계 기준은 `DESIGN.md`.

## 현재 단계
안정화(P0·P1) 완료 · 범용 Procedural Asset Engine(다중 셀 형상) 완료 · 한/영 UI·README 완료 → 다음: "다음 작업" 1번

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

### 안정화 작업 (2026-10-26, 지시서 "소스코드 정밀 보완 및 안정화")
- [x] **P0-1 보안**: 루프백만 허용(0.0.0.0 거부), Host 헤더 검사(DNS 리바인딩 차단), Origin·Sec-Fetch-Site 검사로 다른 사이트 요청 거부, CORS 헤더 제거, 실행마다 바뀌는 API 토큰(`x-vox-token`; 브라우저는 같은 출처에서만 `/api/session`, 로컬 도구는 `.vox/token-<port>.json`), JSON 전용 + 경로별 크기 제한(명령 16MB, 프로젝트 96MB, 한 번에 2000개 명령), 파일 경로 샌드박스(정규화, `..`·절대경로·NUL·심볼릭 링크 탈출 차단, 확장자 제한; 서버·MCP는 `projects/`·`out/` 쓰기, `examples/` 읽기) — `test/server.test.ts`
- [x] **P0-2 트랜잭션**: 공용 라이브러리 쓰기를 명령 성공 후로 미룸(dryRun·실패·재실행 때는 쓰지 않음), 라이브러리 쓰기가 실패하면 프로젝트 변경과 앞선 라이브러리 쓰기까지 되돌림, `newProject`+계획을 하나의 원자적 명령으로(임시 엔진에서 짓고 성공 시 교체), MCP `execute_plan`·CLI·HTTP 모두 단일 명령으로 실행
- [x] **P0-3 저장**: 임시 파일 → fsync → 교체(원자적), 이전 버전 3개 백업(`.bak1~3`), 파일 체크섬(블록+구조물 소속+메타데이터)으로 손상 감지, 손상 시 최신 정상 백업에서 자동 복구(손상 파일은 `.corrupt-시각`으로 보관), 서버 종료 시 즉시 저장, 저장 실패 시 이전 파일 유지 + 다음 저장에서 재시도
- [x] **P1-4 동기화**: 상태 해시에 구조물 소속·메타데이터 포함(`stateHash`), 서버 revision 번호로 이벤트 순서 관리(중복 무시, 빈 번호 감지 시 재동기화), 재동기화 직렬화(동시에 하나만, 그동안 온 이벤트는 보관 후 적용), 편집마다 고유 opId(재전송해도 한 번만 적용), 끊긴 동안의 편집은 보관했다가 재접속 시 전송, 되돌리기/다시하기는 서버 공용 기록 기준
- [x] **P1-5 테스트**: 아래 결과 참고. 지시서 목록의 8개 회귀 테스트 모두 추가
- [x] 새 테스트가 찾아 고친 결함: 원자적 쓰기 실패 시 임시 파일이 남던 문제, 이전 AI 검사(check:ai)가 내장 MCP 서버로 실제 `projects/current.vox.json`을 덮어쓰던 문제(VOX_PROJECT로 분리), CLI가 `--project` 저장 실패를 성공처럼 끝내던 문제
- [x] 하위 호환: 체크섬 없는 기존 프로젝트 파일 그대로 열림(테스트 포함). 예제 4종 재생성 후 검수 0 오류·재실행 일치

### 범용 Procedural Asset Engine — 다중 셀 형상 (2026-10-26, 사용자 추가 요구 1~8)
- [x] 1. 다중 셀 형상: `createShape`에 `size:[w,h,d]`(각 1~16), 레시피 좌표는 칸 단위(0..size). 2×4×1 아치, 1×4×1 기둥, 4×4×4 돔, 3×1×3 분수대, 2×1×1 벤치 예제
- [x] 2. AI가 설계·생성·등록·재사용: 기존 createShape / createMaterial / createComponent + 라이브러리 흐름 그대로, 크기 바꾸려는데 이미 배치돼 있으면 거부(`SIZE_IN_USE`, 새 id 제안)
- [x] 3. 크기·해상도: 1칸 장식부터 16칸 부품까지 한 형상, 서브복셀 격자는 형상 전체에 걸침(비정육면 격자 허용), 큰 건물은 부품·컴포넌트·배치로 조합. 텍스처는 칸마다 반복(셰이더에서 칸 단위 wrap)
- [x] 4. 충돌·회전·배치·저장·복원·렌더링: 앵커 칸(회전된 footprint의 최소 모서리) + 나머지 칸은 내부 형상 `builtin.occupied`(aux에 앵커까지 오프셋). 회전 시 가로·깊이 교환, 겹침 정책 replace/skip/error, 어느 칸을 지우거나 칠해도 부품 전체 처리, 다른 부품과 겹치면 그 부품 전체 제거(고아 칸 없음), 범위 밖이면 통째로 건너뜀. 파일 형식 v2(aux 배열, v1 파일도 그대로 읽힘)
- [x] 5. 복합 부품 재사용·반복: `placeShape` 배치 방식 single / grid / line / ring(바깥·안쪽·고정 방향), 컴포넌트 캡처·회전·반복이 다중 셀 형상을 통째로 유지, 구조물 복제(회전·대칭) 시 앵커 재계산
- [x] 6. 기존 API·MCP 연동: `placeShape`는 재시공 가능한 생성기(키·참조·건물 기준 좌표·modifyStructure), `getShapeInfo`(크기·방향별 footprint·충돌 미리 확인), fillRegion은 footprint 단위로 타일링, 칸 단위 생성기는 다중 셀 형상을 받으면 placeShape를 안내, AI 가이드·MCP create_asset 설명 갱신
- [x] 7. 성능: 부품당 인스턴스 1개(영역 묶음 InstancedMesh), occupied 칸은 메시 없음. 실측(CPU): 2×1×2 부품 20,020개 배치 271ms + 메시 228ms. 기존 장면 짓기 시간 약 15~25% 증가(10만 블록 156→174ms)
- [x] 8. 예제·테스트: 예제 E "다중 셀 부품 정자"(`examples/pavilion.plan.json`, 검수 0 오류, 재실행 일치), `test/multicell.test.ts` 15개, check:ai에 MCP로 4×4×4 부품 생성 + 링 배치 검사
- [x] 이 작업 중 찾은 결함: CLI가 같은 길이의 새 프로젝트 플랜을 기존 파일에 다시 실행하면 저장하지 않던 문제(상태 해시로 판단하도록 수정, `test/cli.test.ts`), check:ai가 저장소의 공용 `library/`에 테스트 자산을 쓰던 문제(임시 폴더로 분리)

### 한국어 / 영어
- [x] 스튜디오 UI 한/영 전환: 오른쪽 위 EN / 한국어 버튼, 선택 기억(localStorage), `?lang=en`, 브라우저 언어로 기본값. 내장 재질·형상 이름 영어 표시, 첫 실행 데모·견본 예제 내용도 언어 따라 생성. check:studio에서 전환·유지 검사
- [x] README: `README.md`(영어) ↔ `README.ko.md`(한국어) 상단 링크로 전환, Windows 점검 문서도 `docs/WINDOWS_TEST.en.md` ↔ `docs/WINDOWS_TEST.md`
- 예제 플랜(A~E)의 구조물 이름·설명은 프로젝트 데이터라 한국어 그대로 둠(엔진 메시지·AI 가이드는 원래 영어)

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

## 검증 기록 (2026-10-26, 클라우드 작업 환경 · GPU 없음)
| 명령 | 결과 |
|---|---|
| `npm run typecheck` | 통과 (exit 0) |
| `npm test` | 8개 파일, **66개 테스트 통과** (보안 6 · 저장 8 · 트랜잭션 4 · 상태 해시 1 · 다중 셀 15 · CLI 1 포함) |
| `npm run check:studio` | 10개 항목 ok (SwiftShader 소프트웨어 GL, 언어 전환 포함) |
| `npm run check:ai` | **모든 항목 ok** — 탭 2개 + AI 동시 편집 수렴, 편집 유실·중복 0, 공용 undo, 오프라인 편집 후 재접속, MCP 새 프로젝트+계획 실패 시 무변경, MCP 다중 셀 부품 생성·링 배치, 토큰 없는 요청 거부 |
| `npm run build` | 통과 |
| 실행 못 한 것 | 실제 GPU(RTX 5090) 성능, Windows 실행 — `docs/WINDOWS_TEST.md`의 절차로 사용자 PC에서 점검 |

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
1. 사용자 PC에서 `docs/WINDOWS_TEST.md` 점검 + `bench.bat` GPU 실측 → `bench/results/`
2. P2-6 Vision LLM 검수 루프(OpenAI 호환 / 로컬 Qwen-VL 어댑터, 반복 횟수·작업량 제한, 전후 비교, 품질 보고서, 실패 시 기존 장면 보존) — render_views + modify_structure 재사용
3. P2-7 참조 이미지 → BuildingPlan(실루엣·비율·층수·지붕·돌출·재질·반복 요소 추출, 불확실한 부분 "추정" 표시)
4. P2-8 남은 것: 자산 미리보기 이미지(renderScene isolate 활용), 자산 의존성(컴포넌트가 쓰는 형상·재질 버전 고정), 복합 지붕 생성기
5. 다중 셀 형상 개선 후보: 회전된 직사각 footprint의 composite yaw 정확도, 다중 셀 형상끼리의 면 가림(현재는 가리지 않음), 아주 큰 부품의 그림자·LOD

## 후속 요구사항 원문 요약: 범용 Procedural Asset Engine (2026-10-26 완료, 위 "완료" 참고)
목표: AI가 다양한 크기·형태의 건축 부품을 직접 생성하는 범용 엔진.
1. 1×1×1 외에 2×4×1, 4×4×4 등 **다중 셀 사용자 정의 형상**
2. AI가 블록·메시·재질을 스스로 설계 → 생성 → 등록 → 재사용
3. 작은 장식부터 초대형까지 **크기·해상도 유연** (셀 단위 footprint + 형상 내부 해상도)
4. 다중 셀 형상의 **충돌·회전·배치·저장·복원·렌더링**
5. 복합 부품 재사용·반복 배치 (component + 다중 셀 형상)
6. 기존 건축 API·MCP와 완전 연동 (createShape / placeShape / generators의 shape 인자 / MCP create_asset)
7. 블록 수 증가 시 성능 유지 (청크·인스턴싱: 앵커 셀만 인스턴스, 나머지 셀은 "점유" 표시)
8. 실제 건축 예제 + 자동 테스트

구현 메모(설계 초안):
- ShapeDef에 `size: [w,h,d]`(기본 [1,1,1], 최대 16×16×16), 레시피 좌표는 0..size 범위
- 월드: 앵커 셀에 형상 저장, 나머지 셀은 예약 형상 `builtin.occupied`(+앵커 오프셋)로 점유 → 겹침 검사, 지우기/칠하기는 앵커 기준으로 전체 처리
- 회전: 4방위 회전 시 footprint w↔d 교환, 앵커는 회전 후 최소 모서리
- 렌더: 앵커 셀만 인스턴스(스케일은 size), occupied 셀은 메시 없음·면 가림 없음
- 저장/복원: 기존 청크 배열 그대로(occupied도 일반 형상 번호) → 파일 형식 호환

## 결정 기록
- 2026-10-26: npm workspaces 대신 **단일 패키지 + 폴더 분리**(`src/engine`, `src/render`, `src/studio`, `src/cli`, `src/node`, `src/server`). Windows에서 설치·실행이 단순해서. `src/engine`은 three/node 모듈을 import하지 않는다(브라우저·Node 공용).
- 2026-10-26: 회전은 8방향(4방위 × 뒤집기). 지붕·계단·경사에 충분. 24방향은 필요해지면 확장.
- 2026-10-26: 셀 키는 36비트 정수(좌표 ±2048), 기본 경계 x,z ±1024 / y -64~1023.
- 2026-10-26: Web Worker 메시 생성 보류 — 에펠탑 전체 메시가 CPU에서 약 0.3초(청크당 0.7ms), 프레임당 10ms 예산으로 나눠 처리하면 화면이 멈추지 않는다.
- 2026-10-26: Greedy Meshing은 보류. 블록마다 색 흔들림·텍스처 변형이 있어 합칠 수 있는 면이 적고, 숨은 면 제거만으로 면 수가 크게 줄어든다. 5단계 실측 후 필요하면 같은 색 면만 합치는 방식으로 추가.
- 2026-10-26: 브라우저 검사는 시스템 Chromium + SwiftShader(소프트웨어 GL)로 돈다. 이 환경의 FPS는 GPU 성능이 아니므로 성능 수치로 쓰지 않는다.
- 2026-10-26: 다중 셀 형상은 "앵커 + occupied 칸" 방식. 칸 단위 저장·되돌리기·충돌·피킹이 그대로 동작하고 파일 형식도 호환되기 때문(별도 객체 목록 방식은 저장·동기화·undo를 모두 새로 만들어야 함).
- 2026-10-26: 다중 셀 형상은 이웃 면을 가리지 않음(solidFaces 비움) — 바깥 면이 꽉 찬 경우가 드물고, 잘못 가리면 구멍이 보이기 때문.
- 2026-10-26: README 기본은 영어(`README.md`), 한국어는 `README.ko.md` — GitHub 첫 화면과 해외 배포(Patreon) 기준.
- 2026-10-26: 스튜디오와 서버 연동은 "로컬 우선 + 미러링 + 해시 검증" 방식. 명령이 결정적이라 같은 명령을 양쪽에서 실행하면 같은 결과가 나오고, 어긋나면 서버 기준으로 다시 불러온다.
- 2026-10-26: renderScene은 엔진이 아니라 서버가 처리(화면이 필요해서). 엔진 단독 호출 시 NO_VIEWER 오류와 방법(hint)을 돌려준다.
- 2026-10-26: 자산 버전은 프로젝트 기준으로 매긴다(재실행 시 결정적). 재실행 엔진은 라이브러리에 쓰지 않는다.
- 2026-10-26: zod v4 사용, JSON Schema는 `z.toJSONSchema`로 생성.
