# AI Voxel Architecture Studio — 설계안 v0.1

> 작성일: 2026-10-26
> 목적: 지시서를 검토하고, 구현 전에 구조와 결정 사항을 고정한다.
> 이 문서는 코딩 에이전트(Claude Code, Qwen Code 등)가 **이 문서만 읽고 구현을 시작할 수 있도록** 쓴다.

---

## 0. 한눈에 보기 (쉬운 요약)

**만드는 것**
브라우저에서 돌아가는 3D 블록 건축 프로그램이다. 사람은 화면에서 블록을 직접 놓을 수 있다. AI는 "벽 세워", "지붕 올려" 같은 **짧은 명령(JSON)** 으로 건물을 짓는다. AI가 블록 좌표를 하나하나 쓸 필요는 없다.

**핵심 아이디어 3가지**
1. **명령이 곧 설계도다.** 건물은 "명령 목록"으로 저장한다. 명령을 다시 실행하면 같은 건물이 나온다. 그래서 지붕만 골라서 다시 지을 수 있다.
2. **엔진과 화면을 분리한다.** 건축 엔진은 화면 없이도(명령창·AI 연결) 혼자 돈다. 화면은 엔진의 결과를 보여주기만 한다.
3. **새 블록은 "설계 데이터"로 만든다.** AI는 코드를 쓰지 않는다. 형상의 치수와 단면 같은 숫자만 적고, 엔진이 그 숫자로 3D 모양을 만든다. 이렇게 하면 안전하고 재사용도 쉽다.

**결정이 필요한 것 (기본값을 정해 두었으니, 바꾸고 싶을 때만 알려주세요)**
| 항목 | 기본값 |
|---|---|
| 블록 1칸 크기 | 0.5m (프로젝트마다 변경 가능) |
| 첫 번째 완성 예제 | **D. AI 전용 테스트(집 한 채)**, 그다음 **A. 에펠탑** |
| 스크린샷·벤치마크 방식 | Playwright로 실제 브라우저를 띄워 측정 (실측값만 기록) |
| 패키지 관리 | npm workspaces (Windows 기본 환경에서 추가 설치 없음) |

---

## 1. 지시서 검토 결과

### 1.1 좋은 점 (그대로 유지)
- P0/P1/P2 우선순위와 PROGRESS.md 이어받기 방식이 명확하다.
- "고수준 API로 좌표 작성을 피한다"는 방향이 맞다. LLM이 실수를 가장 많이 하는 부분이 대량 좌표 작성이다.
- 실측값만 보고하라는 조건이 있어서 결과를 믿을 수 있다.

### 1.2 문제점과 수정 제안

| # | 문제 | 수정 제안 |
|---|---|---|
| 1 | **스크린샷 2장이 첨부되어 있지 않다.** | 지시서에 적힌 UI 요소 목록만 기준으로 설계했다. 구현을 맡길 때 사진을 함께 넣으면 색감과 배치를 맞출 수 있다. |
| 2 | 범위가 너무 넓다. 엔진, UI, AI, MCP, 성능, 예제 4개, 검수, 출력까지 한 번에 요구한다. | 6단계로 나누고 **단계마다 "완료 기준"을 둔다**(14장). 앞 단계가 통과해야 다음 단계로 넘어간다. |
| 3 | "Custom Mesh"를 AI가 자유롭게 만들게 하면 깨진 형상과 무거운 형상이 생긴다. | 형상은 **정해진 6가지 레시피**(4장)로만 만든다. 레시피 안에서는 자유롭게 조합할 수 있다. 원본 메시 직접 입력은 꼭짓점 수에 제한을 둔다. |
| 4 | Greedy Meshing은 정육면체 블록에만 적용된다. 계단·경사·아치 같은 블록에는 쓸 수 없다. | **정육면체는 Greedy Meshing**, **나머지는 InstancedMesh**로 처리하는 혼합 방식을 쓴다(9장). |
| 5 | "명령 기록 후 재실행"과 "화면에서 손으로 편집"이 충돌한다. 손으로 고친 블록이 재시공하면 사라진다. | 손 편집도 명령(`editBlocks`)으로 기록한다. 손으로 고친 블록은 해당 구조물의 **덮어쓰기 레이어**에 저장해서 재시공 후에 다시 적용한다(8.4). |
| 6 | 스크린샷과 FPS 측정은 GPU가 있는 브라우저에서만 할 수 있다. Node 단독으로는 불가능하다. | Playwright로 뷰어를 띄워서 촬영하고 측정한다. 엔진 검사(좌표 오류, 떠 있는 블록)는 Node 단독으로 처리한다. |
| 7 | 에펠탑 10만 블록을 AI가 하나씩 지시할 수는 없다. | 에펠탑 전용이 아닌 **범용 생성기**(트러스 다리, 격자 탑, 아치)를 만든다. 에펠탑은 그 생성기를 조합한 "플랜 JSON 1개"로 표현한다. |
| 8 | 재질 저장 위치가 정해져 있지 않다. 다른 프로젝트에서 재사용하려면 별도 저장소가 필요하다. | 프로젝트 밖에 **공용 라이브러리 폴더**(`library/`)를 둔다. 프로젝트에는 사용한 자산의 사본을 함께 저장해서 단독으로 열리게 한다. |

