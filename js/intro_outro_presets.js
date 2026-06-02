/**
 * 인트로·아웃트로 포즈 프리셋
 *
 * 배열 순서: [L1, L2, L3, L4, L5, L6, L7,  R1, R2, R3, R4, R5, R6, R7]
 *
 * 드럼 위치가 바뀌거나 새 환경이 필요하면:
 *   1) 기존 프리셋 값만 수정하거나
 *   2) 새 키를 추가한 뒤 UI에서 presetId를 선택하세요.
 *
 * 구조:
 *   neutralPose    — 완전 중립 자세 (시작·끝)
 *   rearClearPose  — 팔을 뒤로 빼서 경로 확보
 *   frontReadyPose — 연주 준비 자세 (드럼 앞쪽)
 */
const INTRO_OUTRO_PRESETS = {
  default: {
    name: '기본 드럼 셋업',
    neutralPose:    [0,    0,     0,    0,    0, 0, 0,
                     0,    0,     0,    0,    0, 0, 0],
    rearClearPose:  [0.90, 0.00,  0.04, 1.80, 0, 0, -1.35,
                    -1.10, 0.00, -0.04, 1.80, 0, 0,  1.35],
    frontReadyPose: [-0.79, -0.04, 0.01, 1.54, 0, 0, -0.58,
                      0.79,  0.04,-0.01, 1.54, 0, 0,  0.58],
  },

  // 새 셋업 추가 예시 (값을 실측값으로 교체하세요):
  // custom_v2: {
  //   name: '커스텀 셋업 v2',
  //   neutralPose:    [ ... ],
  //   rearClearPose:  [ ... ],
  //   frontReadyPose: [ ... ],
  // },
};
