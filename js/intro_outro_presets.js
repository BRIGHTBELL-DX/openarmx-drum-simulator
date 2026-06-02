/**
 * 인트로·아웃트로 포즈 프리셋
 *
 * 배열 순서: [L1, L2, L3, L4, L5, L6, L7,  R1, R2, R3, R4, R5, R6, R7]
 *
 * 드럼 위치가 바뀌거나 새 환경이 필요하면:
 *   1) 기존 프리셋 값만 수정하거나
 *   2) 새 키를 추가한 뒤 introOutroPresetId를 선택하세요.
 *
 * 포즈 설명:
 *   neutralPose    — 완전 중립 (시작·끝)
 *   armSpreadPose  — 양팔을 옆으로 벌린 자세
 *                    (스틱을 들고 있을 때 몸통 충돌 없이 후퇴 가능)
 *   frontReadyPose — 드럼 연주 준비 자세 (앞쪽)
 */
const INTRO_OUTRO_PRESETS = {
  default: {
    name: '기본 드럼 셋업',

    // 완전 중립
    neutralPose:   [0,    0,     0,    0,    0, 0, 0,
                    0,    0,     0,    0,    0, 0, 0],

    // 팔을 양옆으로 최대 벌린 자세
    // — 스틱 포함해도 몸통 충돌 없음
    // — 인트로: neutral → 여기를 거쳐 → frontReady
    // — 아웃트로: frontReady → 여기를 거쳐 → neutral
    armSpreadPose: [ 0.40, -0.78, -1.08, 1.28, 0, 0, -0.42,
                    -0.40,  0.78,  1.08, 1.28, 0, 0,  0.42],

    // 드럼 연주 직전 준비 자세
    frontReadyPose:[-0.79, -0.04,  0.01, 1.54, 0, 0, -0.58,
                     0.79,  0.04, -0.01, 1.54, 0, 0,  0.58],
  },

  // 새 셋업 추가 예시:
  // custom_v2: {
  //   name: '커스텀 셋업 v2',
  //   neutralPose:    [ ... ],
  //   armSpreadPose:  [ ... ],
  //   frontReadyPose: [ ... ],
  // },
};