---

## 2. 전체 구조

```
┌──────────────────────────────────────────────────────────┐
│  LLM (Qwen / Claude / GPT / OpenCode ...)                  │
└───────────────┬───────────────────────────┬──────────────┘
                │ MCP (stdio)               │ HTTP / CLI
        ┌───────▼────────┐          ┌───────▼────────┐
        │  mcp-server     │          │  cli / http-api │
        └───────┬────────┘          └───────┬────────┘
                └──────────┬────────────────┘
                   ┌───────▼────────┐
                   │  engine-core    │  ← 순수 TypeScript, 화면 없음
                   │  - World/Chunk  │
                   │  - Commands     │
                   │  - Generators   │
                   │  - Assets       │
                   │  - Inspector    │
                   └───────┬────────┘
                   ┌───────▼────────┐
                   │  render (Three) │  ← 형상 → 메시 변환
                   └───────┬────────┘
                   ┌───────▼────────┐
                   │  studio (UI)    │  ← Vite 웹앱
                   └────────────────┘
```

**원칙**
- `engine-core`는 Three.js를 import하지 않는다. 형상은 숫자 배열(positions, normals, indices)로만 만든다. Three.js 변환은 `render`가 담당한다.
- 모든 입력(UI, CLI, MCP, HTTP)은 **같은 명령 실행기**를 거친다. 입구가 4개여도 동작은 하나다.

---

## 3. 데이터 모델

### 3.1 계층
```
Project
 ├─ settings (cellSize, seed, bounds)
 ├─ palette (이 프로젝트가 쓰는 shape/material 목록 → 번호)
 ├─ buildings[]
 │   └─ Building
 │       ├─ regions[]  (Floor/Region)
 │       │   └─ structures[]
 │       └─ structures[]  (건물 전체에 걸친 것: 지붕 등)
 │            └─ Structure
 │                ├─ type: wall | roof | tower | truss | ...
 │                ├─ source: { command, params }   ← 다시 지을 때 사용
 │                ├─ overrides: BlockEdit[]        ← 손 편집 레이어
 │                └─ components[] (반복 부품 참조)
 ├─ commandLog[]
 └─ world (청크 데이터 — 저장 시에는 선택 사항, 4.5 참고)
```

### 3.2 좌표와 단위
- 정수 격자 `(x, y, z)`를 쓴다. **y가 위쪽**이다(Three.js와 같다).
- 1칸 = `project.settings.cellSize` 미터 (기본 0.5).
- 프로젝트 경계 기본값은 ±2048칸이다. 경계를 벗어난 명령은 거부한다.

### 3.3 블록 1개
```ts
interface Block {
  shape: number;      // palette 번호 (Uint16)
  material: number;   // palette 번호 (Uint16)
  rot: number;        // 0~23 (24가지 방향, Uint8)
  structure: number;  // 소속 Structure 번호 (Uint32), 0 = 없음
}
```

### 3.4 청크
- 크기 16×16×16 (4096칸).
- 저장 방식: 청크마다 `Uint16Array shape`, `Uint16Array material`, `Uint8Array rot`, `Uint32Array structure`.
- 월드는 `Map<"cx,cy,cz", Chunk>`로 관리한다. 빈 청크는 만들지 않는다.
- 청크마다 `dirty` 표시가 있다. 렌더러는 dirty 청크만 다시 만든다(증분 업데이트).

### 3.5 Structure 인덱스
- `structureId → 차지한 칸 목록`을 별도로 관리한다.
- 이 인덱스로 구조물 선택, 삭제, 재시공, 검사를 빠르게 처리한다.

