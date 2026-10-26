# Showcase / 결과물 예시

All images were rendered by the studio itself from the plans in `examples/` (JSON commands only).
모든 이미지는 `examples/`의 플랜(JSON 명령)만으로 스튜디오가 직접 지어 렌더한 결과입니다.

Regenerate / 다시 만들기: `npx tsx scripts/render-showcase.ts`

| File | Example | Notes |
|---|---|---|
| `eiffel-studio.png` | A. Eiffel tower · 에펠탑 | full studio UI (Korean), 122,167 blocks |
| `eiffel-studio-en.png` | A. Eiffel tower | full studio UI (English) |
| `eiffel-dusk.png` | A. Eiffel tower | "Dusk / 해 질 녘" lighting |
| `eiffel-legs.png` | A. Eiffel tower | close-up: lattice legs, red stair rails, 1st deck, arches, gardens |
| `castle.png` | B. Japanese castle · 일본 성곽 | AI-made curved roof tiles, sloped stone base, moat |
| `modern-house.png` | C. Asymmetric modern house · 모던하우스 | cantilevered box, glass walls, three roof heights |
| `ai-test-house.png` | D. AI test house · AI 테스트 하우스 | built with JSON commands only, AI-made roof slope block |
| `pavilion-multicell.png` | E. Multi-cell pavilion · 다중 셀 정자 | 2x4x1 arches, 1x4x1 columns in a ring, 4x4x4 dome |
| `pavilion-overview.png` | E. Multi-cell pavilion | whole site with arch gates, fountains, benches, arcade component |

> Rendered in a cloud browser with software OpenGL (no GPU). On a real GPU the image looks the same; only the FPS differs.