### 3.6 저장 포맷
```
my-project/
  project.json      ← 계층, 팔레트, 명령 로그 (사람과 AI가 읽는 파일)
  world.bin         ← 청크 바이너리 캐시 (없으면 명령 로그로 재생성)
  assets/           ← 이 프로젝트가 쓰는 shape/material 사본
  shots/            ← 검수 스크린샷
```
- **기준 데이터는 project.json(명령 로그)이다.** world.bin은 빨리 열기 위한 캐시다.
- 파일마다 `formatVersion`을 넣는다.

---

## 4. 형상 시스템 (Procedural Geometry)

### 4.1 ShapeDef — 모든 블록 형상은 이 JSON 하나로 정의한다
```jsonc
{
  "id": "user.jp_roof_tile_curve",
  "name": "일본식 곡선 기와",
  "recipe": { ... },          // 아래 6종 중 하나
  "footprint": [1, 1, 1],     // 차지하는 칸 수 (기본 1×1×1, 최대 4×4×4)
  "solidFaces": [],           // 칸 면을 꽉 채우는 면: "+x","-x","+y","-y","+z","-z"
  "tags": ["roof", "japanese", "curved"],
  "params": { ... }           // 레시피에 넘긴 숫자 (재생성용)
}
```
`solidFaces`는 숨은 면 제거에 사용한다. 이웃 블록의 맞닿은 면이 둘 다 solid이면 그 면을 그리지 않는다.

### 4.2 레시피 6종
| 레시피 | 설명 | 만들 수 있는 것 |
|---|---|---|
| `box` | 칸 안의 직육면체 (min/max, 0~1 범위) | Cube, Slab, Pillar, Beam |
| `extrude` | 2D 다각형 단면을 한 축 방향으로 밀어냄 | Stair, Wedge, Fence, Truss 단면, 몰딩 |
| `lathe` | 2D 윤곽선을 회전시킴 | 둥근 기둥, 돔, 난간 기둥 |
| `curve` | 단면을 곡선 경로(베지어)를 따라 밀어냄 | Arch, 곡선 지붕, 기와 |
| `subvoxel` | 8×8×8 미세 격자 마스크 | 장식, 창살, 디테일 |
| `composite` | 위 레시피 여러 개 + 위치/회전 | 복합 부품 |
| (`mesh`) | 꼭짓점 직접 입력 (최대 2,000개) | 마지막 수단 |

기본 블록 11종(Cube, Slab, Stair, Wedge, Pillar, Beam, Arch, Roof, Fence, Truss, Custom)은 모두 위 레시피로 정의한 **내장 ShapeDef**다. 따로 하드코딩하지 않는다.

### 4.3 형상 생성 결과
```ts
interface GeometryData {      // engine-core 출력 (Three 없음)
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  indices: Uint32Array;
  bounds: [number, number, number, number, number, number];
}
```
- 같은 ShapeDef는 한 번만 생성해서 캐시한다.
- 검증 항목: 삼각형 수 상한, NaN 없음, 칸 범위(footprint) 안에 있음, 면적 0인 삼각형 제거.

### 4.4 회전
- 24방향을 쓴다(정육면체 회전군). 0~3은 Y축 회전(가장 많이 쓰는 방향)으로 둔다.
- 명령에서는 `"facing": "north" | "east" | "south" | "west"`, `"upsideDown": true` 같은 쉬운 표현을 받고 내부에서 번호로 바꾼다.

---

## 5. Material Factory

```jsonc
{
  "id": "builtin.wood_oak",
  "name": "참나무",
  "kind": "wood",            // wood|stone|metal|glass|concrete|brick|tile|custom
  "color": "#8a6a45",
  "roughness": 0.8,
  "metalness": 0.0,
  "opacity": 1.0,            // 1 미만이면 투명 처리 (유리)
  "pattern": { "type": "grain", "scale": 1.0, "contrast": 0.2 }  // 선택
}
```
- `pattern`은 이미지 파일 없이 **절차적 텍스처**(나뭇결, 벽돌 줄눈, 기와 줄)로 만든다. 외부 이미지가 필요 없어서 라이선스 문제가 없다.
- 내장 재질 8종: 목재, 석재, 금속, 유리, 콘크리트, 벽돌, 기와, 흰색 기본.
- 투명 재질은 렌더링 순서 문제 때문에 별도 패스로 그린다.

---

## 6. Asset Factory / Registry

### 6.1 역할
- **Registry**: 형상·재질·부품(Component)을 저장하고 검색한다.
- **Factory**: 새 자산을 만들고, 검증하고, 등록한다.

### 6.2 저장 위치
```
library/                 ← 모든 프로젝트가 공유
  shapes/*.json
  materials/*.json
  components/*.json      ← 여러 블록 묶음 (창문 세트, 난간 한 칸 등)
  index.json             ← 검색용 (id, name, tags, kind)
```
- id 규칙: `builtin.*`(수정 불가), `user.*`, `ai.*`
- 자산을 수정하면 `version`이 올라간다. 프로젝트는 사용한 버전의 사본을 갖고 있어서, 라이브러리가 바뀌어도 기존 건물이 깨지지 않는다.

### 6.3 AI가 새 블록을 만드는 흐름 (지시서 5장 대응)
```
1. searchAssets({ tags:["roof","japanese"], kind:"shape" })
2. 없음 → createShape({ id:"ai.jp_roof_tile", recipe:{ curve: ... } })
      → 엔진이 검증 + 형상 생성 + 미리보기 이미지(선택)
3. createMaterial({ id:"ai.kawara_gray", kind:"tile", ... })
4. registerAsset → library/ 에 저장
5. createRoof({ style:"irimoya", tileShape:"ai.jp_roof_tile", material:"ai.kawara_gray" })
6. 다른 프로젝트에서 searchAssets → 바로 재사용
```

### 6.4 Component (반복 부품)
- 작은 블록 묶음이다: `{ size:[w,h,d], blocks:[{x,y,z,shape,material,rot}] }`
- `placeComponent`로 배치하고, `pattern`(배열 반복)으로 여러 번 찍는다.
- 창문, 난간 한 칸, 트러스 한 마디 같은 부품에 쓴다.

---

## 7. 명령 API (AI 인터페이스의 핵심)

### 7.1 공통 형식
```jsonc
// 요청
{ "cmd": "createWall", "args": { ... }, "id": "c-0042" }

// 응답 — 항상 같은 모양
{
  "ok": true,
  "id": "c-0042",
  "result": { "structureId": "s-17", "blocksAdded": 384, "bounds": [...] },
  "warnings": ["벽 끝이 기초 밖으로 2칸 나감"],
  "summary": "wall s-17: 24x8, brick, 384 blocks"   // LLM이 읽기 쉬운 한 줄
}
// 실패
{ "ok": false, "error": { "code": "INVALID_ARGS", "path": "args.height", "message": "1~512 사이여야 함", "hint": "height: 8" } }
```
- 모든 args는 **zod 스키마**로 검증한다. 같은 스키마에서 JSON Schema를 자동으로 만들어 MCP 도구 설명에 사용한다.
- 오류에는 `hint`(올바른 예시)를 넣는다. 로컬 LLM이 스스로 고칠 수 있게 하기 위해서다.
- 응답에는 블록 목록을 넣지 않는다. 요약만 넣는다(컨텍스트 절약).

### 7.2 명령 목록

**프로젝트**
| 명령 | 설명 |
|---|---|
| `newProject` | 빈 프로젝트 (cellSize, bounds) |
| `saveProject` / `loadProject` | 저장/불러오기 |
| `undo` / `redo` | 실행 취소/다시 실행 |
| `getState` | 건물·구조물 트리 요약 |

**건축 (고수준 생성기)**
| 명령 | 주요 인자 |
|---|---|
| `createBuilding` | name, origin, footprint → Building 생성 |
| `createFoundation` | building, rect, height, material |
| `createFloor` | building, level, height → Region |
| `createWall` | from, to, height, thickness, material, openings[] (창/문) |
| `createRoof` | rect, style(flat/gable/hip/irimoya/shed), pitch, overhang, tileShape, material |
| `createTower` | center, baseSize, topSize, height, profile(straight/taper/curve), lattice(bool) |
| `createArch` | from, to, rise, thickness, shape |
| `createTruss` | path[], width, depth, pattern(warren/pratt/x), memberShape, material |
| `createPillar` / `createBeam` | 시작점, 끝점, 단면 |
| `createStairs` | from, to, width |
| `createTerrain` | rect, type(grass/path/water), height |

**자산**
| 명령 | 설명 |
|---|---|
| `createShape` / `createMaterial` / `createComponent` | 6장 |
| `searchAssets` | tags, kind, text |
| `createCustomBlock` | createShape + 등록을 한 번에 |

**구조물 편집**
| 명령 | 설명 |
|---|---|
| `placeStructure` | 부품/구조물을 위치에 배치 |
| `duplicateStructure` | 복제 (offset, mirror, rotate, array 반복) |
| `modifyStructure` | 원래 명령의 params 일부를 바꿔 **그 구조물만 재시공** |
| `rebuildStructure` | 같은 params로 다시 짓기 |
| `deleteStructure` | 삭제 |
| `editBlocks` | 저수준 편집 (set/remove/replace, 영역 단위) — 사람 손 편집 기록용 |
| `fillRegion` / `replaceInRegion` | 박스 영역 채우기/재질 교체 |

**검사·출력**
| 명령 | 설명 |
|---|---|
| `inspectStructure` / `inspectProject` | 11장 |
| `renderScene` | 시점별 스크린샷 (뷰어 필요) |
| `exportGLB` | P2 |
| `executePlan` | 8장의 BuildingPlan 실행 |
| `runBatch` | 명령 배열을 한 번에 실행 (중간에 실패하면 전체 롤백 옵션) |

### 7.3 좌표 입력을 쉽게
- 절대 좌표 외에 **상대 참조**를 받는다: `{"ref":"s-3","anchor":"top"}` = 구조물 s-3의 윗면.
- 구조물마다 `anchors`(top, bottom, north, center, corners...)를 자동으로 계산해 제공한다.
- 이렇게 하면 AI가 "기초 위에 벽"을 좌표 계산 없이 표현할 수 있다.

---

## 8. 설계 → 시공 (Plan → Build)

### 8.1 BuildingPlan
AI는 먼저 계획을 쓰고, 엔진이 계획을 실행한다.
```jsonc
{
  "plan": "small_house",
  "cellSize": 0.5,
  "buildings": [{
    "name": "House",
    "origin": [0,0,0],
    "structures": [
      { "key":"base",  "cmd":"createFoundation", "args":{ "rect":[0,0,20,16], "height":2, "material":"builtin.concrete" } },
      { "key":"walls", "cmd":"createWall", "args":{ "loop":true, "on":{"ref":"base","anchor":"top"}, "height":10, "material":"builtin.brick",
          "openings":[{"side":"south","type":"door","at":8,"w":3,"h":6}] } },
      { "key":"roof",  "cmd":"createRoof", "args":{ "on":{"ref":"walls","anchor":"top"}, "style":"gable", "pitch":0.5, "overhang":1 } }
    ]
  }]
}
```
- `key`로 구조물끼리 참조한다(엔진이 실제 structureId로 바꾼다).
- 실행 전에 **dry-run**을 한다: 참조 오류, 경계 초과, 예상 블록 수를 먼저 알려준다.

### 8.2 명령 로그
- 실행된 모든 명령은 `{ seq, cmd, args, resolvedArgs, structureId, time }`로 저장한다.
- 랜덤을 쓰는 생성기는 `seed`를 받는다. 같은 로그를 실행하면 항상 같은 결과가 나온다(결정적).

### 8.3 부분 재시공
`modifyStructure({ id:"s-roof", args:{ pitch:0.7 } })`
1. 해당 구조물의 블록을 지운다.
2. 바뀐 args로 생성기를 다시 실행한다.
3. 덮어쓰기 레이어(overrides)를 다시 적용한다.
4. 그 구조물 위에 의존하는 구조물이 있으면 경고하거나 연쇄 재시공한다(옵션 `cascade`).

### 8.4 겹침 규칙
- 두 구조물이 같은 칸을 쓰면 **나중 명령이 이긴다**. 결과에 겹친 칸 수를 경고로 알린다.
- 구조물별 `priority` 값을 지정할 수 있다.

### 8.5 Undo/Redo
- 명령 단위로 기록한다. 각 명령은 실행 전 상태의 **변경분(diff)**(바뀐 칸의 이전 값)을 저장한다.
- 히스토리는 최근 200개까지 보관한다.

---

## 9. 렌더링과 성능

### 9.1 방식
| 대상 | 방식 |
|---|---|
| 정육면체(cube) | 청크별 **Greedy Meshing** + 숨은 면 제거 → 청크당 재질별 메시 1개 |
| 그 외 형상 | 청크별 **InstancedMesh** (형상×재질 조합당 1개) |
| 투명 재질 | 별도 패스, 정렬 |
| 컬링 | 청크 단위 프러스텀 컬링 (Three 기본 + 청크 바운딩박스) |
| 증분 업데이트 | dirty 청크만 **Web Worker**에서 다시 만든 뒤 교체 |

- 형상이 cube가 아니어도 `solidFaces`가 있으면, 맞닿은 cube의 면을 숨긴다.
- 원거리 LOD는 P2로 미룬다. 필요하면 먼 청크를 단순한 상자로 대체한다.

### 9.2 벤치마크 (`npm run bench`)
- 장면: 10만 / 30만 블록 (cube 70% + 기타 형상 30%), 에펠탑 플랜.
- 측정 항목: 로딩 시간, 첫 렌더까지 시간, 평균/최저 FPS(카메라 회전 10초), 1,000블록 편집 반영 시간, draw call 수, 메모리.
- Playwright로 **실제 GPU 브라우저(headed)**를 띄워 측정하고, 결과를 `bench/results/YYYYMMDD.json`에 저장한다.
- 측정에 사용한 PC 사양(GPU 이름 등)을 함께 기록한다. **측정하지 않은 값은 문서에 쓰지 않는다.**

### 9.3 목표 (실측으로 확인할 목표치이며, 현재 값이 아니다)
- 10만 블록: 로딩 3초 이내, 60FPS 근처, 편집 반영 100ms 이내.

---

## 10. UI (studio)

### 10.1 배치
```
┌─────────────┬──────────────────────────────────────────┐
│ 좌측 사이드바 │  상단 바: 프로젝트명 · 저장 · Undo/Redo      │
│  (320px)     ├──────────────────────────────────────────┤
│ ▸ 프로젝트    │                                          │
│ ▸ 구조물 트리 │           3D 뷰포트                       │
│ ▸ 도구        │                                          │
│ ▸ 블록 형상   │                                          │
│ ▸ 재질 팔레트 │                                          │
│ ▸ 조명        ├──────────────────────────────────────────┤
│ ▸ AI 명령창   │ 하단: 블록 수 · FPS · draw calls · 커서 좌표 │
└─────────────┴──────────────────────────────────────────┘
  카메라 버튼(전체/정면/측면/상단)은 뷰포트 우상단에 떠 있음
```

### 10.2 스타일
- 배경 `#f4f5f4` / 패널 `#ffffff` / 포인트 짙은 녹색 `#1f5e3b` / 글자 `#1d2420`
- 둥근 모서리 8px, 얇은 테두리. 아이콘은 Lucide(무료)를 쓴다.

### 10.3 기능 (모든 버튼은 실제 명령에 연결)
- **도구**: 선택, 놓기, 지우기, 칠하기(재질만 변경), 영역 선택(박스)
- **놓기**: 마우스 위치에 미리보기 블록 표시, R키로 회전, 클릭으로 배치
- **구조물 트리**: 클릭하면 강조 표시. 숨김/잠금/삭제/재시공/params 수정 폼(스키마에서 자동 생성)
- **AI 명령창**: JSON 명령이나 BuildingPlan을 붙여넣어 실행하고, 결과 summary를 표시
- **조명**: 해 방향(시간대 슬라이더), 그림자 on/off, 환경광 세기
- **단축키**: Ctrl+Z/Y, Ctrl+S, 1~4 카메라 전환

---

## 11. 품질 검수

### 11.1 엔진 자동 검사 (Node 단독, `inspectProject`)
| 검사 | 방법 |
|---|---|
| 떠 있는 블록 | 바닥(y=0)이나 지형에서 시작하는 연결성 탐색(flood fill). 연결되지 않은 덩어리를 보고한다 |
| 빈 구조물 | 블록 0개인 구조물 |
| 경계 초과 | 프로젝트 bounds 밖 |
| 겹침 | 구조물 간 칸 충돌 수 |
| 대칭 검사 | 대칭으로 선언한 구조물의 좌우 차이 비율 (예: 에펠탑 4다리) |
| 계획 대비 누락 | Plan에 있는데 실제로는 0블록인 구조물 |
| 잘못된 참조 | 없는 shape/material id |
| 얇은 벽 구멍 | 벽 구조물 안의 의도치 않은 빈칸(openings 제외) |

결과 형식: `{ issues:[{ severity, code, structureId, bounds, message, fixHint }] }`
`fixHint`는 AI가 바로 실행할 수 있는 명령 예시다.

### 11.2 스크린샷 (`renderScene`)
- 시점: front, back, left, right, top, iso. 크기 기본값은 1024×768.
- 구조물 하나만 보이게 하는 옵션(`isolate: "s-roof"`)이 있다.
- 각 이미지에 구조물 id 라벨을 겹쳐 그리는 옵션이 있다. Vision LLM이 "s-roof가 이상하다"처럼 정확히 지목하게 하기 위해서다.
- 저장 위치: `shots/{timestamp}/{view}.png` + `meta.json`(카메라, 보이는 구조물 목록)

### 11.3 Vision LLM 검수 루프 (API 설계만, 특정 LLM에 종속되지 않음)
```
renderScene → 이미지 + meta.json
   → 외부 Vision LLM이 판단
   → 응답 형식: { "fixes":[{ "structureId":"s-roof", "cmd":"modifyStructure", "args":{...}, "reason":"..." }] }
   → applyFixes (dry-run → 실행 → 재검사)
```
이 응답 형식을 문서화해서 어떤 LLM이든 같은 형식으로 답하게 한다.

---

## 12. AI 연결

### 12.1 입구 3개 (모두 같은 명령 실행기 사용)
| 입구 | 용도 |
|---|---|
| **CLI** `vox run plan.json`, `vox cmd '{...}'`, `vox inspect`, `vox shots` | 테스트, 스크립트, LLM 없이 검증 |
| **HTTP API** `POST /api/command`, `GET /api/state` (localhost) | 브라우저 UI 연동, OpenCode 같은 에이전트 |
| **MCP 서버** (stdio) | Claude Desktop, Qwen Code, LM Studio MCP 클라이언트 |

### 12.2 MCP 도구 설계 원칙
- 도구 수는 **15개 이내**로 묶는다(로컬 LLM은 도구가 많으면 헷갈린다).
  예: `build`(고수준 생성기를 type 인자로 선택), `plan_execute`, `structure_edit`, `asset_create`, `asset_search`, `inspect`, `render`, `project`
- 도구 설명에 **짧은 예시 1개**를 반드시 넣는다.
- `get_guide` 도구를 둔다. 단위, 좌표계, 앵커 사용법, 스타일별 추천 수치를 한 페이지로 돌려준다.

### 12.3 "에펠탑 만들어 줘" 흐름 (최종 목표)
```
LLM → get_guide → asset_search(truss, iron)
    → plan_execute(에펠탑 플랜: 4다리 트러스 + 1층 아치 + 전망대 2개 + 상부 격자탑 + 조경)
    → inspect → render(front, iso) → (필요시) structure_edit
```
`examples/eiffel.plan.json`을 제공해서, LLM이 참고하거나 그대로 실행할 수 있게 한다.

---

## 13. 예제 건축물

| 예제 | 사용 생성기 | 우선순위 |
|---|---|---|
| **D. AI 테스트 하우스** | foundation, wall(openings), roof(gable), createShape(새 경사 블록) → 등록 → 재사용 → 저장/불러오기 | **1순위** (P0 검증용) |
| **A. 에펠탑** | createTruss(곡선 다리 4개), createArch, createFoundation(전망대 데크), createTower(lattice, taper), createTerrain | 2순위 (성능 검증 겸용) |
| C. 모던하우스 | wall, 유리 재질, 캔틸레버 slab, flat roof 다단 | 3순위 |
| B. 일본 성 | 석축(taper foundation), 다층 floor, irimoya 지붕 + 커스텀 기와 형상, 창문 component 반복 | 4순위 |

각 예제는 `examples/*.plan.json` + 자동 테스트(블록 수 범위, 검사 이슈 0건)로 구성한다.

---

## 14. 단계별 로드맵 (완료 기준 포함)

| 단계 | 내용 | 완료 기준 (전부 통과해야 다음 단계로) |
|---|---|---|
| **1. 뼈대 (P0)** | 레포 구조, engine-core(World/Chunk/Block), 명령 실행기, zod 검증, undo/redo, save/load, CLI | `npm test` 통과. CLI로 박스 채우기 → 저장 → 불러오기 결과가 동일 |
| **2. 화면 (P0)** | Vite+Three 뷰포트, cube 렌더(우선 단순 방식), 카메라 버튼 4개, 블록 놓기/지우기, 상태바 | `run.bat` 실행 → 브라우저에서 블록 편집 → 저장 → 새로고침 후 복원 |
| **3. 형상·재질·자산 (P1)** | 레시피 6종, 내장 블록 11종, 재질 8종, Registry, createShape/searchAssets | 내장 블록 전부 화면에 표시. AI 테스트 D의 "새 경사 블록 생성→등록→재사용" 자동 테스트 통과 |
| **4. 생성기·플랜 (P1)** | 고수준 생성기, executePlan, 앵커 참조, modify/rebuild, 예제 D, 예제 A | D와 A 플랜이 CLI와 UI에서 모두 실행됨. 지붕만 modifyStructure로 바뀜 |
| **5. 성능 (P2)** | Greedy meshing, InstancedMesh, Worker 증분 업데이트, 벤치마크 | 벤치마크 결과 파일 생성(실측). 10만 블록 장면 편집 가능 |
| **6. AI 연결·검수 (P2)** | HTTP API, MCP 서버, inspect, renderScene(Playwright), 예제 B/C, GLB 출력 | MCP 클라이언트에서 "집 지어줘" → 실제 건물 생성. 스크린샷 6방향 생성 |

> 시간이 부족하면 **4단계까지가 최소 완성선**이다. 이 시점에 "JSON 명령만으로 에펠탑과 집이 지어지는 엔진"이 된다.

---

## 15. 폴더 구조

```
ai-voxel-studio/
  package.json            (npm workspaces)
  run.bat                 (ASCII 전용: npm install + dev 서버 실행)
  bench.bat
  PROGRESS.md
  DESIGN.md               (이 문서)
  packages/
    engine-core/
      src/
        world/      (World, Chunk, coords)
        commands/   (registry, executor, schemas/*.ts, history)
        generators/ (foundation, wall, roof, tower, truss, arch, ...)
        geometry/   (recipes/*.ts, rotation, cache)
        assets/     (registry, factory, builtin/)
        plan/       (plan executor, ref resolver, dry-run)
        inspect/    (checks/*.ts)
        io/         (project.json, world.bin)
      test/
    render/         (GeometryData→Three, greedy mesher, instancing, worker)
    studio/         (Vite 앱: UI, viewport, tools, panels)
    cli/            (vox 명령)
    server/         (HTTP API + MCP stdio)
    shots/          (Playwright 스크린샷·벤치)
  library/          (공용 자산)
  examples/         (*.plan.json)
  bench/results/
```

**주요 의존성**: typescript, vite, three, zod, zod-to-json-schema, vitest, @modelcontextprotocol/sdk, playwright, commander
(유료 API 없음)

---

## 16. PROGRESS.md 형식

```markdown
# PROGRESS
## 현재 단계
단계 N — (이름) / 진행률 xx%

## 완료
- [x] 기능 — 검증 방법(테스트 이름/명령)

## 진행 중
- [ ] 기능 — 막힌 점

## 미완료
- [ ] ...

## 실행 방법
run.bat / npm test / npx vox run examples/house.plan.json

## 실측 기록
(벤치마크 결과 파일 경로만 적는다. 추정치는 쓰지 않는다)

## 다음 작업 (재개 시 여기부터)
1. ...

## 결정 기록
- 날짜: 결정 내용 / 이유
```

---

## 17. 위험 요소와 대응

| 위험 | 대응 |
|---|---|
| 로컬 LLM(Qwen)이 긴 JSON에서 실수함 | 오류에 `hint` 제공, dry-run, 도구 수 제한, `get_guide`, 예제 플랜 제공 |
| 에펠탑 곡선 다리 트러스가 블록으로 표현하면 계단처럼 보임 | 트러스 부재로 `beam`/경사 형상을 섞고, 방향에 따라 회전 블록을 자동으로 선택 |
| 블록이 많아질수록 project.json이 커짐 | 블록이 아닌 명령을 저장하므로 크기가 작다. 손 편집(overrides)만 블록 단위로 저장 |
| 투명 유리가 많으면 렌더 순서 오류 | 투명 패스 분리, 청크 단위 정렬 |
| 자산 버전이 꼬임 | 프로젝트에 사용 자산 사본을 저장, id+version으로 고정 |
| Windows 경로·인코딩 문제 | 경로는 path.join만 사용, .bat 파일은 ASCII 전용, 파일은 UTF-8(BOM 없음) |

---

*다음 단계: 이 설계안을 확인한 뒤, 1단계(뼈대)부터 구현을 맡긴다. 맡길 때는 이 문서와 원본 지시서, 에펠탑 스크린샷 2장을 함께 전달한다.*
