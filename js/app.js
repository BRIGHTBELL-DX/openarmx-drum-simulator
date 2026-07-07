import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';

const PI = Math.PI;

// ═══════════════════════════════════════════════════════════════
//  드럼 타입 DB
// ═══════════════════════════════════════════════════════════════
// tilt: 헤드 기울기 기본값(°) — 로봇(연주자) 방향으로 기울어짐. drum.tiltDeg로 개별 오버라이드 가능
const DRUM_TYPES = {
  hihat:  { name:'하이 햇',      color:'#00ddff', preDur:0.06, rebDur:0.08, style:'wrist', tilt: 4 }, // 시안
  snare:  { name:'스네어',       color:'#ffffff', preDur:0.08, rebDur:0.10, style:'full',  tilt: 3 }, // 흰색
  tom_h:  { name:'스몰 탐',      color:'#ff3366', preDur:0.09, rebDur:0.11, style:'full',  tilt:15 }, // 핑크레드
  tom_m:  { name:'미들 탐',      color:'#ff8800', preDur:0.09, rebDur:0.11, style:'full',  tilt:15 }, // 주황
  tom_f:  { name:'플로어 탐',    color:'#bb44ff', preDur:0.10, rebDur:0.13, style:'full',  tilt: 4 }, // 보라
  crash:  { name:'크래쉬 심벌',  color:'#ffdd00', preDur:0.10, rebDur:0.16, style:'big',   tilt:12 }, // 골드
  ride:   { name:'라이드 심벌',  color:'#44ff99', preDur:0.09, rebDur:0.13, style:'full',  tilt:10 }, // 민트
  kick:   { name:'킥 (베이스 드럼)', color:'#884422', preDur:0, rebDur:0,   style:'none',  tilt: 0 }, // 브라운
};

// ═══════════════════════════════════════════════════════════════
//  타격 강도 (velocity) 배율 테이블
// ═══════════════════════════════════════════════════════════════
const VEL_SCALE = {
  //          raiseZ  j7Strike  rebZ   j4(strike 보정)
  soft:   { raiseZ: 0.35, j7Strike: 0.40, rebZ: 0.30, j4: -0.10 },
  medium: { raiseZ: 1.00, j7Strike: 1.00, rebZ: 1.00, j4:  0.00 },
  hard:   { raiseZ: 1.80, j7Strike: 1.55, rebZ: 1.75, j4: +0.14 },
};
const VEL_GLOW = {
  soft:   c => `0 0 3px ${c}44`,
  medium: c => `0 0 6px ${c}66`,
  hard:   c => `0 0 11px ${c}bb`,
};

// ═══════════════════════════════════════════════════════════════
//  드럼 키트 상태
// ═══════════════════════════════════════════════════════════════
// 어깨(암 루트) 높이 0.698m 기준 — 실제 8피스 드럼 키트 배치 (드럼채 대응)
// 높이 서열: 킥 0.12(바닥) < 플로어 탐 0.26 ≈ 스네어 0.28 < 하이 햇 0.37
//           < 스몰·미들 탐 0.38(킥 위 마운트) < 라이드 0.48 < 크래쉬 0.50(최고)
// X = 사용자 확정값 + 0.15 (드럼채 30cm 돌출 → 팔이 뒤로 빠진 자세에서 팁 타격),
//     스몰 탐·미들 탐 추가 전진 — 전환 시 스틱 스윙이 인접 드럼을 스치지 않도록
// 라이드 Y=-0.50 (기본 -0.41에서 이동) — 미들 탐↔플로어 탐 전환 스틱 궤적이
// 라이드를 스치는 문제 해소 (2점 IK 충돌 스윕으로 실측 검증)
let drumKit = [
  // ─ L팔 ─────────────────────────────────────────────────────────
  { id:'d0', name:'하이 햇',     type:'hihat', arm:'L', pos:{x:0.48, y: 0.40, z:0.37} },
  { id:'d1', name:'크래쉬 심벌', type:'crash', arm:'L', pos:{x:0.69, y: 0.34, z:0.50} },
  { id:'d2', name:'스네어',      type:'snare', arm:'L', pos:{x:0.53, y: 0.16, z:0.28} },
  { id:'d3', name:'스몰 탐',     type:'tom_h', arm:'L', pos:{x:0.69, y: 0.10, z:0.38} },
  // ─ 킥 (표시 전용, 팔 미사용) ─────────────────────────────────
  { id:'d4', name:'킥',          type:'kick',  arm:'kick', pos:{x:0.63, y: 0.00, z:0.12} },
  // ─ R팔 ─────────────────────────────────────────────────────────
  { id:'d5', name:'미들 탐',     type:'tom_m', arm:'R', pos:{x:0.75, y:-0.12, z:0.38} },
  { id:'d6', name:'플로어 탐',   type:'tom_f', arm:'R', pos:{x:0.52, y:-0.21, z:0.26} },
  { id:'d7', name:'라이드 심벌', type:'ride',  arm:'R', pos:{x:0.65, y:-0.50, z:0.48} },
];
let nextDrumId = 8;

// 기본값 스냅샷 (초기화 버튼용)
const DEFAULT_DRUM_KIT = drumKit.map(d => ({...d, pos: {...d.pos}}));
const _DK_STORE = 'openarmx_drum_kit_v9';

function saveDrumKit() {
  try { localStorage.setItem(_DK_STORE, JSON.stringify(drumKit)); } catch(e) {}
}
function loadDrumKit() {
  try {
    const raw = localStorage.getItem(_DK_STORE);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || !parsed.length || !parsed[0]?.pos) return;
    drumKit = parsed;
    nextDrumId = Math.max(DEFAULT_DRUM_KIT.length,
      ...drumKit.map(d => parseInt(d.id.replace(/\D/g,'')) + 1));
  } catch(e) {}
}
window.resetDrumKit = function () {
  drumKit = DEFAULT_DRUM_KIT.map(d => ({...d, pos: {...d.pos}}));
  nextDrumId = DEFAULT_DRUM_KIT.length;
  saveDrumKit();
  renderDrumList(); rebuildDrumSpheres(); renderTimeline();
  _playKFs = buildFinalKeyframes(); _playDur = _playKFs.totalTime;
  setStatus('드럼 키트 기본값으로 초기화됨');
};

// ═══════════════════════════════════════════════════════════════
//  설정·타임라인 영속 (localStorage) — 강력 새로고침에도 유지
// ═══════════════════════════════════════════════════════════════
const _SETTINGS_STORE = 'openarmx_settings_v1';
const _TIMELINE_STORE = 'openarmx_timeline_v1';

function saveSettings() {
  try {
    localStorage.setItem(_SETTINGS_STORE, JSON.stringify({
      bpm:          parseInt(document.getElementById('bpm-inp')?.value)   || bpm,
      beatsPerBar:  parseInt(document.getElementById('meter-sel')?.value) || beatsPerBar,
      totalBars:    parseInt(document.getElementById('bars-inp')?.value)  || totalBars,
      introChecked: document.getElementById('chk-intro')?.checked ?? true,
      outroChecked: document.getElementById('chk-outro')?.checked ?? true,
      stickJ7Offset, strokeJ4Offset, strokeJ56Offset,
    }));
  } catch(e) {}
}
function loadSettings() {
  try {
    const raw = localStorage.getItem(_SETTINGS_STORE);
    if (!raw) return;
    const s = JSON.parse(raw);
    if (s.bpm         != null) { bpm         = s.bpm;         const el = document.getElementById('bpm-inp');    if (el) el.value = bpm; }
    if (s.beatsPerBar != null) { beatsPerBar = s.beatsPerBar;  const el = document.getElementById('meter-sel'); if (el) el.value = beatsPerBar; }
    if (s.totalBars   != null) { totalBars   = s.totalBars;    const el = document.getElementById('bars-inp');  if (el) el.value = totalBars; }
    if (s.introChecked != null) { const el = document.getElementById('chk-intro'); if (el) el.checked = s.introChecked; }
    if (s.outroChecked != null) { const el = document.getElementById('chk-outro'); if (el) el.checked = s.outroChecked; }
    if (s.stickJ7Offset   != null) { stickJ7Offset   = s.stickJ7Offset;   _setSliderPair('stick-j7-slider',   'stick-j7-val',   stickJ7Offset); }
    if (s.strokeJ4Offset  != null) { strokeJ4Offset  = s.strokeJ4Offset;  _setSliderPair('stroke-j4-slider',  'stroke-j4-val',  strokeJ4Offset); }
    if (s.strokeJ56Offset != null) { strokeJ56Offset = s.strokeJ56Offset; _setSliderPair('stroke-j56-slider', 'stroke-j56-val', strokeJ56Offset); }
    updateTLInfo();
  } catch(e) {}
}
function _setSliderPair(sliderId, valId, v) {
  const sl = document.getElementById(sliderId); if (sl) sl.value = v;
  const nm = document.getElementById(valId);    if (nm) nm.value = v.toFixed(2);
}
function saveTimeline() {
  try { localStorage.setItem(_TIMELINE_STORE, JSON.stringify(timelineEvents)); } catch(e) {}
}
function loadTimeline() {
  try {
    const raw = localStorage.getItem(_TIMELINE_STORE);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) timelineEvents = parsed;
  } catch(e) {}
}
// 타임라인 이벤트 변경 후 공통 처리 (render + 키프레임 재빌드 + 저장)
function _commitTimeline() {
  renderTimeline();
  _playKFs = buildFinalKeyframes();
  _playDur = _playKFs.totalTime;
  saveTimeline();
}

// ═══════════════════════════════════════════════════════════════
//  타임라인 상태
// ═══════════════════════════════════════════════════════════════
let timelineEvents = [];
let bpm = 120;
let beatsPerBar = 4;
let totalBars = 8;
let defaultVel     = 'medium'; // 타임라인 클릭 기본 velocity
let stickJ7Offset  = 0;  // 손목 스냅 J7 보정 (rad) — 양수 = 더 강하게 내려치는 방향
let strokeJ4Offset = 0;  // 팔꿈치 뻗음 J4 보정 (rad)
let strokeJ56Offset= 0;  // 전완 회전 J5·J6 보정 (rad)
let PX_PER_BEAT = 60; // renderTimeline()에서 동적으로 재계산

function updatePxPerBeat() {
  const el = document.getElementById('tl-scroll');
  const w  = (el?.clientWidth) || 900;
  PX_PER_BEAT = Math.max(28, Math.floor(w / (totalBars * beatsPerBar)));
}

// ═══════════════════════════════════════════════════════════════
//  오디오 상태 (Web Audio API)
// ═══════════════════════════════════════════════════════════════
let _audioCtx  = null;
let _audioBuf  = null;
let _audioSrc  = null;
let _audioStartCtxT = 0;
let _audioPlayOff   = 0;

// ═══════════════════════════════════════════════════════════════
//  중립 포즈
// ═══════════════════════════════════════════════════════════════
// 참조 프로젝트(openarmx-simulator-v2) 기준 대기 포즈
// L3=+0.1, R3=-0.1 (J3 대칭), L4=R4=0.26 (팔꿈치 자연 굴곡)
const NEUTRAL = {
  L1:0, L2:0, L3: 0.10, L4:0.26, L5:0, L6:0, L7:0,
  R1:0, R2:0, R3:-0.10, R4:0.26, R5:0, R6:0, R7:0,
  L_grip:0, R_grip:0,
};

// ═══════════════════════════════════════════════════════════════
//  역기구학 (수치 IK — TCP가 드럼 위치에 실제 도달)
// ═══════════════════════════════════════════════════════════════
const ARM_ROOT = {
  L: { x:0, y: 0.031, z:0.698 },
  R: { x:0, y:-0.031, z:0.698 },
};
const MAX_REACH = 0.82;

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function reachDist(drum) {
  // kick 등 팔 미배정 드럼은 가까운 쪽 루트 기준 (표시용)
  const root = ARM_ROOT[drum.arm] ?? ARM_ROOT[drum.pos.y >= 0 ? 'L' : 'R'];
  return Math.sqrt(
    (drum.pos.x - root.x) ** 2 +
    (drum.pos.y - root.y) ** 2 +
    (drum.pos.z - root.z) ** 2
  );
}

// ── 순수 수학 FK: 씬을 건드리지 않고 TCP 위치(URDF 좌표) 반환 ──
function _pureFK(jointAngles, arm) {
  const path = [
    'body', `${arm}0`,
    ...[1,2,3,4,5,6,7].map(i => `${arm}${i}`),
    `${arm}_hand`, `${arm}_tcp`,
  ];
  let mat = new THREE.Matrix4();
  for (const name of path) {
    const lk = CHAIN.find(l => l.name === name);
    if (!lk) continue;
    const [tx,ty,tz] = lk.xyz;
    const [r,p,y]    = lk.rpy;
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(r, p, y, 'XYZ'));
    if (lk.type === 'revolute' && lk.joint && jointAngles[lk.joint] !== undefined) {
      const ax = new THREE.Vector3(...lk.axis).normalize();
      q.multiply(new THREE.Quaternion().setFromAxisAngle(ax, jointAngles[lk.joint]));
    }
    mat.multiply(
      new THREE.Matrix4().compose(new THREE.Vector3(tx,ty,tz), q, new THREE.Vector3(1,1,1))
    );
  }
  return new THREE.Vector3().setFromMatrixPosition(mat);
}

// ── 수치 IK: J1~J6 최적화, J7 고정 ────────────────────────────
// L·R 팔 관절 한계 (물리적 충돌 방지)
const _IK_LIMITS = {
  L1:[-2.0, 0.2], L2:[-1.65, 0.30], L3:[-2.9, 2.9],
  L4:[0.05, 1.70], L5:[-2.9, 2.9], L6:[-1.57, 1.57],
  R1:[-0.2, 2.0], R2:[-0.30, 1.65], R3:[-2.9, 2.9],
  R4:[0.05, 1.70], R5:[-2.9, 2.9], R6:[-1.57, 1.57],
};

// extraLimits: { 'L1':[-2,-0.25], 'L4':[0.28,1.70] } 등 관절별 한계 오버라이드
function _solveIK(arm, targetUrdf, initAngles, j7, extraLimits) {
  const LIMITS = { ..._IK_LIMITS };
  if (extraLimits) Object.assign(LIMITS, extraLimits);

  const JK  = [1,2,3,4,5,6].map(i => `${arm}${i}`);
  const a   = { [`${arm}7`]: j7 };
  JK.forEach(k => {
    const [lo, hi] = LIMITS[k] ?? [-PI, PI];
    a[k] = clamp(initAngles[k] ?? 0, lo, hi);
  });

  const tgt = new THREE.Vector3(targetUrdf.x, targetUrdf.y, targetUrdf.z);
  const dt  = 0.004;

  for (let it = 0; it < 80; it++) {
    const cur = _pureFK(a, arm);
    const err = new THREE.Vector3().subVectors(tgt, cur);
    if (err.length() < 0.006) break;

    // 전체 그래디언트 계산 후 정규화 (스텝 안정성 확보)
    const grads = [];
    let gSq = 0;
    for (let i = 0; i < JK.length; i++) {
      const ap = { ...a }; ap[JK[i]] += dt;
      const dp = new THREE.Vector3().subVectors(_pureFK(ap, arm), cur).divideScalar(dt);
      const g  = dp.dot(err);
      grads.push(g);
      gSq += g * g;
    }
    const gNorm   = Math.sqrt(gSq) + 1e-8;
    const stepMag = Math.min(0.06, err.length() * 0.30) / gNorm;

    for (let i = 0; i < JK.length; i++) {
      const [lo, hi] = LIMITS[JK[i]] ?? [-PI, PI];
      a[JK[i]] = clamp(a[JK[i]] + grads[i] * stepMag, lo, hi);
    }
  }
  a[`${arm}7`] = j7;
  return a;
}

// ═══════════════════════════════════════════════════════════════
//  드럼채(스틱) — 그리퍼에 45° 고정, 그립점 앞 30cm 돌출
// ═══════════════════════════════════════════════════════════════
// hand 로컬 프레임: 그립점 (0,0,gripZ), 스틱 방향 = 로컬 +X·+Z 합성 45°
// dirSign=+1 → NEUTRAL(전관절 0)에서 스틱이 이미 전방-하향 45°를 향함
// (idle·인트로·아웃트로 자세를 건드릴 필요 없이 "기본자세"가 곧 정답)
const STICK = { fwd: 0.30, back: 0.10, tilt: PI / 4, gripZ: 0.08, dirSign: +1 };
const STICK_REACH = MAX_REACH + 0.16;

/** hand 링크까지의 FK 행렬 */
function _pureFKHand(jointAngles, arm) {
  const path = [
    'body', `${arm}0`,
    ...[1,2,3,4,5,6,7].map(i => `${arm}${i}`),
    `${arm}_hand`,
  ];
  let mat = new THREE.Matrix4();
  for (const name of path) {
    const lk = CHAIN.find(l => l.name === name);
    if (!lk) continue;
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(...lk.rpy, 'XYZ'));
    if (lk.type === 'revolute' && lk.joint && jointAngles[lk.joint] !== undefined) {
      const ax = new THREE.Vector3(...lk.axis).normalize();
      q.multiply(new THREE.Quaternion().setFromAxisAngle(ax, jointAngles[lk.joint]));
    }
    mat.multiply(
      new THREE.Matrix4().compose(new THREE.Vector3(...lk.xyz), q, new THREE.Vector3(1,1,1))
    );
  }
  return mat;
}

/** 스틱 팁·버트 월드 좌표 (URDF 프레임) */
function _pureFKStick(jointAngles, arm) {
  const handMat = _pureFKHand(jointAngles, arm);
  const sin = Math.sin(STICK.tilt), cos = Math.cos(STICK.tilt);
  const dirW = new THREE.Vector3(STICK.dirSign * sin, 0, cos).transformDirection(handMat);
  const grip = new THREE.Vector3(0, 0, STICK.gripZ).applyMatrix4(handMat);
  return {
    tip:  grip.clone().addScaledVector(dirW, STICK.fwd),
    butt: grip.clone().addScaledVector(dirW, -STICK.back),
    dir:  dirW,
  };
}

// ── 해석적 초기 추정치 (J2~J6 베이스라인 — 부드러운 함수, 후보 탐색 없음) ──
function _analyticGuess(drum, phase) {
  const s    = drum.arm;
  const root = ARM_ROOT[s];
  const rx   = drum.pos.x - root.x;
  const ry   = drum.pos.y - root.y;
  const rz_raw = drum.pos.z - root.z;
  const dist   = Math.sqrt(rx*rx + ry*ry + rz_raw*rz_raw);
  const style  = DRUM_TYPES[drum.type]?.style || 'full';

  const lateralRaw = s === 'L' ? ry : -ry;
  const fwdDist    = Math.max(rx, 0.05);
  let j1 = -(0.38 + lateralRaw * 1.85 + Math.atan2(lateralRaw, fwdDist) * 0.15);
  j1 = s === 'L' ? clamp(j1, -2.0, 0.2) : clamp(-j1, -0.2, 2.0);

  const dzSmall = { raise: +0.16, strike: 0, rebound: +0.10 };
  const rz      = rz_raw + (dzSmall[phase] || 0);
  let j2_l = -(0.14 + rz * 1.52);
  j2_l = clamp(j2_l, -1.65, 0.30);
  const j2 = s === 'L' ? j2_l : clamp(-j2_l, -0.30, 1.65);

  const j3 = s === 'L' ? 0.20 : -0.20;
  const distNorm = clamp(dist / MAX_REACH, 0, 1);
  const j4Hold   = clamp((1 - distNorm) * 2.95, 0.20, 1.40);
  const j4Delta  = { raise: +0.20, strike: -0.50, rebound: 0 }[phase] || 0;
  const j4Scale  = { big:1.15, wrist:1.00, full:1.00, none:0 }[style] ?? 1.0;
  // 심벌(big·wrist)은 팔꿈치를 더 굽혀 위에서 내려치는 자세 유도
  const j4CymbalBoost = (style === 'big' || style === 'wrist') ? 0.28 : 0;
  const j4 = clamp(j4Hold + j4Delta * j4Scale + j4CymbalBoost, 0.10, 1.65);
  const j5 = 0;
  const j6Raw = ({ wrist:{raise:.10,strike:-.08,rebound:.05},
                  big:  {raise:.12,strike:-.12,rebound:.06},
                  full: {raise:.08,strike:-.08,rebound:.04},
                  none: {raise:0,  strike:0,   rebound:0  } }[style] || {})[phase] || 0;
  // J6: 참조 프로젝트 규칙 — L ≈ -R
  const j6 = s === 'L' ? j6Raw : -j6Raw;
  const j7Raw = ({ raise:-0.86, strike:+0.18, rebound:-0.54 }[phase] || 0) *
                ({ big:1.05, wrist:1.00, full:0.88, none:0 }[style] ?? 1.0);
  const j7 = s === 'L' ? j7Raw : -j7Raw;

  const base = { L1:0,L2:0,L3:0,L4:0,L5:0,L6:0,L7:0, R1:0,R2:0,R3:0,R4:0,R5:0,R6:0,R7:0, L_grip:0,R_grip:0 };
  if (s === 'L') Object.assign(base, {L1:j1,L2:j2,L3:j3,L4:j4,L5:j5,L6:j6,L7:j7});
  else           Object.assign(base, {R1:j1,R2:j2,R3:j3,R4:j4,R5:j5,R6:j6,R7:j7});
  return base;
}

// ── 드럼 위치 → 타격 포즈 (검증된 6DOF IK + 스틱 오프셋 보정) ──
// J1~J6은 기존에 잘 동작하던 _solveIK(전체 수치 IK, 부드럽고 절제된 결과)를
// 그대로 사용하고, "손목이 아니라 스틱 팁이 드럼에 닿아야 한다"는 조건만
// 외곽 반복(tool-offset iteration)으로 보정한다:
//   1) 목표점(proxy)으로 J1~J6을 풀어 손목을 위치시킨다
//   2) 그 손목 자세에서 스틱 팁이 실제로 어디 있는지 계산한다
//   3) 팁과 드럼의 오차만큼 proxy를 이동시켜 다시 푼다 (2~3회면 수렴)
// → J7은 타격 위상(raise/strike/rebound)의 손목 스냅 값으로 고정.
//   즉 "팔은 스틱 없이 치던 자세 그대로, 스틱 길이만큼만 손목을 당겨서
//   보정"하는 모델이라 기존 시스템처럼 부드럽고 절제된 자세가 유지된다.

// 스트라이크 솔브 캐시 — 드럼 위치·강도가 같으면 재계산 없음 (빠른 박자 대응)
const _strikeSolveCache = new Map();

function _solveStickStrike(drum, vel) {
  const s     = drum.arm;
  const vs    = VEL_SCALE[vel] ?? VEL_SCALE.medium;
  const style = DRUM_TYPES[drum.type]?.style || 'full';
  const styleScale = { big:1.05, wrist:1.00, full:0.88, none:0 }[style] ?? 1.0;
  const j7Raw = 0.18 * vs.j7Strike * styleScale + stickJ7Offset;
  const j7    = s === 'L' ? j7Raw : -j7Raw;

  const key = [drum.id, vel,
               drum.pos.x.toFixed(3), drum.pos.y.toFixed(3), drum.pos.z.toFixed(3),
               stickJ7Offset.toFixed(3)].join('|');
  const hit = _strikeSolveCache.get(key);
  if (hit) return hit;

  const isCymbal = ['crash', 'ride', 'hihat'].includes(drum.type);

  // 관절 한계 — J4 최소 굽힘 정도만 강제하고, J1·J2·J6은 자유롭게 둔다.
  // (J1을 특정 방향으로 강제하면 "1번은 작게, 필요한 만큼만" 요구와 충돌한다)
  const extraLimits = {};
  if (isCymbal) {
    extraLimits[`${s}4`] = [0.28, 1.70];
  } else {
    const ar = ARM_ROOT[s];
    const dn = clamp(
      Math.sqrt((drum.pos.x-ar.x)**2 + (drum.pos.y-ar.y)**2 + (drum.pos.z-ar.z)**2) / MAX_REACH,
      0, 1);
    extraLimits[`${s}4`] = [clamp((1 - dn) * 2.5, 0.22, 1.20), 1.70];
  }
  // 측면 드럼: 어깨를 옆으로 펼치는 분기로 유도 — 팔이 안쪽으로 꼬여
  // J6에 큰 보정이 몰리는 국소해를 피한다
  const lateralY = (s === 'L' ? 1 : -1) * drum.pos.y;
  if (lateralY > 0.18) {
    if (s === 'L') extraLimits['L2'] = [-1.65, -0.40];
    else           extraLimits['R2'] = [ 0.40,  1.65];
  }

  // 도구-오프셋 보정: 손목이 아니라 "손목 + 0.30m 스틱 팁"이 드럼에 닿도록
  // 목표점을 반복 이동시키며 기존 검증된 _solveIK를 재사용.
  // proxy를 오차만큼 그대로 옮기면 팔 전체 배치가 크게 바뀌어(특히 J1 방위각)
  // 스틱 방향도 같이 흔들려 발산하므로, 감쇠(0.5)를 걸고 최선의 결과를 추적한다.
  //
  // J5(전완 롤)는 스틱 팁 위치에 거의 영향을 주지 않아 위치기반 그레이디언트가
  // 0에 가깝다 → 초기값에서 거의 안 움직인다. 여러 J5 시드로 각각 풀어
  // "raise↔strike 스윙이 얼마나 수직(하늘→바닥)에 가까운가"로 채점해
  // 최선의 해를 고른다. (J1 절대값을 강제로 넓게 스윕하는 방식도 시도했으나
  // 계산이 느리고(7드럼 14초+) 관절 한계에 바짝 붙는 부자연스러운 해로
  // 이어져 폐기 — J5 시드만으로도 대부분 수직성 0.95+ 확보됨)
  const target = new THREE.Vector3(drum.pos.x, drum.pos.y, drum.pos.z);
  const j5Sign = s === 'L' ? -1 : 1;
  const J5_SEEDS = [0, 0.7, 1.1, 1.4, -0.7].map(v => v * j5Sign);

  // raise 위상의 J7 (computeStrikePose와 동일 공식, medium velocity 기준)
  // — 후보 평가용. 관절 크기 자체엔 목표가 없다(가까운/먼 드럼 모두 필요한
  // 만큼 J1~J6을 움직여도 됨). 유일한 기준은 "J7 스윙이 하늘→바닥으로
  // 얼마나 수직에 가까운가" — 몸 안쪽으로 스치지 않는 자연스러운 타격.
  const raiseJ7Phase = (s === 'L' ? -0.86 : 0.86) * styleScale;
  const raiseJ7 = j7 + (raiseJ7Phase - j7) * 0.8;

  let overallBest = null, overallScore = -Infinity;
  for (const j5Seed of J5_SEEDS) {
    let proxy = { x: drum.pos.x, y: drum.pos.y, z: drum.pos.z };
    let best = null, bestErr = Infinity, init = null;
    const DAMPING = 0.5;
    for (let outer = 0; outer < 14; outer++) {
      if (!init) {
        const guess = _analyticGuess({ ...drum, pos: proxy }, 'strike');
        init = {};
        [1,2,3,4,6].forEach(i => { init[`${s}${i}`] = guess[`${s}${i}`]; });
        init[`${s}5`] = j5Seed;
      }
      const sol = _solveIK(s, proxy, init, j7,
                            Object.keys(extraLimits).length ? extraLimits : undefined);
      [1,2,3,4,5,6].forEach(i => { init[`${s}${i}`] = sol[`${s}${i}`]; });   // 다음 반복 웜스타트
      const tip = _pureFKStick(sol, s).tip;
      const err = target.clone().sub(tip);
      const errLen = err.length();
      if (errLen < bestErr) { bestErr = errLen; best = sol; }
      if (errLen < 0.004) break;
      proxy = { x: proxy.x + err.x * DAMPING, y: proxy.y + err.y * DAMPING, z: proxy.z + err.z * DAMPING };
    }
    if (bestErr >= 0.015) continue;   // 이 시드는 수렴 실패 → 제외

    // raise→strike 스윙 벡터의 수직성 평가 (같은 J1~J6, J7만 raise↔strike)
    const raiseTip  = _pureFKStick({ ...best, [`${s}7`]: raiseJ7 }, s).tip;
    const strikeTip = _pureFKStick(best, s).tip;
    const swing = strikeTip.clone().sub(raiseTip);
    const swingLen = swing.length();
    const verticality = swingLen > 1e-4 ? (-swing.z / swingLen) : -1;   // 1=완전 수직 하강
    if (verticality > overallScore) { overallScore = verticality; overallBest = best; overallBest._err = bestErr; }
    if (overallScore > 0.95) break;   // 충분히 수직 — 더 찾을 필요 없음(속도)
  }
  // 모든 시드가 수렴 실패한 극단적 경우에만 폴백(첫 시드 결과라도 사용)
  const solved  = overallBest ?? _analyticGuess(drum, 'strike');
  const errTip  = overallBest ? overallBest._err : 0.999;
  const result = { pose: solved, ok: errTip < 0.015, j7Strike: j7 };
  if (_strikeSolveCache.size > 300) _strikeSolveCache.clear();
  _strikeSolveCache.set(key, result);
  return result;
}

function computeStrikePose(drum, phase, vel = 'medium') {
  const s     = drum.arm;
  const style = DRUM_TYPES[drum.type]?.style || 'full';
  const vs    = VEL_SCALE[vel] ?? VEL_SCALE.medium;
  const styleScale = { big:1.05, wrist:1.00, full:0.88, none:0 }[style] ?? 1.0;

  const { pose: solved, j7Strike } = _solveStickStrike(drum, vel);

  // 포즈 조립 (해당 팔만 — buildKeyframes에서 L/R 트랙 분리)
  const pose = { ...NEUTRAL };
  [1,2,3,4,5,6,7].forEach(i => { pose[`${s}${i}`] = solved[`${s}${i}`]; });

  // raise/rebound = 손목(J7) 코킹 — 팔 관절(J1~J6)은 strike와 동일
  // cockScale 0.8: 과도한 손목 스윙(팁이 1m 가까이 치솟는 현상) 억제
  // → 전환 시 스틱이 인접 드럼을 스치는 문제 해소 (실측 검증)
  if (phase === 'raise' || phase === 'rebound') {
    const baseRaw  = ({ raise: -0.86, rebound: -0.54 })[phase] * styleScale;
    const j7Phase  = s === 'L' ? baseRaw : -baseRaw;
    const velScale = phase === 'raise'
      ? clamp(vs.raiseZ, 0.55, 1.35)
      : clamp(vs.rebZ,   0.50, 1.30);
    const cockScale = 0.8 * velScale;
    pose[`${s}7`] = j7Strike + (j7Phase - j7Strike) * cockScale;
  }

  // velocity J4 보정 — strike만 적용
  if (vs.j4 !== 0 && phase === 'strike') {
    pose[`${s}4`] = clamp((pose[`${s}4`] ?? 0) + vs.j4, 0, 1.70);
  }

  // 스트로크 튜닝 오프셋 (타격 직전 최대, raise 자연 유지, rebound 서서히 복귀)
  const strokePhaseW = { raise: 0, strike: 1.0, rebound: 0.3 }[phase] ?? 0;
  if (strokeJ4Offset !== 0) {
    pose[`${s}4`] = clamp((pose[`${s}4`] ?? 0) + strokeJ4Offset * strokePhaseW, 0, 1.70);
  }
  if (strokeJ56Offset !== 0) {
    const sign = s === 'L' ? 1 : -1;
    pose[`${s}5`] = clamp((pose[`${s}5`] ?? 0) + strokeJ56Offset * strokePhaseW * sign, -1.5, 1.5);
    pose[`${s}6`] = clamp((pose[`${s}6`] ?? 0) + strokeJ56Offset * strokePhaseW * sign, -0.75, 0.75);
  }

  return pose;
}

// ═══════════════════════════════════════════════════════════════
//  타임라인 → 키프레임 빌드 (L·R 팔 완전 분리 트랙)
// ═══════════════════════════════════════════════════════════════
/** 프리셋 frontReadyPose → L/R 각도 객체로 분리
 *  이 포즈를 시작·끝 기준으로 사용해 팔이 드럼 앞에서 대기하도록 보장 */
function _getReadyPoses() {
  const p = (typeof INTRO_OUTRO_PRESETS !== 'undefined'
    ? (INTRO_OUTRO_PRESETS.default?.frontReadyPose) : null)
    ?? [-0.79, -0.04, 0.01, 1.54, 0, 0, -0.58, 0.79, 0.04, -0.01, 1.54, 0, 0, 0.58];
  return {
    L: { L1:p[0], L2:p[1], L3:p[2], L4:p[3], L5:p[4], L6:p[5], L7:p[6] },
    R: { R1:p[7], R2:p[8], R3:p[9], R4:p[10], R5:p[11], R6:p[12], R7:p[13] },
  };
}

function buildKeyframes() {
  const beatDur    = 60 / bpm;
  const totalBeats = totalBars * beatsPerBar;
  const totalTime  = parseFloat((totalBeats * beatDur).toFixed(3));
  const preDur     = parseFloat(Math.max(0.12, Math.min(0.32, beatDur * 0.38)).toFixed(3));

  const L_KEYS = ['L1','L2','L3','L4','L5','L6','L7'];
  const R_KEYS = ['R1','R2','R3','R4','R5','R6','R7'];

  const { L: READY_L, R: READY_R } = _getReadyPoses();

  // preLift: READY + J4 +0.58 (최대 1.70) — 인트로 preLift와 동일 높이
  // → 인트로 t=4.00 이후 이벤트가 없는 팔이 즉시 내려오지 않도록
  const preLiftL = Object.fromEntries(
    Object.entries(READY_L).map(([k, v]) => [k, k.endsWith('4') ? clamp(v + 0.58, 0.10, 1.70) : v])
  );
  const preLiftR = Object.fromEntries(
    Object.entries(READY_R).map(([k, v]) => [k, k.endsWith('4') ? clamp(v + 0.58, 0.10, 1.70) : v])
  );

  // 왼팔·오른팔 키프레임 트랙 완전 분리
  const L_poseMap = new Map();
  const R_poseMap = new Map();

  // 시작 포즈를 preLift 레벨로 설정 (인트로 종료 포즈와 연속성 유지)
  L_poseMap.set('0.000', { ...preLiftL });
  R_poseMap.set('0.000', { ...preLiftR });

  // 팔별 이벤트를 시간순 정렬 — rebound/raise 겹침 감지에 필요
  const armEvts = { L: [], R: [] };
  timelineEvents.forEach(evt => {
    const drum = drumKit.find(d => d.id === evt.drumId);
    if (!drum || drum.type === 'kick') return;
    const t = parseFloat(((evt.beat - 1) * beatDur).toFixed(3));
    armEvts[drum.arm].push({ drum, t, vel: evt.vel ?? 'medium' });
  });
  armEvts.L.sort((a, b) => a.t - b.t);
  armEvts.R.sort((a, b) => a.t - b.t);

  function addPose(poseMap, time, pose, sideKeys, isStrike = false) {
    const key = time.toFixed(3);
    if (!poseMap.has(key)) poseMap.set(key, {});
    const cur = poseMap.get(key);
    sideKeys.forEach(k => { cur[k] = pose[k]; });
    if (isStrike) cur._isStrike = true;
  }

  ['L', 'R'].forEach(arm => {
    const poseMap  = arm === 'L' ? L_poseMap : R_poseMap;
    const sideKeys = arm === 'L' ? L_KEYS    : R_KEYS;

    armEvts[arm].forEach(({ drum, t, vel }, idx) => {
      const typeInfo = DRUM_TYPES[drum.type];
      const hasPrev  = idx > 0;  // 이전 타격이 있으면 raise 생략 → via-point가 대체
      const raiseT   = parseFloat(Math.max(0.001, t - preDur).toFixed(3));
      const reboundT = parseFloat((t + typeInfo.rebDur).toFixed(3));

      const next = armEvts[arm][idx + 1];

      // 다음 타격이 있으면 rebound 생략 — rebound가 현재 드럼 바로 위로 팔을 들어
      // strike → rebound → via-point 순서가 되면 ㄷ자 경로가 됨.
      // via-point가 두 드럼 사이 최고점 역할을 대신하므로 rebound 불필요.
      // 마지막 타격에만 rebound 포함(자연스러운 잔향 표현).
      const includeRebound = !next;

      if (!hasPrev) {
        addPose(poseMap, raiseT, computeStrikePose(drum, 'raise', vel), sideKeys);
      }
      addPose(poseMap, t, computeStrikePose(drum, 'strike', vel), sideKeys, true);
      if (includeRebound) {
        addPose(poseMap, reboundT, computeStrikePose(drum, 'rebound', vel), sideKeys);
      }

      // ── via-point: raise(A)와 raise(B) 중간에서 J4 최고점 ──
      // raise(A)를 기준으로 삼아야 히햇 등 심벌을 스치지 않고 충분히 들어올린 뒤 넘어감
      // (strike_A 기준 시 via-point Z가 너무 낮아 심벌 표면을 비비는 경로가 생김)
      if (next) {
        const peakT = parseFloat(((t + next.t) / 2).toFixed(3));
        const posA  = computeStrikePose(drum,      'raise', vel);
        const posB  = computeStrikePose(next.drum, 'raise', next.vel ?? 'medium');
        const peak  = {};
        sideKeys.forEach(k => {
          const a = posA[k] ?? 0;
          const b = posB[k] ?? 0;
          let v = (a + b) / 2;
          if (k.endsWith('4')) v = clamp(v + 0.45, 0.10, 1.70);
          peak[k] = v;
        });
        addPose(poseMap, peakT, peak, sideKeys);
      }
    });
  });

  L_poseMap.set(totalTime.toFixed(3), { ...READY_L });
  R_poseMap.set(totalTime.toFixed(3), { ...READY_R });

  const toArray = (map) =>
    Array.from(map.entries())
      .map(([t, v]) => {
        const { _isStrike, ...angles } = v;
        return { time: parseFloat(t), angles, isStrike: !!_isStrike };
      })
      .sort((a, b) => a.time - b.time);

  return { L: toArray(L_poseMap), R: toArray(R_poseMap), totalTime };
}

// ═══════════════════════════════════════════════════════════════
//  YAML 내보내기
// ═══════════════════════════════════════════════════════════════
// ── 관절 최대 속도·가속도 (OpenArmX 안전 기준값) ─────────────
const _JOINT_MAX_VEL = {
  L1:1.5, L2:1.5, L3:2.0, L4:2.0, L5:2.5, L6:2.5, L7:2.5,
  R1:1.5, R2:1.5, R3:2.0, R4:2.0, R5:2.5, R6:2.5, R7:2.5,
};
const _JOINT_MAX_ACC = {
  L1:3.0, L2:3.0, L3:4.0, L4:4.0, L5:5.0, L6:5.0, L7:5.0,
  R1:3.0, R2:3.0, R3:4.0, R4:4.0, R5:5.0, R6:5.0, R7:5.0,
};

function computeVelAccel(kfs) {
  const n    = kfs.length;
  const keys = ['L1','L2','L3','L4','L5','L6','L7','R1','R2','R3','R4','R5','R6','R7'];
  const vel  = Array.from({ length: n }, () => ({}));
  const acc  = Array.from({ length: n }, () => ({}));

  keys.forEach(k => {
    const maxV = _JOINT_MAX_VEL[k] ?? 2.0;
    const maxA = _JOINT_MAX_ACC[k] ?? 4.0;

    // 시작·끝: 정지 상태 (velocity = 0)
    vel[0][k] = 0; vel[n-1][k] = 0;
    acc[0][k] = 0; acc[n-1][k] = 0;

    // 중간: 중앙 차분 (central difference)
    for (let i = 1; i < n - 1; i++) {
      const dt = kfs[i+1].time - kfs[i-1].time;
      vel[i][k] = dt > 0
        ? clamp((kfs[i+1].angles[k] - kfs[i-1].angles[k]) / dt, -maxV, maxV)
        : 0;
    }
    // 가속도: velocity의 중앙 차분
    for (let i = 1; i < n - 1; i++) {
      const dt = kfs[i+1].time - kfs[i-1].time;
      acc[i][k] = dt > 0
        ? clamp((vel[i+1][k] - vel[i-1][k]) / dt, -maxA, maxA)
        : 0;
    }
  });
  return { vel, acc };
}

window.exportYAML = function () {
  const kfs = buildFinalFlatTimeline();   // 인트로/아웃트로 포함 최종 타임라인
  if (kfs.length <= 1) { alert('타임라인에 드럼 이벤트를 추가하세요.'); return; }

  const { vel, acc } = computeVelAccel(kfs);

  const jointNames = [
    'openarmx_left_joint1','openarmx_left_joint2','openarmx_left_joint3','openarmx_left_joint4',
    'openarmx_left_joint5','openarmx_left_joint6','openarmx_left_joint7',
    'openarmx_right_joint1','openarmx_right_joint2','openarmx_right_joint3','openarmx_right_joint4',
    'openarmx_right_joint5','openarmx_right_joint6','openarmx_right_joint7',
  ];
  const shortKeys = ['L1','L2','L3','L4','L5','L6','L7','R1','R2','R3','R4','R5','R6','R7'];

  // 드럼 이벤트 (velocity 포함)
  let yaml = 'drum_events:\n';
  [...timelineEvents]
    .sort((a, b) => a.beat - b.beat)
    .forEach(e => {
      const d = drumKit.find(d => d.id === e.drumId);
      if (!d) return;
      yaml += `- {drum: ${d.type}, name: "${d.name}", beat: ${e.beat.toFixed(3)}, vel: ${e.vel ?? 'medium'}}\n`;
    });
  yaml += '\njoint_names:\n';
  jointNames.forEach(n => { yaml += `- ${n}\n`; });
  yaml += 'points:\n';

  kfs.forEach((kf, i) => {
    yaml += '- positions:\n';
    shortKeys.forEach(k => {
      yaml += `  - ${parseFloat((kf.angles[k] ?? 0).toFixed(4))}\n`;
    });
    yaml += '  velocities:\n';
    shortKeys.forEach(k => {
      yaml += `  - ${parseFloat((vel[i][k] ?? 0).toFixed(4))}\n`;
    });
    yaml += '  accelerations:\n';
    shortKeys.forEach(k => {
      yaml += `  - ${parseFloat((acc[i][k] ?? 0).toFixed(4))}\n`;
    });
    yaml += `  time_from_start: ${kf.time.toFixed(3)}\n`;
  });

  const ts = new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 15);
  const a  = document.createElement('a');
  a.href     = 'data:text/yaml;charset=utf-8,' + encodeURIComponent(yaml);
  a.download = `drum_${ts}.yaml`;
  a.click();
  setStatus(`YAML 저장 완료 — ${kfs.length}개 포인트 (positions·velocities·accelerations)`);
};

// ═══════════════════════════════════════════════════════════════
//  비트 오디오 내보내기 (WAV — OfflineAudioContext 렌더링)
// ═══════════════════════════════════════════════════════════════

/** AudioBuffer → 16-bit PCM WAV Blob */
function _audioBufferToWav(buffer) {
  const numCh   = buffer.numberOfChannels;
  const sr      = buffer.sampleRate;
  const len     = buffer.length;
  const bps     = 2; // 16-bit
  const dataLen = len * numCh * bps;
  const ab      = new ArrayBuffer(44 + dataLen);
  const v       = new DataView(ab);
  const s       = (o, str) => { for (let i = 0; i < str.length; i++) v.setUint8(o + i, str.charCodeAt(i)); };
  s(0,'RIFF'); v.setUint32(4, 36 + dataLen, true); s(8,'WAVE');
  s(12,'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true);
  v.setUint16(22, numCh, true); v.setUint32(24, sr, true);
  v.setUint32(28, sr * numCh * bps, true); v.setUint16(32, numCh * bps, true);
  v.setUint16(34, 16, true); s(36,'data'); v.setUint32(40, dataLen, true);
  let off = 44;
  for (let i = 0; i < len; i++) {
    for (let ch = 0; ch < numCh; ch++) {
      const s16 = Math.max(-1, Math.min(1, buffer.getChannelData(ch)[i])) * 0x7FFF;
      v.setInt16(off, s16, true); off += 2;
    }
  }
  return new Blob([ab], { type: 'audio/wav' });
}

window.exportAudio = async function () {
  if (!timelineEvents.length) { alert('타임라인에 드럼 이벤트를 추가하세요.'); return; }

  // 체크박스 상태에 따라 항상 최신 길이 계산 (재생 없이도 동작)
  const latestKFs = buildFinalKeyframes();
  const totalDur  = latestKFs.totalTime || 0;
  if (totalDur <= 0) { alert('타임라인에 드럼 이벤트를 추가하세요.'); return; }

  setStatus('🎵 오디오 렌더링 중... (잠시 대기)');
  await new Promise(r => setTimeout(r, 30)); // UI 업데이트 대기

  try {
    const SR   = 44100;
    const ctx  = new OfflineAudioContext(2, Math.ceil(totalDur * SR), SR);
    const bd   = 60 / bpm;
    const iOff = _getAudioTimeOffset(); // 인트로 오프셋

    // ── 드럼 합성음 스케줄 ─────────────────────────────────────
    timelineEvents.forEach(evt => {
      const drum = drumKit.find(d => d.id === evt.drumId);
      if (!drum) return;
      const hitT = (evt.beat - 1) * bd + iOff;
      if (hitT < 0 || hitT >= totalDur) return;
      const fn = _drumSounds[drum.type] || _drumSounds.tom_m;
      fn(hitT, ctx);
    });

    // ── 배경 음악 믹스 (로드된 경우) ──────────────────────────
    if (_audioBuf) {
      const src = ctx.createBufferSource();
      src.buffer = _audioBuf;
      // 볼륨 살짝 낮춰서 드럼과 밸런스
      const gain = ctx.createGain(); gain.gain.value = 0.80;
      src.connect(gain); gain.connect(ctx.destination);
      const startAt  = Math.max(0, iOff);
      const audioPos = Math.max(0, 0); // 음악 파일 시작 위치
      src.start(startAt, audioPos);
    }

    const rendered = await ctx.startRendering();
    const wav      = _audioBufferToWav(rendered);
    const ts       = new Date().toISOString().replace(/[-:T.]/g,'').slice(0,15);
    const a        = document.createElement('a');
    a.href         = URL.createObjectURL(wav);
    a.download     = `drum_beat_${ts}.wav`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 3000);

    setStatus(`🎵 오디오 내보내기 완료 — ${totalDur.toFixed(1)}s WAV`);
  } catch (e) {
    setStatus('오디오 렌더링 실패: ' + e.message);
  }
};

// ═══════════════════════════════════════════════════════════════
//  검증
// ═══════════════════════════════════════════════════════════════
window.validatePattern = function () {
  const results  = [];
  const beatDur  = 60 / bpm;

  results.push({ lv:'info', msg:`BPM ${bpm} · ${totalBars}마디 · ${beatsPerBar}/4박자` });
  results.push({ lv:'info', msg:`타임라인 이벤트 ${timelineEvents.length}개` });

  drumKit.forEach(d => {
    if (d.type === 'kick') { results.push({ lv:'info', msg:`[${d.name}] 킥 — 확장 이벤트 (팔 동작 없음)` }); return; }
    const dist = reachDist(d);
    if      (dist > STICK_REACH)      results.push({ lv:'err',  msg:`[${d.name}] 도달 불가 (${dist.toFixed(2)}m > ${STICK_REACH}m)` });
    else if (dist > STICK_REACH * 0.88) results.push({ lv:'warn', msg:`[${d.name}] 한계 근접 (${dist.toFixed(2)}m)` });
    else                              results.push({ lv:'ok',   msg:`[${d.name}] 도달 가능 (${dist.toFixed(2)}m)` });
  });

  if (!drumKit.some(d => d.arm === 'L' && d.type !== 'kick'))
    results.push({ lv:'warn', msg:'왼팔에 드럼이 없습니다.' });
  if (!drumKit.some(d => d.arm === 'R' && d.type !== 'kick'))
    results.push({ lv:'warn', msg:'오른팔에 드럼이 없습니다.' });

  // 팔별 이벤트 목록 (시간순)
  const armEvts = { L:[], R:[] };
  timelineEvents.forEach(evt => {
    const drum = drumKit.find(d => d.id === evt.drumId);
    if (!drum || drum.type === 'kick') return;
    armEvts[drum.arm].push({ t: (evt.beat - 1) * beatDur, drum });
  });
  ['L','R'].forEach(arm => {
    const evts     = armEvts[arm].sort((a, b) => a.t - b.t);
    const otherArm = arm === 'L' ? 'R' : 'L';
    const armKr    = arm === 'L' ? '왼팔' : '오른팔';
    const otherKr  = arm === 'L' ? '오른팔' : '왼팔';

    for (let i = 1; i < evts.length; i++) {
      const gap = evts[i].t - evts[i - 1].t;
      if (gap < 0.055) {
        // 반대팔로 두 번째 드럼을 칠 수 있는지 체크
        const d2       = evts[i].drum;
        const distAlt  = reachDist({ ...d2, arm: otherArm });
        const canAlt   = distAlt <= STICK_REACH;
        // 해당 타이밍에 반대팔이 이미 쓰이는지
        const beatSec  = evts[i].t;
        const otherBusy = armEvts[otherArm].some(e => Math.abs(e.t - beatSec) < 0.01);
        const altHint  = canAlt && !otherBusy
          ? ` → [${d2.name}]을 ${otherKr}으로 변경하면 해결 가능 (${distAlt.toFixed(2)}m)`
          : canAlt && otherBusy
            ? ` (${otherKr}도 해당 타이밍에 사용 중)`
            : ` (${otherKr}도 도달 불가 ${distAlt.toFixed(2)}m)`;
        results.push({ lv:'err',
          msg:`${armKr} 연속 타격 간격 너무 짧음 (${(gap*1000).toFixed(0)}ms)${altHint}` });
      } else if (gap < 0.12) {
        results.push({ lv:'warn',
          msg:`${armKr} 고속 타격 (${(gap*1000).toFixed(0)}ms) — 확인 필요` });
      }
    }
  });

  if (bpm > 180) results.push({ lv:'warn', msg:`BPM ${bpm}: 고속 연주 — 로봇 구동 한계를 확인하세요.` });

  const kfs       = buildFinalFlatTimeline();   // 인트로/아웃트로 포함
  const shortKeys = ['L1','L2','L3','L4','L5','L6','L7','R1','R2','R3','R4','R5','R6','R7'];
  let yamlOk = true;
  kfs.forEach(kf => { shortKeys.forEach(k => { if (!isFinite(kf.angles[k])) yamlOk = false; }); });
  results.push(yamlOk
    ? { lv:'ok',  msg:`최종 YAML: ${kfs.length}개 포인트 (positions + velocities + accelerations) ✓` }
    : { lv:'err', msg:'YAML에 유효하지 않은 값이 있습니다.' }
  );

  // ── 키프레임 밀도 체크 ──────────────────────────────────────
  // ROS2 컨트롤러 처리 가능 최소 간격 기준
  let densityErrCnt = 0, densityWarnCnt = 0;
  for (let i = 1; i < kfs.length; i++) {
    const gap = kfs[i].time - kfs[i-1].time;
    const ms  = (gap * 1000).toFixed(0);
    if (gap < 0.025) {
      densityErrCnt++;
      results.push({ lv:'err',  msg:`키프레임 간격 ${ms}ms (t=${kfs[i].time.toFixed(3)}s) — 컨트롤러 처리 불가 (최소 25ms)` });
    } else if (gap < 0.055) {
      densityWarnCnt++;
      if (densityWarnCnt <= 3)  // 경고 최대 3개만 표시
        results.push({ lv:'warn', msg:`키프레임 간격 ${ms}ms (t=${kfs[i].time.toFixed(3)}s) — 고속 구간, 확인 권장` });
    }
  }
  if (densityWarnCnt > 3)
    results.push({ lv:'warn', msg:`외 ${densityWarnCnt - 3}개 고속 구간 더 있음` });
  if (densityErrCnt === 0 && densityWarnCnt === 0)
    results.push({ lv:'ok', msg:'모든 키프레임 간격 정상 (≥ 55ms)' });

  const iconMap = { ok:'✓', warn:'⚠', err:'✗', info:'ℹ' };
  document.getElementById('validation-content').innerHTML =
    results.map(r => `<div class="val-${r.lv}">${iconMap[r.lv]} ${r.msg}</div>`).join('');
  document.getElementById('validation-modal').style.display = 'flex';
};

window.closeValidation = function () {
  document.getElementById('validation-modal').style.display = 'none';
};

// ═══════════════════════════════════════════════════════════════
//  Three.js — 로봇 키네마틱 체인
// ═══════════════════════════════════════════════════════════════
const CHAIN = [
  { name:'body', parent:null, type:'fixed', xyz:[0,0,0], rpy:[0,0,0], axis:null, joint:null,
    mesh:{file:'body/v10/collision/body_link0_symp.stl', scale:[0.001,0.001,0.001], offset:[0,0,0]} },
  { name:'L0', parent:'body', type:'fixed',    xyz:[0,0.031,0.698],    rpy:[-PI/2,0,0], axis:null,    joint:null,
    mesh:{file:'arm/v10/visual/link0.stl', scale:[1,-1,1], offset:[0,0,0]} },
  { name:'L1', parent:'L0',   type:'revolute', xyz:[0,0,0.058],        rpy:[0,0,0],     axis:[0,0,1],  joint:'L1',
    mesh:{file:'arm/v10/visual/link1.stl', scale:[1,-1,1], offset:[0,0,0]} },
  { name:'L2', parent:'L1',   type:'revolute', xyz:[-0.0205,0,0.081],  rpy:[-PI/2,0,0], axis:[-1,0,0], joint:'L2',
    mesh:{file:'arm/v10/visual/link2.stl', scale:[1,-1,1], offset:[0,0,0]} },
  { name:'L3', parent:'L2',   type:'revolute', xyz:[0.02,0,0.099],     rpy:[0,0,0],     axis:[0,0,1],  joint:'L3',
    mesh:{file:'arm/v10/visual/link3.stl', scale:[1,-1,1], offset:[0,0,0]} },
  { name:'L4', parent:'L3',   type:'revolute', xyz:[0,0.031002,0.14181],rpy:[0,0,0],    axis:[0,1,0],  joint:'L4',
    mesh:{file:'arm/v10/visual/link4.stl', scale:[1,1,1],  offset:[0,0,0]} },
  { name:'L5', parent:'L4',   type:'revolute', xyz:[0,-0.0309,0.126],  rpy:[0,0,0],     axis:[0,0,1],  joint:'L5',
    mesh:{file:'arm/v10/visual/link5.stl', scale:[1,-1,1], offset:[0,0,0]} },
  { name:'L6', parent:'L5',   type:'revolute', xyz:[0.037426,0,0.131], rpy:[0,0,0],     axis:[1,0,0],  joint:'L6',
    mesh:{file:'arm/v10/visual/link6.stl', scale:[1,-1,1], offset:[0,0,0]} },
  { name:'L7', parent:'L6',   type:'revolute', xyz:[-0.0375,0,0],      rpy:[0,0,0],     axis:[0,-1,0], joint:'L7',
    mesh:{file:'arm/v10/visual/link7.stl', scale:[1,-1,1], offset:[0,0,0]} },
  { name:'L_hand', parent:'L7', type:'fixed', xyz:[0,0,0.1001], rpy:[0,0,0], axis:null, joint:null,
    mesh:{file:'ee/openarmx_hand/collision/hand.stl', scale:[0.001,0.001,0.001], offset:[0,0,-0.6585]} },
  { name:'L_fR', parent:'L_hand', type:'prismatic', xyz:[0,-0.006,0.015], rpy:[0,0,0], axis:[0,-1,0], joint:'L_grip',
    mesh:{file:'ee/openarmx_hand/collision/finger.stl', scale:[0.001,0.001,0.001], offset:[0,-0.05,-0.673]} },
  { name:'L_fL', parent:'L_hand', type:'prismatic', xyz:[0,0.006,0.015],  rpy:[0,0,0], axis:[0,1,0],  joint:'L_grip',
    mesh:{file:'ee/openarmx_hand/collision/finger.stl', scale:[0.001,-0.001,0.001], offset:[0,0.05,-0.673]} },
  { name:'L_tcp', parent:'L_hand', type:'fixed', xyz:[0,0,0.08], rpy:[0,0,0], axis:null, joint:null, mesh:null },
  // 스틱 팁 (그립점 + 45° 방향 0.30m, dirSign=+1) — HUD·트레일·타격 기준점
  { name:'L_tip', parent:'L_hand', type:'fixed', xyz:[0.21213,0,0.29213], rpy:[0,0,0], axis:null, joint:null, mesh:null },
  { name:'R0', parent:'body', type:'fixed',    xyz:[0,-0.031,0.698],   rpy:[PI/2,0,0],  axis:null,    joint:null,
    mesh:{file:'arm/v10/visual/link0.stl', scale:[1,1,1], offset:[0,0,0]} },
  { name:'R1', parent:'R0',   type:'revolute', xyz:[0,0,0.058],        rpy:[0,0,0],     axis:[0,0,1],  joint:'R1',
    mesh:{file:'arm/v10/visual/link1.stl', scale:[1,1,1], offset:[0,0,0]} },
  { name:'R2', parent:'R1',   type:'revolute', xyz:[-0.0205,0,0.081],  rpy:[PI/2,0,0],  axis:[-1,0,0], joint:'R2',
    mesh:{file:'arm/v10/visual/link2.stl', scale:[1,1,1], offset:[0,0,0]} },
  { name:'R3', parent:'R2',   type:'revolute', xyz:[0.02,0,0.099],     rpy:[0,0,0],     axis:[0,0,1],  joint:'R3',
    mesh:{file:'arm/v10/visual/link3.stl', scale:[1,1,1], offset:[0,0,0]} },
  { name:'R4', parent:'R3',   type:'revolute', xyz:[0,0.031002,0.14181],rpy:[0,0,0],    axis:[0,1,0],  joint:'R4',
    mesh:{file:'arm/v10/visual/link4.stl', scale:[1,1,1], offset:[0,0,0]} },
  { name:'R5', parent:'R4',   type:'revolute', xyz:[0,-0.0309,0.126],  rpy:[0,0,0],     axis:[0,0,1],  joint:'R5',
    mesh:{file:'arm/v10/visual/link5.stl', scale:[1,1,1], offset:[0,0,0]} },
  { name:'R6', parent:'R5',   type:'revolute', xyz:[0.037426,0,0.131], rpy:[0,0,0],     axis:[1,0,0],  joint:'R6',
    mesh:{file:'arm/v10/visual/link6.stl', scale:[1,1,1], offset:[0,0,0]} },
  { name:'R7', parent:'R6',   type:'revolute', xyz:[-0.0375,0,0],      rpy:[0,0,0],     axis:[0,1,0],  joint:'R7',
    mesh:{file:'arm/v10/visual/link7.stl', scale:[1,1,1], offset:[0,0,0]} },
  { name:'R_hand', parent:'R7', type:'fixed', xyz:[0,0,0.1001], rpy:[0,0,0], axis:null, joint:null,
    mesh:{file:'ee/openarmx_hand/collision/hand.stl', scale:[0.001,0.001,0.001], offset:[0,0,-0.6585]} },
  { name:'R_fR', parent:'R_hand', type:'prismatic', xyz:[0,-0.006,0.015], rpy:[0,0,0], axis:[0,-1,0], joint:'R_grip',
    mesh:{file:'ee/openarmx_hand/collision/finger.stl', scale:[0.001,0.001,0.001], offset:[0,-0.05,-0.673]} },
  { name:'R_fL', parent:'R_hand', type:'prismatic', xyz:[0,0.006,0.015],  rpy:[0,0,0], axis:[0,1,0],  joint:'R_grip',
    mesh:{file:'ee/openarmx_hand/collision/finger.stl', scale:[0.001,-0.001,0.001], offset:[0,0.05,-0.673]} },
  { name:'R_tcp', parent:'R_hand', type:'fixed', xyz:[0,0,0.08], rpy:[0,0,0], axis:null, joint:null, mesh:null },
  { name:'R_tip', parent:'R_hand', type:'fixed', xyz:[0.21213,0,0.29213], rpy:[0,0,0], axis:null, joint:null, mesh:null },
];

// ── Three.js 초기화 ───────────────────────────────────────────
const viewport = document.getElementById('viewport');
const renderer = new THREE.WebGLRenderer({ antialias:true, preserveDrawingBuffer:true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
viewport.insertBefore(renderer.domElement, document.getElementById('playbar'));

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xf0f2f5);
scene.fog = new THREE.FogExp2(0xf0f2f5, 0.04);

const camera = new THREE.PerspectiveCamera(42, 1, 0.01, 30);
camera.position.set(1.6, 1.1, 2.0);
camera.lookAt(0, 0.5, 0);

const orbit = new OrbitControls(camera, renderer.domElement);
orbit.target.set(0, 0.5, 0);
orbit.enableDamping = true; orbit.dampingFactor = 0.06;
orbit.zoomSpeed = 0.4;
orbit.minDistance = 0.3; orbit.maxDistance = 8;
orbit.update();

scene.add(new THREE.AmbientLight(0x304060, 1.3));
const sun = new THREE.DirectionalLight(0xffffff, 2.0);
sun.position.set(3, 5, 3); sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { near:0.1, far:15, left:-2, right:2, top:3, bottom:-1 });
scene.add(sun);
const fill = new THREE.DirectionalLight(0x4488ff, 0.4);
fill.position.set(-2, 2, -2);
scene.add(fill);
scene.add(new THREE.GridHelper(4, 24, 0xbbbbcc, 0xddddee));

// URDF Z-up → Three.js Y-up
const sceneRoot = new THREE.Group();
sceneRoot.rotation.x = -PI / 2;
scene.add(sceneRoot);

const MAT = {
  body:  new THREE.MeshStandardMaterial({ color:0x4a6080, roughness:.55, metalness:.25 }),
  left:  new THREE.MeshStandardMaterial({ color:0x3a7ae0, roughness:.35, metalness:.25 }),
  right: new THREE.MeshStandardMaterial({ color:0xe04030, roughness:.35, metalness:.25 }),
  hand:  new THREE.MeshStandardMaterial({ color:0x7a8898, roughness:.45, metalness:.20 }),
  tcp:   new THREE.MeshStandardMaterial({ color:0x00ff88, emissive:0x00aa44, emissiveIntensity:.9, roughness:.1 }),
};
function getMat(name) {
  if (name.includes('hand') || name.includes('_f')) return MAT.hand.clone();
  if (name === 'body') return MAT.body.clone();
  if (name.startsWith('L')) return MAT.left.clone();
  if (name.startsWith('R')) return MAT.right.clone();
  return MAT.body.clone();
}

const groups = {};
CHAIN.forEach(lk => { groups[lk.name] = new THREE.Group(); groups[lk.name].name = lk.name; });
CHAIN.forEach(lk => { (lk.parent ? groups[lk.parent] : sceneRoot).add(groups[lk.name]); });

const tcpGeo = new THREE.SphereGeometry(0.013, 8, 8);
['L_tcp','R_tcp'].forEach(n => groups[n].add(new THREE.Mesh(tcpGeo, MAT.tcp.clone())));

// ── 드럼채 (그리퍼 45° 고정, 팁쪽 테이퍼) ──────────────────────
['L','R'].forEach(s => {
  const grp = groups[`${s}_hand`];
  const sin = Math.sin(STICK.tilt), cos = Math.cos(STICK.tilt);
  const dir = new THREE.Vector3(STICK.dirSign * sin, 0, cos);
  const len = STICK.fwd + STICK.back;

  const stickGeo = new THREE.CylinderGeometry(0.0045, 0.0075, len, 10); // 위(팁) 가늘게
  const stickMat = new THREE.MeshStandardMaterial({ color: 0xc9a063, roughness: 0.6, metalness: 0.05 });
  const stick = new THREE.Mesh(stickGeo, stickMat);
  stick.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  stick.position.set(0, 0, STICK.gripZ).addScaledVector(dir, (STICK.fwd - STICK.back) / 2);
  stick.castShadow = true;
  grp.add(stick);

  // 팁 비드 (타격점 표시)
  const bead = new THREE.Mesh(
    new THREE.SphereGeometry(0.009, 10, 10),
    new THREE.MeshStandardMaterial({ color: 0xf0e0c0, roughness: 0.45 }));
  bead.position.set(0, 0, STICK.gripZ).addScaledVector(dir, STICK.fwd);
  bead.castShadow = true;
  grp.add(bead);
});

const MESH_BASE = './meshes/';
const stlLoader = new STLLoader();
let loaded = 0, meshTotal = 0;

CHAIN.forEach(lk => {
  if (!lk.mesh) return;
  meshTotal++;
  stlLoader.load(`${MESH_BASE}${lk.mesh.file}`, geo => {
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, getMat(lk.name));
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.scale.set(...lk.mesh.scale);
    mesh.position.set(...lk.mesh.offset);
    groups[lk.name].add(mesh);
    if (++loaded === meshTotal) setStatus('준비 완료 ✓');
    else setStatus(`메시 로딩 ${loaded}/${meshTotal}`);
  }, undefined, () => { loaded++; });
});

// ── 순방향 기구학 (FK) ───────────────────────────────────────
function updateFK(angles) {
  CHAIN.forEach(lk => {
    const g = groups[lk.name];
    const [x, y, z] = lk.xyz;
    const [r, p, yw] = lk.rpy;
    const qO = new THREE.Quaternion().setFromEuler(new THREE.Euler(r, p, yw, 'XYZ'));
    if (lk.type === 'revolute' && lk.joint && angles[lk.joint] !== undefined) {
      const ax = new THREE.Vector3(...lk.axis).normalize();
      g.quaternion.copy(qO).multiply(new THREE.Quaternion().setFromAxisAngle(ax, angles[lk.joint]));
      g.position.set(x, y, z);
    } else if (lk.type === 'prismatic' && lk.joint) {
      const d = angles[lk.joint] || 0;
      g.position.set(x + lk.axis[0]*d, y + lk.axis[1]*d, z + lk.axis[2]*d);
      g.quaternion.copy(qO);
    } else {
      g.position.set(x, y, z); g.quaternion.copy(qO);
    }
  });
  updateTCPHud();
}

function updateTCPHud() {
  ['L','R'].forEach(s => {
    const tcp = groups[`${s}_tip`];   // 스틱 팁 = 타격 기준점
    if (!tcp) return;
    const wp = new THREE.Vector3();
    tcp.getWorldPosition(wp);
    const el = document.getElementById(`tcp-${s.toLowerCase()}`);
    if (el) el.textContent = `X${wp.x.toFixed(2)} Y${(-wp.z).toFixed(2)} Z${wp.y.toFixed(2)}`;
  });
}

// ═══════════════════════════════════════════════════════════════
//  드럼 사운드 합성 (Web Audio — 외부 파일 없이 합성음 사용)
// ═══════════════════════════════════════════════════════════════
let _drumAudioCtx = null;
let _drumSoundOn  = true;

function _getDrumCtx() {
  if (!_drumAudioCtx) _drumAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (_drumAudioCtx.state === 'suspended') _drumAudioCtx.resume();
  return _drumAudioCtx;
}

const _drumSounds = {
  // 킥·플로어탐: 사인파 피치 스윕
  kick(t, c, g=0.9)  { _synthPitch(c, t, 120, 28, 0.35, g); },
  tom_f(t, c, g=0.8) { _synthPitch(c, t, 90,  35, 0.30, g); },
  // 스네어: 노이즈 + 짧은 저음
  snare(t, c, g=0.7) {
    _synthNoise(c, t, 'bandpass', 1400, 0.8, 0.14, g);
    _synthPitch(c, t, 200, 100, 0.08, g * 0.5);
  },
  // 탐: 피치 스윕 (주파수만 다름)
  tom_h(t, c, g=0.7) { _synthPitch(c, t, 260, 110, 0.22, g); },
  tom_m(t, c, g=0.7) { _synthPitch(c, t, 170,  80, 0.25, g); },
  // 하이햇: 고역 노이즈
  hihat(t, c, g=0.45){ _synthNoise(c, t, 'highpass', 8000, 1.2, 0.06, g); },
  // 크래시·라이드: 긴 노이즈
  crash(t, c, g=0.5) { _synthNoise(c, t, 'bandpass', 5500, 0.4, 0.70, g); },
  ride(t, c, g=0.38) { _synthNoise(c, t, 'bandpass', 6500, 0.6, 0.38, g); },
};

function _synthPitch(c, t, f0, f1, dur, gain) {
  const osc = c.createOscillator(), g = c.createGain();
  osc.connect(g); g.connect(c.destination);
  osc.type = 'sine';
  osc.frequency.setValueAtTime(f0, t);
  osc.frequency.exponentialRampToValueAtTime(f1, t + dur);
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  osc.start(t); osc.stop(t + dur + 0.01);
}
function _synthNoise(c, t, filterType, freq, Q, dur, gain) {
  const buf = c.createBuffer(1, Math.ceil(c.sampleRate * dur), c.sampleRate);
  const d   = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
  src.buffer = buf; src.connect(f); f.connect(g); g.connect(c.destination);
  f.type = filterType; f.frequency.value = freq; f.Q.value = Q;
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.start(t); src.stop(t + dur + 0.01);
}

window.toggleDrumSound = function () {
  _drumSoundOn = !_drumSoundOn;
  const btn = document.getElementById('btn-sound');
  if (btn) { btn.textContent = _drumSoundOn ? '🔊' : '🔇'; btn.classList.toggle('on', _drumSoundOn); }
};

function playDrumSound(drumType) {
  if (!_drumSoundOn) return;
  try {
    const c  = _getDrumCtx();
    const fn = _drumSounds[drumType] || _drumSounds.tom_m;
    fn(c.currentTime + 0.005, c);
  } catch(e) {}
}

// ═══════════════════════════════════════════════════════════════
//  TCP 궤적 렌더링
// ═══════════════════════════════════════════════════════════════
const TRAIL_MAX  = 48;   // 최대 저장 포인트 수
const TRAIL_UPD  = 55;   // ms 간격으로 갱신 (약 18fps)
const _trailData = {
  L: { pts: [], lastUpd: 0, color: 0x3a7ae0 },
  R: { pts: [], lastUpd: 0, color: 0xe04030 },
};
const _trailLines = { L: null, R: null };
let   _trailOn   = true;

window.toggleTCPTrail = function () {
  _trailOn = !_trailOn;
  const btn = document.getElementById('btn-trail');
  if (btn) btn.classList.toggle('on', _trailOn);
  if (!_trailOn) ['L','R'].forEach(arm => {
    if (_trailLines[arm]) { scene.remove(_trailLines[arm]); _trailLines[arm] = null; }
    _trailData[arm].pts = [];
  });
};

function updateTCPTrails() {
  if (!_trailOn || !isPlaying) return;
  const now = performance.now();
  ['L','R'].forEach(arm => {
    const td = _trailData[arm];
    if (now - td.lastUpd < TRAIL_UPD) return;
    td.lastUpd = now;

    const tcp = groups[`${arm}_tip`];   // 스틱 팁 궤적
    if (!tcp) return;
    const pos = new THREE.Vector3();
    tcp.getWorldPosition(pos);
    td.pts.push(pos.clone());
    if (td.pts.length > TRAIL_MAX) td.pts.shift();
    if (td.pts.length < 2) return;

    if (_trailLines[arm]) { scene.remove(_trailLines[arm]); _trailLines[arm].geometry.dispose(); }
    const geo = new THREE.BufferGeometry().setFromPoints(td.pts);
    const mat = new THREE.LineBasicMaterial({ color: td.color, transparent: true, opacity: 0.55 });
    _trailLines[arm] = new THREE.Line(geo, mat);
    _trailLines[arm].frustumCulled = false;
    scene.add(_trailLines[arm]);
  });
}

function clearTCPTrails() {
  ['L','R'].forEach(arm => {
    if (_trailLines[arm]) { scene.remove(_trailLines[arm]); _trailLines[arm] = null; }
    _trailData[arm].pts = [];
  });
}

// ── 드럼 구체 ────────────────────────────────────────────────
const drumSphereGroup = new THREE.Group();
sceneRoot.add(drumSphereGroup);
const drumMeshes = {};  // drumId → head mesh (레이캐스트·플래시용)
const drumGroups = {};  // drumId → Group (위치 이동용)

function rebuildDrumSpheres() {
  while (drumSphereGroup.children.length) drumSphereGroup.remove(drumSphereGroup.children[0]);
  Object.keys(drumMeshes).forEach(k => delete drumMeshes[k]);
  Object.keys(drumGroups).forEach(k => delete drumGroups[k]);

  drumKit.forEach(drum => {
    // ── 킥 드럼: 바닥에 눕혀진 베이스 드럼 (표시 전용) ──────
    if (drum.type === 'kick') {
      const grp = new THREE.Group();
      grp.position.set(drum.pos.x, drum.pos.y, drum.pos.z);
      drumSphereGroup.add(grp);
      drumGroups[drum.id] = grp;

      const col    = new THREE.Color(DRUM_TYPES.kick.color);
      // 킥은 낮고 컴팩트하게 — 탐 마운트 높이(0.38)와의 대비 강조, z=0.12 바닥 안착
      const kickR  = 0.12, kickD = 0.24;

      // 드럼 몸통 (축 = X방향)
      const bodyGeo = new THREE.CylinderGeometry(kickR, kickR, kickD, 32);
      const bodyMat = new THREE.MeshStandardMaterial({
        color: col, roughness: 0.60, metalness: 0.10, transparent: true, opacity: 0.70,
      });
      const body = new THREE.Mesh(bodyGeo, bodyMat);
      body.rotation.z = -Math.PI / 2;
      grp.add(body);

      // 앞면 드럼헤드 (robot 방향)
      const faceGeo = new THREE.CylinderGeometry(kickR * 0.97, kickR * 0.97, 0.012, 32);
      const faceMat = new THREE.MeshStandardMaterial({
        color: new THREE.Color('#cccccc'), roughness: 0.55, metalness: 0.05,
        transparent: true, opacity: 0.80,
      });
      const face = new THREE.Mesh(faceGeo, faceMat);
      face.rotation.z = -Math.PI / 2;
      face.position.x = -(kickD / 2 + 0.005);
      grp.add(face);
      return;
    }

    const typeInfo = DRUM_TYPES[drum.type];
    const col      = new THREE.Color(typeInfo.color);
    const isCymbal = ['crash', 'ride', 'hihat'].includes(drum.type);

    // 드럼별 그룹 (URDF 좌표에 배치)
    const grp = new THREE.Group();
    grp.position.set(drum.pos.x, drum.pos.y, drum.pos.z);
    drumSphereGroup.add(grp);
    drumGroups[drum.id] = grp;

    // 드럼 헤드 크기 — 실제 규격(인치 직경) 비율 반영, 씬 스케일 ≈ ×0.7
    const sizes = {
      //      [반지름, 두께]
      crash: [0.145, 0.008],   // 16" — 크래쉬
      ride:  [0.175, 0.008],   // 20" — 심벌 중 최대
      hihat: [0.100, 0.010],   // 13" — 심벌 중 최소 (크래쉬보다 확실히 작게)
      snare: [0.125, 0.055],   // 14" (얕은 셸)
      tom_h: [0.090, 0.055],   // 10" 스몰 탐 (탐 중 최소)
      tom_m: [0.105, 0.060],   // 12" 미들 탐
      tom_f: [0.140, 0.075],   // 16" 플로어 탐 (탐 중 최대·깊음)
    };
    const [r, h] = sizes[drum.type] || [0.10, 0.050];

    // 헤드 기울임 서브그룹 (스탠드는 수직 유지) — 타입 기본값, drum.tiltDeg로 오버라이드
    const tiltDeg = drum.tiltDeg ?? typeInfo.tilt ?? 0;
    const drumHead = new THREE.Group();
    if (tiltDeg) drumHead.rotation.y = -(tiltDeg * Math.PI / 180);

    // ── 헤드 (납작한 실린더) ─────────────────────────────────
    const headGeo = new THREE.CylinderGeometry(r, r, h, 32);
    const headMat = new THREE.MeshStandardMaterial({
      color: col,
      emissive: col.clone().multiplyScalar(0.20),
      emissiveIntensity: 0.20,
      roughness: isCymbal ? 0.22 : 0.60,
      metalness: isCymbal ? 0.78 : 0.12,
      transparent: true,
      opacity: 0.70,
    });
    const headMesh = new THREE.Mesh(headGeo, headMat);
    // URDF Z(위) 방향이 헤드 축이 되도록: 실린더 기본축(Y) → X축 PI/2 회전 → Z
    // 기울기는 drumHead 그룹의 tiltDeg가 담당 (심벌 하드코딩 0.15 제거)
    headMesh.rotation.x = Math.PI / 2;
    headMesh.castShadow = true;
    drumHead.add(headMesh);
    drumMeshes[drum.id] = headMesh;

    // ── 하이 햇: 아래 심벌 추가 (실제 2장 겹침 구조) ─────────
    if (drum.type === 'hihat') {
      const botMesh = new THREE.Mesh(headGeo.clone(), headMat.clone());
      botMesh.rotation.x = Math.PI / 2;
      botMesh.position.z = -0.022;
      botMesh.material.opacity = 0.50;
      drumHead.add(botMesh);
    }

    // ── 헤드 윗면 링 (타격 위치 표시) ────────────────────────
    const ringGeo = new THREE.RingGeometry(r * 0.35, r * 0.92, 32);
    const ringMat = new THREE.MeshBasicMaterial({
      color: col, side: THREE.DoubleSide, transparent: true, opacity: 0.30,
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    // RingGeometry는 기본으로 XY 평면(URDF 수평면)에 있어서 회전 불필요
    ring.position.z = h / 2 + 0.001;
    drumHead.add(ring);

    grp.add(drumHead);

    // ── 스탠드 (얇은 폴, 바닥 방향) ──────────────────────────
    const standH   = Math.max(0.05, drum.pos.z - 0.02);
    const standGeo = new THREE.CylinderGeometry(0.005, 0.008, standH, 8);
    const standMat = new THREE.MeshStandardMaterial({
      color: 0x2a2a3a, roughness: 0.9, transparent: true, opacity: 0.55,
    });
    const stand = new THREE.Mesh(standGeo, standMat);
    stand.rotation.x = Math.PI / 2;
    stand.position.z = -(standH / 2);
    grp.add(stand);

    // ── 베이스 플레이트 (스탠드 받침) ────────────────────────
    const baseGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.008, 16);
    const baseMat = new THREE.MeshStandardMaterial({
      color: 0x1a1a2a, roughness: 0.9, transparent: true, opacity: 0.50,
    });
    const base = new THREE.Mesh(baseGeo, baseMat);
    base.rotation.x = Math.PI / 2;
    base.position.z = -standH;
    grp.add(base);
  });
}

// ── 재생 상태 ────────────────────────────────────────────────
let isPlaying   = false;
let startWall   = 0, pauseOffset = 0;
let _playKFs    = { L: [], R: [], totalTime: 0 };
let _playDur    = 0;
let _flashState = {};

function smoothStep(t) { return t * t * (3 - 2 * t); }

// Catmull-Rom 스플라인: p1→p2 구간, p0/p3는 접선 계산용
// → 각 키프레임을 정확히 통과하면서 경유점에서 속도 연속성 유지
// → via-point에서 멈추지 않고 자연스럽게 통과 (관성 효과)
function catmullRom(t, p0, p1, p2, p3) {
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * (
    2*p1 +
    (-p0 + p2) * t +
    (2*p0 - 5*p1 + 4*p2 - p3) * t2 +
    (-p0 + 3*p1 - 3*p2 + p3) * t3
  );
}

function interpolateArm(t, kfs, keys) {
  const neutral = {};
  keys.forEach(k => { neutral[k] = 0; });
  if (!kfs.length) return neutral;
  if (kfs.length === 1) { const o = {}; keys.forEach(k => { o[k] = kfs[0].angles[k] ?? 0; }); return o; }

  let idx = kfs.length - 2;
  for (let i = 0; i < kfs.length - 1; i++) {
    if (kfs[i].time <= t && kfs[i+1].time >= t) { idx = i; break; }
  }
  const p1kf = kfs[idx], p2kf = kfs[idx + 1];
  if (p1kf.time === p2kf.time) { const o = {}; keys.forEach(k => { o[k] = p1kf.angles[k] ?? 0; }); return o; }

  // 경계: 첫/끝 키프레임은 같은 값으로 클램핑 → 시작·끝에서 자연스럽게 정지
  const p0kf = kfs[Math.max(0, idx - 1)];
  const p3kf = kfs[Math.min(kfs.length - 1, idx + 2)];
  const s = clamp((t - p1kf.time) / (p2kf.time - p1kf.time), 0, 1);
  const s2 = s*s, s3 = s2*s;
  const out = {};
  keys.forEach(k => {
    const a0 = p0kf.angles[k] ?? 0;
    const a1 = p1kf.angles[k] ?? 0;
    const a2 = p2kf.angles[k] ?? 0;
    const a3 = p3kf.angles[k] ?? 0;
    // strike 키프레임에서 접선=0 → 진입·출발 모두 속도 0 = 명확한 타격감
    // 일반 경유점은 CatmullRom 접선 유지 → 관성 있는 통과
    const m1 = p1kf.isStrike ? 0 : (a2 - a0) * 0.5;
    const m2 = p2kf.isStrike ? 0 : (a3 - a1) * 0.5;
    out[k] = (2*s3 - 3*s2 + 1)*a1 + (s3 - 2*s2 + s)*m1 + (-2*s3 + 3*s2)*a2 + (s3 - s2)*m2;
  });
  return out;
}

function interpolateAngles(t, kfs) {
  if (kfs.flat) return interpolateAnglesFlat(t, kfs.flat);   // intro/outro 통합 포맷
  const L_result = interpolateArm(t, kfs.L, ['L1','L2','L3','L4','L5','L6','L7']);
  const R_result = interpolateArm(t, kfs.R, ['R1','R2','R3','R4','R5','R6','R7']);
  return { ...L_result, ...R_result, L_grip: 0, R_grip: 0 };
}

// 양 팔 트랙을 YAML 내보내기용 단일 타임라인으로 병합
function buildMergedKeyframes() {
  const split = buildKeyframes();
  const timeSet = new Set();
  split.L.forEach(kf => timeSet.add(kf.time.toFixed(3)));
  split.R.forEach(kf => timeSet.add(kf.time.toFixed(3)));
  return Array.from(timeSet)
    .map(t => ({ time: parseFloat(t), angles: interpolateAngles(parseFloat(t), split) }))
    .sort((a, b) => a.time - b.time);
}

// ═══════════════════════════════════════════════════════════════
//  인트로·아웃트로 빌드 (재생·YAML 공통)
// ═══════════════════════════════════════════════════════════════

const _JOINT_KEYS14 = ['L1','L2','L3','L4','L5','L6','L7',
                       'R1','R2','R3','R4','R5','R6','R7'];

/** 배열 14개 → angles 객체 변환 */
function _arrToAngles(arr) {
  const obj = { L_grip: 0, R_grip: 0 };
  _JOINT_KEYS14.forEach((k, i) => { obj[k] = arr[i] ?? 0; });
  return obj;
}

/** 마지막 키프레임이 완전 0값(NEUTRAL)이면 제거 */
function removeHardResetPoint(tl) {
  if (tl.length <= 1) return tl;
  const last = tl[tl.length - 1];
  const isZero = _JOINT_KEYS14.every(k => Math.abs(last.angles[k] ?? 0) < 0.001);
  return isZero ? tl.slice(0, -1) : tl;
}

/** 너무 짧은 구간(< minInterval) 보정 — 컨트롤러 처리 불가 방지 */
function retimeTooShortIntervals(tl, minInterval = 0.030) {
  if (tl.length <= 1) return tl;
  const result = [{ ...tl[0] }];
  for (let i = 1; i < tl.length; i++) {
    const prev = result[result.length - 1];
    const curr = tl[i];
    const gap  = curr.time - prev.time;
    result.push(gap > 0 && gap < minInterval
      ? { ...curr, time: parseFloat((prev.time + minInterval).toFixed(4)) }
      : { ...curr });
  }
  return result;
}

/** 타임라인 전체 time에 offset 추가 */
function shiftTimeline(tl, offset) {
  return tl.map(kf => ({ ...kf, time: parseFloat((kf.time + offset).toFixed(4)) }));
}

/** 인트로 4초 타임라인 생성 */
/** frontReadyPose에서 J4(팔꿈치) 미세 굽힘 — "숨쉬기" 효과 */
function _breathePose(base, amp) {
  const v = { ...base };
  if (v.L4 !== undefined) v.L4 = parseFloat((v.L4 + amp).toFixed(4));
  if (v.R4 !== undefined) v.R4 = parseFloat((v.R4 + amp).toFixed(4));
  return v;
}

/**
 * 인트로 4초 — armSpreadPose 경유 (스틱 충돌 안전)
 *
 *  0.00s: neutral         — 시작
 *  1.30s: armSpreadPose   — 양팔 옆으로 최대 벌림 (충돌 없는 후퇴)
 *  2.75s: frontReadyPose  — 앞으로 들어오며 준비
 *  3.00s: frontReadyPose  — 홀드
 *  3.30s: breathe in (+0.04)
 *  3.70s: breathe out     — 정지
 *  4.00s: firstDrumPose   — ▶ 드럼 시작
 *
 *  smoothstep 보간: 각 구간이 S곡선으로 자연스럽게 연결됨
 */
function createDrumIntroTimeline(firstDrumPose, preset) {
  const nu = _arrToAngles(preset.neutralPose);
  const as = _arrToAngles(preset.armSpreadPose ?? preset.rearClearPose); // 하위 호환
  const fp = _arrToAngles(preset.frontReadyPose);

  // firstDrumPose 방향으로 이미 회전 + J4 상승 → "치고 올라온" 자세
  // t=3.85에서 팔이 spread-up 상태, t=4.00에서 내려치며 첫 박 시작
  const preLift = { ...firstDrumPose };
  Object.keys(preLift).forEach(k => {
    if (k.endsWith('4')) preLift[k] = clamp((preLift[k] ?? 0) + 0.58, 0.10, 1.70);
  });

  return [
    { time: 0.00, angles: nu                       },
    { time: 1.30, angles: as                       },  // 팔 양옆 벌림
    { time: 2.75, angles: fp                       },  // 앞으로 들어옴
    { time: 3.00, angles: fp                       },  // 홀드
    { time: 3.30, angles: _breathePose(fp, +0.04)  },  // 숨 들이쉬기
    { time: 3.70, angles: fp                       },  // 숨 내쉬기 → 정지
    { time: 3.85, angles: preLift                  },  // 첫 드럼 방향으로 올라간 자세
    { time: 4.00, angles: firstDrumPose            },  // ▶ 드럼 시작 (위에서 내려치기)
  ];
}

/**
 * 아웃트로 4초 — 인트로의 역순 미러링
 *
 *  +0.00s: lastDrumPose   — 마지막 드럼 자세
 *  +0.50s: frontReadyPose — 준비 자세 복귀
 *  +0.80s: breathe in
 *  +1.25s: frontReadyPose — 정지
 *  +2.70s: armSpreadPose  — 팔 양옆으로 벌리며 후퇴
 *  +4.00s: neutralPose    — 완전 복귀
 */
function createDrumOutroTimeline(lastDrumPose, preset, startTime) {
  const s  = startTime;
  const fp = _arrToAngles(preset.frontReadyPose);
  const as = _arrToAngles(preset.armSpreadPose ?? preset.rearClearPose); // 하위 호환
  const nu = _arrToAngles(preset.neutralPose);
  return [
    { time: s + 0.00, angles: lastDrumPose              },
    { time: s + 0.50, angles: fp                         },  // 준비 자세 복귀
    { time: s + 0.80, angles: _breathePose(fp, +0.04)   },  // 숨쉬기
    { time: s + 1.25, angles: fp                         },  // 정지
    { time: s + 2.70, angles: as                         },  // 팔 양옆 벌리며 후퇴
    { time: s + 4.00, angles: nu                         },  // 중립 복귀
  ];
}

/**
 * buildTimelineWithIntroOutro(options)
 * 재생·YAML 내보내기가 공유하는 최종 타임라인 생성
 */
function buildTimelineWithIntroOutro(options = {}) {
  const { includeIntro = true, includeOutro = true,
          introOutroPresetId = 'default' } = options;

  const preset = (typeof INTRO_OUTRO_PRESETS !== 'undefined'
    ? INTRO_OUTRO_PRESETS[introOutroPresetId]
    : null) ?? {
    neutralPose:    Array(14).fill(0),
    rearClearPose:  [0.90,0,0.04,1.80,0,0,-1.35,-1.10,0,-0.04,1.80,0,0,1.35],
    frontReadyPose: [-0.79,-0.04,0.01,1.54,0,0,-0.58,0.79,0.04,-0.01,1.54,0,0,0.58],
  };

  // 드럼 본편 (merged flat)
  let drumTL = buildMergedKeyframes();
  drumTL = removeHardResetPoint(drumTL);
  drumTL = retimeTooShortIntervals(drumTL, 0.030);

  let finalTL = [];

  if (includeIntro) {
    // firstPose: 첫 번째 '실제 드럼 동작' 포즈 (NEUTRAL 제외)
    // drumTL[0]은 보통 NEUTRAL(all 0) → 이걸 쓰면 frontReadyPose → NEUTRAL로 팔이 내려가는 문제 발생
    const firstNonNeutral = drumTL.find(kf =>
      _JOINT_KEYS14.some(k => Math.abs(kf.angles[k] ?? 0) > 0.01)
    );
    const firstPose = firstNonNeutral?.angles ?? _arrToAngles(preset.frontReadyPose);

    const intro   = createDrumIntroTimeline(firstPose, preset);
    const shifted = shiftTimeline(drumTL, 4.0);
    // shifted[0] = NEUTRAL at t=4.0 → intro 마지막이 firstPose로 대체하므로 제거(slice(1))
    finalTL = [...intro, ...shifted.slice(1)];
  } else {
    finalTL = [...drumTL];
  }

  if (includeOutro) {
    const lastPose = finalTL.length ? finalTL[finalTL.length - 1].angles
                                    : _arrToAngles(preset.neutralPose);
    const lastTime = finalTL.length ? finalTL[finalTL.length - 1].time : 0;
    const outro    = createDrumOutroTimeline(lastPose, preset, lastTime);
    // outro 첫 번째 == finalTL 마지막 → 중복 제거
    finalTL = [...finalTL, ...outro.slice(1)];
  }

  return finalTL;
}

/** 재생·YAML 모두에 쓰이는 "flat 타임라인" 반환 */
function buildFinalFlatTimeline() {
  const inclIntro = document.getElementById('chk-intro')?.checked ?? true;
  const inclOutro = document.getElementById('chk-outro')?.checked ?? true;
  return (inclIntro || inclOutro)
    ? buildTimelineWithIntroOutro({ includeIntro: inclIntro, includeOutro: inclOutro })
    : buildMergedKeyframes();
}

/** playAnim 등에서 사용하는 _playKFs 포맷 반환
 *  - intro/outro 없음 : { L, R, totalTime }  (기존 분리 트랙)
 *  - intro/outro 있음 : { flat, totalTime }  (통합 flat 트랙)
 */
function buildFinalKeyframes() {
  const inclIntro = document.getElementById('chk-intro')?.checked ?? true;
  const inclOutro = document.getElementById('chk-outro')?.checked ?? true;
  if (!inclIntro && !inclOutro) return buildKeyframes();
  const flat = buildFinalFlatTimeline();
  return { flat, totalTime: flat.length ? flat[flat.length - 1].time : 0 };
}

/** flat 타임라인 보간 (인트로/아웃트로용) */
function interpolateAnglesFlat(t, flatKfs) {
  if (!flatKfs.length) return { ...NEUTRAL };
  if (flatKfs.length === 1) return { ...flatKfs[0].angles, L_grip: 0, R_grip: 0 };

  let idx = flatKfs.length - 2;
  for (let i = 0; i < flatKfs.length - 1; i++) {
    if (flatKfs[i].time <= t && flatKfs[i + 1].time >= t) { idx = i; break; }
  }
  const p1kf = flatKfs[idx], p2kf = flatKfs[idx + 1];
  if (p1kf.time === p2kf.time) return { ...p1kf.angles, L_grip: 0, R_grip: 0 };

  const s = clamp((t - p1kf.time) / (p2kf.time - p1kf.time), 0, 1);
  const ss = smoothStep(s);
  const out = { L_grip: 0, R_grip: 0 };
  _JOINT_KEYS14.forEach(k => {
    const a1 = p1kf.angles[k] ?? 0;
    const a2 = p2kf.angles[k] ?? 0;
    out[k] = a1 + (a2 - a1) * ss;
  });
  return out;
}

window.playAnim = function () {
  _playKFs = buildFinalKeyframes();
  _playDur = _playKFs.totalTime;
  if (!timelineEvents.length) { alert('타임라인에 드럼 이벤트를 추가하세요.'); return; }
  document.getElementById('scrubber').max = _playDur;
  startWall = performance.now() - pauseOffset * 1000;
  isPlaying = true;
  _playAudio(pauseOffset);
  _syncPlayBtns();
};
window.pauseAnim = function () {
  if (!isPlaying) return;
  pauseOffset = ((performance.now() - startWall) / 1000) % _playDur;
  isPlaying   = false;
  _pauseAudio();
  _syncPlayBtns();
};
window.stopAnim = function () {
  isPlaying   = false;
  pauseOffset = 0;
  _stopAudio();
  clearTCPTrails();
  document.getElementById('scrubber').value = 0;
  updateFK({ ...NEUTRAL });
  updateTimeLbl(0);
  _syncPlayBtns();
  _updatePlayhead(0);
};
function _syncPlayBtns() {
  document.getElementById('btn-play') ?.classList.toggle('on', isPlaying);
  document.getElementById('btn-pause')?.classList.toggle('on', !isPlaying && pauseOffset > 0);
}
function updateTimeLbl(t) {
  document.getElementById('time-lbl').textContent = `${t.toFixed(2)} / ${_playDur.toFixed(1)} s`;
}

document.getElementById('scrubber').addEventListener('input', function () {
  const t = parseFloat(this.value);
  pauseOffset = t;
  if (!(_playKFs.L?.length ?? _playKFs.flat?.length)) {
    _playKFs = buildFinalKeyframes();
    _playDur = _playKFs.totalTime;
    this.max = _playDur;
  }
  // 재생 중 seek: startWall을 새 위치 기준으로 재계산 → 애니메이션 루프가 덮어쓰지 않음
  if (isPlaying) startWall = performance.now() - t * 1000;
  updateFK(interpolateAngles(t, _playKFs));
  updateTimeLbl(t);
  _updatePlayhead(t);
  if (isPlaying) _playAudio(t);
  else _audioPlayOff = t;
});

function _updatePlayhead(t) {
  const ph = document.getElementById('tl-playhead');
  if (!ph || !_playDur) return;
  const totalW = totalBars * beatsPerBar * PX_PER_BEAT;

  // 인트로/아웃트로가 있을 때 재생헤드는 드럼 섹션 기준 시간으로 계산
  // → 인트로 구간(0~introDur): 재생헤드 t=0에 고정
  // → 드럼 구간: 정상 이동
  // → 아웃트로 구간: totalW에 고정
  const introDur = _getAudioTimeOffset();
  const outroDur = (document.getElementById('chk-outro')?.checked ?? true) ? 4.0 : 0.0;
  const drumDur  = Math.max(0.01, _playDur - introDur - outroDur);
  const drumT    = t - introDur;

  const x = drumT <= 0
    ? 0
    : Math.min(totalW, (drumT / drumDur) * totalW);

  ph.style.left = x.toFixed(1) + 'px';
}

// ── 메인 애니메이션 루프 ─────────────────────────────────────
function animate() {
  requestAnimationFrame(animate);
  orbit.update();

  let t = pauseOffset;
  if (isPlaying && _playDur > 0) {
    t = ((performance.now() - startWall) / 1000) % _playDur;
    pauseOffset = t;
    document.getElementById('scrubber').value = t;
    updateTimeLbl(t);
    _updatePlayhead(t);

    const beatDur   = 60 / bpm;
    const introOff  = _getAudioTimeOffset(); // 인트로 ON → 4.0s, OFF → 0
    timelineEvents.forEach(evt => {
      const drum = drumKit.find(d => d.id === evt.drumId);
      if (!drum) return;
      const hitT    = (evt.beat - 1) * beatDur + introOff; // ← 인트로 오프셋 반영
      const typeInfo = DRUM_TYPES[drum.type];
      const inHit   = t >= hitT && t < hitT + (typeInfo?.rebDur || 0.1);
      const key     = `${evt.drumId}_${evt.beat}`;
      const mesh    = drumMeshes[evt.drumId];
      if (!mesh) return;
      if (inHit && !_flashState[key]) {
        _flashState[key] = true;
        mesh.material.emissiveIntensity = 1.8;
        mesh.scale.setScalar(1.25);
        document.querySelectorAll(`.tl-hit[data-key="${key}"]`).forEach(h => h.classList.add('flash'));
        playDrumSound(drum.type);   // ← 드럼 사운드 트리거
      } else if (!inHit && _flashState[key]) {
        _flashState[key] = false;
        mesh.material.emissiveIntensity = 0.22;
        mesh.scale.setScalar(1.0);
        document.querySelectorAll(`.tl-hit[data-key="${key}"]`).forEach(h => h.classList.remove('flash'));
      }
    });
  }

  // 미리보기 애니메이션 중엔 메인 루프 FK 업데이트 스킵 (덮어쓰기 방지)
  if (!window._drumPreviewActive) {
    updateFK(interpolateAngles(t, _playKFs));
  }

  updateTCPTrails();   // ← TCP 궤적 갱신

  const cvs = renderer.domElement;
  const w   = viewport.clientWidth;
  const h   = Math.max(1, viewport.clientHeight - 40);
  if (cvs.width !== Math.round(w * renderer.getPixelRatio())) {
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  renderer.render(scene, camera);
}
animate();

// ═══════════════════════════════════════════════════════════════
//  오디오 (Web Audio API)
// ═══════════════════════════════════════════════════════════════
window.loadAudioFile = function (input) {
  const file = input.files[0];
  if (!file) return;
  if (!_audioCtx) _audioCtx = new AudioContext();
  const reader = new FileReader();
  reader.onload = async e => {
    try {
      _audioBuf = await _audioCtx.decodeAudioData(e.target.result.slice(0));
      const nameEl = document.getElementById('audio-name');
      if (nameEl) nameEl.textContent = file.name;
      setStatus(`음악 로드: ${file.name} (${_audioBuf.duration.toFixed(1)}s)`);
    } catch (err) {
      setStatus('오디오 디코드 실패: ' + err.message);
    }
  };
  reader.readAsArrayBuffer(file);
};

/** 인트로 구간(0 ~ introDur) 동안 음악 재생을 지연시키는 오디오 오프셋 */
function _getAudioTimeOffset() {
  const inclIntro = document.getElementById('chk-intro')?.checked ?? true;
  return inclIntro ? 4.0 : 0.0;
}

function _playAudio(timelineOffset) {
  if (!_audioCtx || !_audioBuf) return;
  _stopAudio();
  if (_audioCtx.state === 'suspended') _audioCtx.resume();

  const audioStart = _getAudioTimeOffset();
  // 인트로 구간이면 시작 지연, 이미 지난 경우 파일 내 해당 위치부터 즉시 재생
  const audioFilePos = Math.max(0, timelineOffset - audioStart);
  const startDelay   = Math.max(0, audioStart - timelineOffset);

  _audioSrc = _audioCtx.createBufferSource();
  _audioSrc.buffer = _audioBuf;
  _audioSrc.connect(_audioCtx.destination);
  _audioPlayOff   = clamp(audioFilePos, 0, _audioBuf.duration);
  _audioStartCtxT = _audioCtx.currentTime + startDelay;
  _audioSrc.start(_audioCtx.currentTime + startDelay, _audioPlayOff);
}

function _pauseAudio() {
  if (_audioCtx) _audioCtx.suspend();
}

function _stopAudio() {
  if (_audioSrc) { try { _audioSrc.stop(); } catch(e){} _audioSrc = null; }
  if (_audioCtx && _audioCtx.state === 'suspended') _audioCtx.resume().catch(() => {});
}

// ═══════════════════════════════════════════════════════════════
//  드럼 3D 드래그
//  좌클릭 드래그 → 드럼을 수평면(XY URDF)에서 이동
//  URDF 좌표 ↔ Three.js 세계 좌표 변환:
//    world(x, y, z) = URDF(x, z, -y)  [sceneRoot.rotation.x = -PI/2]
// ═══════════════════════════════════════════════════════════════
const _rc        = new THREE.Raycaster();
const _rcMouse   = new THREE.Vector2();
const _dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const _dragPt    = new THREE.Vector3();
let _dragDrumId  = null;
let _dragOffX    = 0, _dragOffZ = 0;
let _isDragging  = false;

renderer.domElement.addEventListener('mousedown', e => {
  if (e.button !== 0) return;
  const rect = renderer.domElement.getBoundingClientRect();
  _rcMouse.x = ((e.clientX - rect.left) / rect.width)  *  2 - 1;
  _rcMouse.y = ((e.clientY - rect.top)  / rect.height) * -2 + 1;
  _rc.setFromCamera(_rcMouse, camera);

  const meshList = Object.values(drumMeshes);
  if (!meshList.length) return;
  const hits = _rc.intersectObjects(meshList, false);
  if (!hits.length) return;

  const hitMesh = hits[0].object;
  const drumId  = Object.keys(drumMeshes).find(k => drumMeshes[k] === hitMesh);
  if (!drumId) return;

  const drum = drumKit.find(d => d.id === drumId);
  if (!drum) return;

  _dragDrumId      = drumId;
  _isDragging      = true;
  orbit.enabled    = false;

  // 수평 드래그 평면: Three.js 세계 Y = URDF Z 높이
  _dragPlane.constant = -drum.pos.z;
  _rc.ray.intersectPlane(_dragPlane, _dragPt);
  // 클릭 위치와 드럼 위치의 오프셋 보존
  _dragOffX = drum.pos.x - _dragPt.x;
  _dragOffZ = drum.pos.y + _dragPt.z;  // URDF y = -world_z

  renderer.domElement.style.cursor = 'grabbing';
  e.preventDefault();
});

renderer.domElement.addEventListener('mousemove', e => {
  const rect = renderer.domElement.getBoundingClientRect();
  _rcMouse.x = ((e.clientX - rect.left) / rect.width)  *  2 - 1;
  _rcMouse.y = ((e.clientY - rect.top)  / rect.height) * -2 + 1;

  if (_isDragging && _dragDrumId) {
    _rc.setFromCamera(_rcMouse, camera);
    if (!_rc.ray.intersectPlane(_dragPlane, _dragPt)) return;

    const drum = drumKit.find(d => d.id === _dragDrumId);
    if (!drum) return;

    drum.pos.x = parseFloat((_dragPt.x + _dragOffX).toFixed(3));
    drum.pos.y = parseFloat((-_dragPt.z + _dragOffZ).toFixed(3));

    const grp = drumGroups[_dragDrumId];
    if (grp) grp.position.set(drum.pos.x, drum.pos.y, drum.pos.z);

    // 패널 숫자 입력 즉시 반영
    const item = document.querySelector(`.drum-item[data-id="${drum.id}"]`);
    if (item) {
      const inps = item.querySelectorAll('.drum-pos-inp');
      if (inps[0]) inps[0].value = drum.pos.x.toFixed(2);
      if (inps[1]) inps[1].value = drum.pos.y.toFixed(2);
    }
  } else {
    // 호버 커서
    _rc.setFromCamera(_rcMouse, camera);
    const meshList = Object.values(drumMeshes);
    const hits = meshList.length ? _rc.intersectObjects(meshList, false) : [];
    renderer.domElement.style.cursor = hits.length ? 'grab' : '';
  }
});

renderer.domElement.addEventListener('mouseup', () => {
  if (_isDragging) {
    _isDragging   = false;
    orbit.enabled = true;
    renderer.domElement.style.cursor = '';
    // 드래그 후 reach badge 갱신 + 키프레임 재빌드
    saveDrumKit();
    renderDrumList();
    _playKFs = buildFinalKeyframes();
    _playDur = _playKFs.totalTime;
    _dragDrumId = null;
  }
});

renderer.domElement.addEventListener('mouseleave', () => {
  if (_isDragging) {
    _isDragging   = false;
    orbit.enabled = true;
    renderer.domElement.style.cursor = '';
    _dragDrumId   = null;
  }
});

// ═══════════════════════════════════════════════════════════════
//  타임라인 렌더링 (피아노 롤)
// ═══════════════════════════════════════════════════════════════
function renderTimeline() {
  updatePxPerBeat();
  const totalBeats = totalBars * beatsPerBar;
  const totalW     = totalBeats * PX_PER_BEAT;
  const div        = parseInt(document.getElementById('grid-sel')?.value || 8);

  const labelsEl = document.getElementById('tl-lane-labels');
  let lblHtml = '<div class="tl-lbl-ruler"></div>';
  drumKit.forEach(drum => {
    const col = DRUM_TYPES[drum.type]?.color || '#888';
    lblHtml += `<div class="tl-label" style="color:${col}" title="${drum.name}">${drum.name}</div>`;
  });
  labelsEl.innerHTML = lblHtml;

  // ── 초(seconds) 루러 행 ──────────────────────────────────────
  const beatDurSec = 60 / bpm;
  const secRulerEl = document.getElementById('tl-ruler-sec');
  secRulerEl.style.width = totalW + 'px';
  let secHtml = '';
  for (let bar = 0; bar < totalBars; bar++) {
    for (let beat = 0; beat < beatsPerBar; beat++) {
      const bi  = bar * beatsPerBar + beat;
      const x   = bi * PX_PER_BEAT;
      const sec = (bi * beatDurSec).toFixed(beat === 0 ? 1 : 2);
      // 마디 시작 + 각 박자마다 초 표시
      const sCls = beat === 0 ? 'ruler-sec ruler-sec-bar' : 'ruler-sec';
      secHtml += `<span class="${sCls}" style="left:${x}px">${sec}s</span>`;
    }
  }
  // 마지막 끝 시간
  const endSec = (totalBars * beatsPerBar * beatDurSec).toFixed(1);
  secHtml += `<span class="ruler-sec ruler-sec-bar" style="left:${totalW}px">${endSec}s</span>`;
  secRulerEl.innerHTML = secHtml;

  // ── 마디·박자 루러 행 ─────────────────────────────────────────
  const rulerEl = document.getElementById('tl-ruler');
  rulerEl.style.width = totalW + 'px';
  const SUB_LABELS = {
    2: ['+'],
    4: ['e', '+', 'a'],
    8: ['', '', '', '+', '', '', ''],
  };
  let rulerHtml = '';
  for (let bar = 0; bar < totalBars; bar++) {
    for (let beat = 0; beat < beatsPerBar; beat++) {
      const bi  = bar * beatsPerBar + beat;
      const x   = bi * PX_PER_BEAT;
      const cls = beat === 0 ? 'ruler-bar' : 'ruler-beat';
      const lbl = beat === 0 ? `${bar+1}` : `.${beat+1}`;
      rulerHtml += `<span class="ruler-mark ${cls}" style="left:${x}px">${lbl}</span>`;

      const subCount = div / 4;
      if (subCount > 1) {
        const subLbls = SUB_LABELS[subCount] || [];
        for (let sub = 1; sub < subCount; sub++) {
          const sx  = x + (sub / subCount) * PX_PER_BEAT;
          const txt = subLbls[sub - 1] || '';
          const sc  = (subCount <= 4 && sub === subCount / 2) ? 'ruler-sub-strong' : 'ruler-sub';
          rulerHtml += `<span class="ruler-mark ${sc}" style="left:${sx}px">${txt}</span>`;
        }
      }
    }
  }
  rulerEl.innerHTML = rulerHtml;

  const lanesEl = document.getElementById('tl-lanes');
  lanesEl.style.width = totalW + 'px';
  lanesEl.innerHTML   = '';

  drumKit.forEach(drum => {
    const lane = document.createElement('div');
    lane.className       = 'tl-lane';
    lane.style.width     = totalW + 'px';
    lane.dataset.drumId  = drum.id;
    const typeInfo = DRUM_TYPES[drum.type] || DRUM_TYPES.snare;

    for (let bar = 0; bar < totalBars; bar++) {
      for (let beat = 0; beat < beatsPerBar; beat++) {
        const bi = bar * beatsPerBar + beat;
        const x  = bi * PX_PER_BEAT;
        const line = document.createElement('div');
        line.className = 'tl-grid-line ' + (beat === 0 ? 'bar' : 'beat');
        line.style.left = x + 'px';
        lane.appendChild(line);

        const subCount = div / 4;
        for (let sub = 1; sub < subCount; sub++) {
          const sx = x + (sub / subCount) * PX_PER_BEAT;
          const sl = document.createElement('div');
          sl.className = 'tl-grid-line';
          sl.style.left    = sx + 'px';
          sl.style.opacity = '0.35';
          lane.appendChild(sl);
        }
      }
    }

    timelineEvents.filter(e => e.drumId === drum.id).forEach(evt => {
      const vel = evt.vel ?? 'medium';
      const x   = (evt.beat - 1) * PX_PER_BEAT;
      const hit = document.createElement('div');
      hit.className      = `tl-hit vel-${vel}`;
      hit.dataset.vel    = vel;
      hit.dataset.key    = `${drum.id}_${evt.beat}`;
      hit.style.left     = x + 'px';
      hit.style.background  = typeInfo.color;
      hit.style.boxShadow   = VEL_GLOW[vel](typeInfo.color);
      const velLabel = { soft:'약', medium:'중', hard:'강' }[vel];
      hit.title = `${drum.name} — beat ${evt.beat.toFixed(2)} [${velLabel}]  (클릭: 강도 변경 / 우클릭: 삭제)`;
      hit.addEventListener('click',       e => { e.stopPropagation(); applyVel(drum.id, evt.beat); });
      hit.addEventListener('contextmenu', e => { e.preventDefault(); e.stopPropagation(); removeEvent(drum.id, evt.beat); });
      lane.appendChild(hit);
    });

    lane.addEventListener('click', e => {
      if (e.target.classList.contains('tl-hit')) return;
      const rect    = lane.getBoundingClientRect();
      const scrollL = document.getElementById('tl-scroll')?.scrollLeft || 0;
      const rawX    = e.clientX - rect.left + scrollL;
      let beat      = rawX / PX_PER_BEAT + 1;

      if (document.getElementById('chk-snap')?.checked) {
        const snapUnit = 4 / div;
        beat = Math.round(beat / snapUnit) * snapUnit;
      }
      beat = parseFloat(clamp(beat, 1, totalBeats + 1).toFixed(4));
      addEvent(drum.id, beat);
    });

    lanesEl.appendChild(lane);
  });

  const ph = document.createElement('div');
  ph.id = 'tl-playhead';
  lanesEl.appendChild(ph);
  _updatePlayhead(pauseOffset);
}

function addEvent(drumId, beat) {
  // ── 토글: 같은 드럼 같은 박자 → 제거
  const sameIdx = timelineEvents.findIndex(e => e.drumId === drumId && Math.abs(e.beat - beat) < 0.01);
  if (sameIdx >= 0) {
    timelineEvents.splice(sameIdx, 1);
    _commitTimeline();
    return;
  }

  const drum = drumKit.find(d => d.id === drumId);

  // 킥은 팔 충돌 없음
  if (!drum || drum.type === 'kick') {
    timelineEvents.push({ drumId, beat, vel: defaultVel });
    _commitTimeline();
    return;
  }

  // ── 규칙 1: 동일 팔이 같은 박자에 이미 있으면 배치 불가
  const sameArmConflict = timelineEvents.find(e => {
    if (Math.abs(e.beat - beat) >= 0.01) return false;
    const ed = drumKit.find(d => d.id === e.drumId);
    return ed && ed.arm === drum.arm && ed.type !== 'kick';
  });

  if (sameArmConflict) {
    const armKr    = drum.arm === 'L' ? '왼팔' : '오른팔';
    const otherArm = drum.arm === 'L' ? 'R' : 'L';
    const otherKr  = drum.arm === 'L' ? '오른팔' : '왼팔';
    // 반대팔로 이 드럼을 칠 수 있는지 체크
    const distOther = reachDist({ ...drum, arm: otherArm });
    const hint = distOther <= STICK_REACH
      ? ` — ${otherKr}은 도달 가능(${distOther.toFixed(2)}m)하니 드럼 설정에서 팔을 바꿔보세요`
      : ` (${otherKr}도 도달 불가 ${distOther.toFixed(2)}m)`;
    setStatus(`❌ beat ${beat.toFixed(2)}: ${armKr}은 이미 이 박자에 다른 드럼을 칩니다${hint}`);
    return;
  }

  // ── 규칙 2: 동일 타이밍에 양팔이 모두 배정됐으면 3번째 불가
  const bothArmsUsed = ['L', 'R'].every(arm =>
    timelineEvents.some(e => {
      if (Math.abs(e.beat - beat) >= 0.01) return false;
      const ed = drumKit.find(d => d.id === e.drumId);
      return ed && ed.arm === arm && ed.type !== 'kick';
    })
  );
  if (bothArmsUsed) {
    setStatus(`❌ beat ${beat.toFixed(2)}: 동일 타이밍은 양팔 각 1개씩 최대 2개까지만 가능합니다`);
    return;
  }

  timelineEvents.push({ drumId, beat, vel: defaultVel });
  _commitTimeline();
}

function removeEvent(drumId, beat) {
  const idx = timelineEvents.findIndex(e => e.drumId === drumId && Math.abs(e.beat - beat) < 0.01);
  if (idx >= 0) {
    timelineEvents.splice(idx, 1);
    _commitTimeline();
  }
}

// 노트 클릭 시 현재 선택된 defaultVel로 즉시 적용
function applyVel(drumId, beat) {
  const evt = timelineEvents.find(e => e.drumId === drumId && Math.abs(e.beat - beat) < 0.01);
  if (!evt) return;
  evt.vel = defaultVel;
  _commitTimeline();
  if (!isPlaying) renderFrame(pauseOffset);
}

// 타임라인 상단 모드 버튼 클릭 핸들러
window.setDefaultVel = function (vel) {
  defaultVel = vel;
  ['soft','medium','hard'].forEach(v => {
    document.getElementById(`vel-mode-${v}`)?.classList.toggle('active', v === vel);
  });
};

// ═══════════════════════════════════════════════════════════════
//  드럼 타격 자세 실시간 미리보기
//  클릭 시: 중립 → raise → strike → rebound → 중립 애니메이션
//  setInterval 기반 — RAF 경쟁 타이밍 문제 없음
// ═══════════════════════════════════════════════════════════════
window._drumPreviewActive = false;
let _previewTimer = null;

window.previewDrumHit = function (drumId, vel = 'medium') {
  if (_previewTimer) { clearInterval(_previewTimer); _previewTimer = null; }
  window._drumPreviewActive = false;

  const drum = drumKit.find(d => d.id === drumId);
  if (!drum || drum.type === 'kick') {
    setStatus(`[${drum?.name || drumId}] 킥 드럼은 팔 동작이 없습니다`);
    return;
  }

  // 패널 선택 하이라이트 + 버튼 활성 표시
  document.querySelectorAll('.drum-item').forEach(el => el.classList.remove('drum-selected'));
  document.querySelector(`.drum-item[data-id="${drumId}"]`)?.classList.add('drum-selected');
  document.querySelectorAll('.dvp-btn').forEach(b => b.classList.remove('active'));
  document.querySelector(`.drum-item[data-id="${drumId}"] .dvp-${vel}`)?.classList.add('active');

  // 드럼 구체 플래시
  const mesh = drumMeshes[drumId];
  if (mesh) {
    mesh.material.emissiveIntensity = 2.0;
    mesh.scale.setScalar(1.3);
    setTimeout(() => { mesh.material.emissiveIntensity = 0.20; mesh.scale.setScalar(1.0); }, 180);
  }

  // TCP 경로: 강제 활성화 + 초기화 (강도별 궤적 비교용)
  if (!_trailOn) { _trailOn = true; document.getElementById('btn-trail')?.classList.add('on'); }
  clearTCPTrails();

  const velLabel = { soft:'약', medium:'중', hard:'강' }[vel];
  setStatus(`[${drum.name}] ${drum.arm === 'L' ? '왼팔' : '오른팔'} 미리보기 (${velLabel}) — 거리 ${reachDist(drum).toFixed(2)}m`);

  const phases = [
    { from: { ...NEUTRAL },                          to: computeStrikePose(drum, 'raise',   vel), dur: 0.14 },
    { from: computeStrikePose(drum, 'raise',   vel), to: computeStrikePose(drum, 'strike',  vel), dur: 0.09 },
    { from: computeStrikePose(drum, 'strike',  vel), to: computeStrikePose(drum, 'rebound', vel), dur: 0.09 },
    { from: computeStrikePose(drum, 'rebound', vel), to: { ...NEUTRAL },                          dur: 0.22 },
  ];

  let phaseIdx = 0;
  let phaseT0  = performance.now();
  window._drumPreviewActive = true;

  _previewTimer = setInterval(() => {
    if (phaseIdx >= phases.length) {
      clearInterval(_previewTimer);
      _previewTimer = null;
      window._drumPreviewActive = false;
      document.querySelector('.dvp-btn.active')?.classList.remove('active');
      updateFK({ ...NEUTRAL });
      return;
    }

    const { from, to, dur } = phases[phaseIdx];
    const elapsed = performance.now() - phaseT0;
    const t  = Math.min(1, elapsed / (dur * 1000));
    const st = smoothStep(t);

    const cur = { L_grip: 0, R_grip: 0 };
    ['L1','L2','L3','L4','L5','L6','L7','R1','R2','R3','R4','R5','R6','R7'].forEach(k => {
      cur[k] = (from[k] ?? 0) + ((to[k] ?? 0) - (from[k] ?? 0)) * st;
    });
    updateFK(cur);

    // TCP 궤적 실시간 기록 (throttle 바이패스)
    ['L','R'].forEach(arm => { _trailData[arm].lastUpd = 0; });
    const wasPlaying = isPlaying; isPlaying = true;
    updateTCPTrails();
    isPlaying = wasPlaying;

    if (t >= 1) { phaseIdx++; phaseT0 = performance.now(); }
  }, 16);
};

// ═══════════════════════════════════════════════════════════════
//  씬 팔레트 (배경·팔·몸체 컬러 변경)
// ═══════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════
//  씬 팔레트 프레셋
// ═══════════════════════════════════════════════════════════════
const SKIN_PRESETS = {
  default: { name:'기본 (블루·레드)',        bg:'#06060c', L:'#3a7ae0', R:'#e04030', body:'#4a6080', hand:'#7a8898' },
  cyber:   { name:'사이버펑크 (민트·마젠타)', bg:'#0d0720', L:'#00e87a', R:'#e000cc', body:'#1a0a30', hand:'#7733cc' },
  metal:   { name:'클래식 메탈 (실버)',       bg:'#101418', L:'#a8bac8', R:'#a8bac8', body:'#607080', hand:'#8898a8' },
  fire:    { name:'불꽃 (오렌지·레드)',       bg:'#0c0400', L:'#ff6600', R:'#ff2200', body:'#3a1200', hand:'#772200' },
  ocean:   { name:'오션 (블루·시안)',         bg:'#020c18', L:'#0077ff', R:'#00ccff', body:'#003366', hand:'#004488' },
  stealth: { name:'스텔스 (다크)',            bg:'#060608', L:'#334455', R:'#223344', body:'#151822', hand:'#1e2430' },
};

// 배경 색상 변경 시 색상 피커 동기화
window.syncBgPicker = function (hex) {
  const el = document.getElementById('pal-bg');
  if (el) el.value = hex;
};

// 스킨 프레셋 전체 적용 (배경 + 팔 + 몸체 + 손)
window.applySkinPreset = function (name) {
  const p = SKIN_PRESETS[name];
  if (!p) return;
  setSceneBg(p.bg);
  setArmColor('L', p.L);
  setArmColor('R', p.R);
  setBodyColor(p.body);
  setHandColor(p.hand);
  const sync = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
  sync('pal-bg',    p.bg);
  sync('pal-arm-l', p.L);
  sync('pal-arm-r', p.R);
  sync('pal-body',  p.body);
  sync('pal-hand',  p.hand);
  setStatus(`스킨 프레셋 적용: ${p.name}`);
};

window.togglePalette = function () {
  document.getElementById('pal-popup')?.classList.toggle('open');
};

// 팔레트 팝업 외부 클릭 시 닫기
document.addEventListener('click', e => {
  const btn   = document.getElementById('pal-toggle-btn');
  const popup = document.getElementById('pal-popup');
  if (popup && popup.classList.contains('open') &&
      !popup.contains(e.target) && e.target !== btn) {
    popup.classList.remove('open');
  }
});

// 프리셋 버튼을 SKIN_PRESETS 데이터에서 동적 생성
function renderSkinPresets() {
  const container = document.getElementById('skin-presets-container');
  if (!container) return;
  container.innerHTML = Object.entries(SKIN_PRESETS).map(([key, p]) =>
    `<button class="preset-skin" title="${p.name}"
      style="background:linear-gradient(135deg,${p.L} 50%,${p.R} 50%)"
      onclick="applySkinPreset('${key}')"></button>`
  ).join('');
}

window.setSceneBg = function (hexStr) {
  const col = new THREE.Color(hexStr);
  scene.background = col;
  const bright = (col.r + col.g + col.b) / 3;
  scene.fog = new THREE.FogExp2(col.getHex(), bright > 0.5 ? 0.04 : 0.08);
};

window.setArmColor = function (side, hexStr) {
  const col = new THREE.Color(hexStr);
  sceneRoot.traverse(child => {
    if (!child.isMesh || !child.parent) return;
    const n = child.parent.name;
    if (!n) return;
    const isArm = n.startsWith(side) &&
      !n.includes('_hand') && !n.includes('_fR') &&
      !n.includes('_fL')   && !n.includes('_tcp');
    if (isArm) child.material.color.set(col);
  });
};

window.setHandColor = function (hexStr) {
  const col = new THREE.Color(hexStr);
  sceneRoot.traverse(child => {
    if (!child.isMesh || !child.parent) return;
    const n = child.parent.name;
    if (n && (n.includes('_hand') || n.includes('_fR') || n.includes('_fL')))
      child.material.color.set(col);
  });
};

window.setBodyColor = function (hexStr) {
  const col = new THREE.Color(hexStr);
  const g = groups['body'];
  if (g) g.traverse(c => { if (c.isMesh) c.material.color.set(col); });
};

window.clearTimeline = function () {
  timelineEvents = [];
  stopAnim();
  renderTimeline();
  saveTimeline();
  setStatus('타임라인 초기화됨');
};

// ═══════════════════════════════════════════════════════════════
//  타임라인 자동 생성 (역동적 패턴)
// ═══════════════════════════════════════════════════════════════
window.autoGeneratePattern = function () {
  timelineEvents = [];

  const bpb      = beatsPerBar;
  const beatDurS = 60 / bpm;
  const minGap   = 0.055 / beatDurS;
  const totalB   = totalBars * bpb;

  function safeAdd(drumId, beat) {
    if (!drumId) return false;
    const drum = drumKit.find(d => d.id === drumId);
    if (!drum || drum.type === 'kick') return false;
    const bk = parseFloat(beat.toFixed(3));
    if (bk < 1 || bk > totalB) return false;
    if (timelineEvents.some(e => {
      const ed = drumKit.find(d => d.id === e.drumId);
      return ed?.arm === drum.arm && Math.abs(e.beat - bk) < 0.01;
    })) return false;
    if (['L','R'].every(arm => timelineEvents.some(e => {
      const ed = drumKit.find(d => d.id === e.drumId);
      return ed?.arm === arm && Math.abs(e.beat - bk) < 0.01;
    }))) return false;
    if (timelineEvents.some(e => {
      const ed = drumKit.find(d => d.id === e.drumId);
      const g = Math.abs(e.beat - bk);
      return ed?.arm === drum.arm && g > 0.001 && g < minGap;
    })) return false;
    timelineEvents.push({ drumId, beat: bk, vel: 'medium' });
    return true;
  }

  const coin = p => Math.random() < (p ?? 0.5);

  // ── 현재 드럼킷 전체 배열 (팔별) ─────────────────────────────────
  const Ld = drumKit.filter(d => d.arm === 'L' && d.type !== 'kick');
  const Rd = drumKit.filter(d => d.arm === 'R' && d.type !== 'kick');
  if (!Ld.length && !Rd.length) return;

  // 순환 인덱스: 마디·박자 조합으로 드럼 골고루 사용
  const lcyc = (offset) => Ld.length ? Ld[((offset) % Ld.length + Ld.length) % Ld.length].id : null;
  const rcyc = (offset) => Rd.length ? Rd[((offset) % Rd.length + Rd.length) % Rd.length].id : null;

  // ── 역할별 드럼 참조 (기본 배치: L=하이햇·크래쉬·스네어·스몰탐, R=미들탐·플로어탐·라이드) ──
  // 스네어가 L팔에 있으므로 백비트도 L팔이 담당한다. R팔 백비트는 라이드가
  // 타임키핑에 적합해 우선 사용(과거엔 R에 스네어가 있다고 가정해 항상 못 찾고
  // 미들탐으로 대체되던 버그가 있었음 — 실물 테스트 시 부자연스러운 원인이었음).
  const Lhihat = Ld.find(d => d.type === 'hihat')?.id;
  const Lsnare = Ld.find(d => d.type === 'snare')?.id;
  const Lcrash = Ld.find(d => d.type === 'crash')?.id;
  const Ltom   = Ld.find(d => d.type === 'tom_h')?.id;
  const Rride  = Rd.find(d => d.type === 'ride')?.id;

  const Rback = Rride ?? Rd[0]?.id;
  const subR  = Rd.find(d => d.id !== Rback)?.id ?? Rback;

  const backOff = bpb >= 4 ? [1, bpb - 1] : [Math.floor(bpb / 2)];
  const isFill  = bar => (bar + 1) % 4 === 0;

  // ── 스타일 7종 ─────────────────────────────────────────────────
  // 핵심 규칙:
  //  ① 같은 마디 L팔은 하나의 드럼만 (팔 순간이동 방지)
  //  ② R팔 기본 드럼(Rback)은 backOff 위치에 항상 (박자감 유지)
  //  ③ 드럼 교체는 마디 단위 — 8분도 같은 드럼 사용
  //  ④ 필(4마디마다): 마지막 박자에 L·R 각 1개 다른 드럼 추가
  //  ⑤ 생성이 끝나면 하단 커버리지 보장 로직이 킥을 제외한 7개 드럼 중
  //     사용되지 않은 드럼을 찾아 자동으로 채워 넣는다(실물 테스트 목적)

  const STYLES = [
    {
      // 4분 그루브 — 2마디마다 L드럼 교체 (2~3드럼)
      name: '4분 그루브',
      gen(bs, bar) {
        backOff.forEach(b => safeAdd(Rback, bs + b));
        const mL = lcyc(Math.floor(bar / 2));          // 2마디마다 교체
        for (let b = 0; b < bpb; b++) safeAdd(mL, bs + b);
        if (isFill(bar)) {
          safeAdd(lcyc(Math.floor(bar / 2) + 1), bs + bpb - 1);
          if (subR) safeAdd(subR, bs + bpb - 1);
        }
      },
    },

    {
      // 탐 백비트 — L탐 1+3박, 마디마다 교체 (2~3드럼)
      name: '탐 백비트',
      gen(bs, bar) {
        backOff.forEach(b => safeAdd(Rback, bs + b));
        const mL = lcyc(bar);                           // 마디마다 L드럼 교체
        [0, 2].filter(b => b < bpb).forEach(b => safeAdd(mL, bs + b));
        // 홀수 마디: R 서브드럼 1박 추가 (3드럼)
        if (bar % 2 === 1 && subR)
          [0, 2].filter(b => !backOff.includes(b)).forEach(b => safeAdd(subR, bs + b));
        if (isFill(bar)) {
          safeAdd(lcyc(bar + 1), bs + bpb - 2);
          safeAdd(lcyc(bar + 2), bs + bpb - 1);
        }
      },
    },

    {
      // 8비트 일관 — L 한 드럼으로 8분, 2마디마다 교체 (3드럼)
      name: '8비트 일관',
      gen(bs, bar) {
        backOff.forEach(b => safeAdd(Rback, bs + b));
        const mL = lcyc(Math.floor(bar / 2));
        for (let b = 0; b < bpb; b++) {
          safeAdd(mL, bs + b);
          safeAdd(mL, bs + b + 0.5);                   // 같은 드럼 → 팔 안 튐
        }
        // 1+3박에 R 서브드럼 (3드럼)
        if (subR)
          [0, 2].filter(b => !backOff.includes(b)).forEach(b => safeAdd(subR, bs + b));
        if (isFill(bar)) {
          safeAdd(lcyc(Math.floor(bar / 2) + 1), bs + bpb - 1);
        }
      },
    },

    {
      // 교차 그루브 — 짝수/홀수 마디 다른 L드럼, R도 변화 (3~4드럼)
      name: '교차 그루브',
      gen(bs, bar) {
        backOff.forEach(b => safeAdd(Rback, bs + b));
        const mL = lcyc(bar % 2 === 0 ? 0 : 1);       // 짝/홀 교차
        for (let b = 0; b < bpb; b++) safeAdd(mL, bs + b);
        // 짝수 마디: R 서브드럼 추가 (3드럼)
        if (bar % 2 === 0 && subR)
          [0, 2].filter(b => !backOff.includes(b)).forEach(b => safeAdd(subR, bs + b));
        // 홀수 마디: 8분 추가 (같은 드럼 유지)
        if (bar % 2 === 1) {
          [0.5, 2.5].forEach(off => safeAdd(mL, bs + off));
        }
        if (isFill(bar)) {
          safeAdd(lcyc(2), bs + bpb - 2);
          if (subR) safeAdd(subR, bs + bpb - 1);
        }
      },
    },

    {
      // 섹션 빌드 — 전반 단순(2드럼) → 후반 풍성(3~4드럼)
      name: '섹션 빌드',
      gen(bs, bar) {
        backOff.forEach(b => safeAdd(Rback, bs + b));
        const half = Math.floor(totalBars / 2);
        if (bar < half) {
          // 전반: L 1번 드럼으로 4분
          for (let b = 0; b < bpb; b++) safeAdd(lcyc(0), bs + b);
        } else {
          // 후반: L 2번 드럼으로 4분 + R 서브 추가
          const mL = lcyc(1);
          for (let b = 0; b < bpb; b++) safeAdd(mL, bs + b);
          if (subR)
            [0, 2].filter(b => !backOff.includes(b)).forEach(b => safeAdd(subR, bs + b));
        }
        if (isFill(bar)) {
          safeAdd(lcyc(2), bs + bpb - 2);
          safeAdd(rcyc(2), bs + bpb - 1);
        }
      },
    },

    {
      // 라이드 그루브 — R 라이드가 8분 스킵비트 타임키핑, L은 하이햇+스네어 백비트
      name: '라이드 그루브',
      gen(bs, bar) {
        for (let b = 0; b < bpb; b++) {
          safeAdd(Rback, bs + b);
          if (coin(0.55)) safeAdd(Rback, bs + b + 0.5);
        }
        backOff.forEach(b => safeAdd(Lsnare ?? lcyc(0), bs + b));
        const Lh = Lhihat ?? lcyc(1);
        for (let b = 0; b < bpb; b++) {
          if (!backOff.includes(b)) safeAdd(Lh, bs + b);
        }
        if (isFill(bar)) {
          safeAdd(Ltom ?? lcyc(2), bs + bpb - 2);
          if (subR) safeAdd(subR, bs + bpb - 1);
        }
      },
    },

    {
      // 온 드럼 필 — 실물 테스트용: 마디마다 여러 드럼을 빠르게 순환 노출
      name: '온 드럼 필',
      gen(bs, bar) {
        const mL  = lcyc(bar);
        const mL2 = lcyc(bar + 1);
        const mR  = rcyc(bar);
        for (let b = 0; b < bpb; b++) {
          safeAdd(b % 2 === 0 ? mL : mL2, bs + b);
          safeAdd(mR, bs + b + 0.5);
        }
        backOff.forEach(b => safeAdd(Lsnare ?? mL, bs + b));
        if (isFill(bar)) {
          safeAdd(Lcrash ?? lcyc(bar + 2), bs + bpb - 1);
          safeAdd(rcyc(bar + 2), bs + bpb - 1);
        }
      },
    },
  ];

  const style = STYLES[Math.floor(Math.random() * STYLES.length)];

  for (let bar = 0; bar < totalBars; bar++) {
    style.gen(bar * bpb + 1, bar);
  }

  // 오프닝 악센트 — 크래시(있으면)로 카운트인 느낌, 없으면 L 첫 드럼
  safeAdd(Lcrash ?? Ld[0]?.id, 1);

  // ── 밀도 보장: 팔당 최소 0.5s(120bpm=1박) 이상 공백 금지 ──────
  // 크래시 계열은 강조 포인트 전용이므로 필러에서 제외, 리듬 드럼만 사용
  const FILLER_TYPES_L = ['hihat', 'tom_h', 'snare'];
  const FILLER_TYPES_R = ['ride', 'tom_m', 'tom_f'];
  const fillL = Ld.filter(d => FILLER_TYPES_L.includes(d.type));
  const fillR = Rd.filter(d => FILLER_TYPES_R.includes(d.type));

  const maxGapB = (bpm / 60) * 0.5;   // 0.5s → beat 단위
  ['L', 'R'].forEach(arm => {
    const drums = (arm === 'L' ? fillL : fillR);
    if (!drums.length) return;
    let cycIdx = 0;
    for (let b = 1; b <= totalB; b += maxGapB) {
      const bk = parseFloat(b.toFixed(3));
      if (bk > totalB) break;
      // 근처(±0.45박)에 이미 이 팔 hit이 있으면 skip
      const near = timelineEvents.some(e => {
        const d = drumKit.find(d => d.id === e.drumId);
        return d?.arm === arm && Math.abs(e.beat - bk) < maxGapB * 0.45;
      });
      if (near) continue;
      const drumId = drums[cycIdx % drums.length].id;
      // 양팔 충돌 시 0.13박 뒤로 재시도
      const bkAlt = parseFloat((bk + 0.13).toFixed(3));
      if (safeAdd(drumId, bk) || (bkAlt <= totalB && safeAdd(drumId, bkAlt))) {
        cycIdx++;
      }
    }
  });

  // ── 커버리지 보장: 실물 드럼 테스트 목적 — 킥을 제외한 7개 드럼 중
  // 이번 생성에서 한 번도 안 쓰인 드럼을 찾아 빈 박자에 채워 넣는다.
  // (스타일별로 크래시·라이드 등이 우연히 빠질 수 있어, 여기서 최종 보정)
  const hitCount = id => timelineEvents.filter(e => e.drumId === id).length;
  [...Ld, ...Rd].filter(d => hitCount(d.id) === 0).forEach(d => {
    for (let b = 1; b <= totalB; b += 0.5) {
      if (safeAdd(d.id, parseFloat(b.toFixed(3)))) break;
    }
  });

  _commitTimeline();
  stopAnim();
  if (timelineEvents.length) playAnim();
  setStatus(`🎲 자동 생성: ${style.name} (${timelineEvents.length}개)`);
};


// ═══════════════════════════════════════════════════════════════
//  드럼 키트 패널
// ═══════════════════════════════════════════════════════════════
function renderDrumList() {
  const el       = document.getElementById('drum-list');
  const typeOpts = Object.entries(DRUM_TYPES)
    .map(([k, v]) => `<option value="${k}">${v.name}</option>`).join('');

  el.innerHTML = drumKit.map(drum => {
    const typeInfo  = DRUM_TYPES[drum.type] || DRUM_TYPES.snare;
    const isKick    = drum.type === 'kick';
    const dist      = reachDist(drum);
    const reachCls  = isKick ? 'reach-ok' : dist > STICK_REACH ? 'reach-err' : dist > STICK_REACH * 0.88 ? 'reach-warn' : 'reach-ok';
    const reachTxt  = isKick ? '표시 전용 (팔 미사용)' : dist > STICK_REACH ? `도달 불가 (${dist.toFixed(2)}m)` : `${dist.toFixed(2)}m`;

    return `
<div class="drum-item" data-id="${drum.id}">
  <div class="drum-item-header">
    <div class="drum-color-dot" style="background:${typeInfo.color};color:${typeInfo.color}"></div>
    <input class="drum-name-inp" value="${drum.name}"
      onchange="updateDrumProp('${drum.id}','name',this.value)">
    <button class="drum-del-btn" onclick="deleteDrum('${drum.id}')" title="삭제">✕</button>
  </div>
  <div class="drum-vel-preview">
    <button class="dvp-btn dvp-soft"   onclick="previewDrumHit('${drum.id}','soft')"   title="약 미리보기 (TCP 경로 표시)">약</button>
    <button class="dvp-btn dvp-medium" onclick="previewDrumHit('${drum.id}','medium')" title="중 미리보기 (TCP 경로 표시)">중</button>
    <button class="dvp-btn dvp-hard"   onclick="previewDrumHit('${drum.id}','hard')"   title="강 미리보기 (TCP 경로 표시)">강</button>
  </div>
  <div class="drum-type-row">
    <select class="drum-type-sel" onchange="updateDrumProp('${drum.id}','type',this.value)">
      ${typeOpts.replace(`value="${drum.type}"`, `value="${drum.type}" selected`)}
    </select>
    ${isKick
      ? `<select class="drum-arm-sel" disabled title="킥은 표시 전용 — 팔이 연주하지 않음"><option selected>표시용</option></select>`
      : `<select class="drum-arm-sel" onchange="updateDrumProp('${drum.id}','arm',this.value)">
      <option value="L" ${drum.arm==='L'?'selected':''}>왼팔 L</option>
      <option value="R" ${drum.arm==='R'?'selected':''}>오른팔 R</option>
    </select>`}
  </div>
  <div class="drum-pos-row">
    <div class="drum-pos-group">
      <label>X (앞)</label>
      <input class="drum-pos-inp" type="number" step="0.01" value="${drum.pos.x.toFixed(2)}"
        onchange="updateDrumPos('${drum.id}','x',+this.value)">
      <input class="drum-pos-slider" type="range" min="0.20" max="0.90" step="0.01"
        value="${drum.pos.x.toFixed(2)}"
        oninput="updateDrumPos('${drum.id}','x',+this.value);syncSlider(this,'x')">
    </div>
    <div class="drum-pos-group">
      <label>Y (좌우)</label>
      <input class="drum-pos-inp" type="number" step="0.01" value="${drum.pos.y.toFixed(2)}"
        onchange="updateDrumPos('${drum.id}','y',+this.value)">
      <input class="drum-pos-slider" type="range" min="-0.90" max="0.90" step="0.01"
        value="${drum.pos.y.toFixed(2)}"
        oninput="updateDrumPos('${drum.id}','y',+this.value);syncSlider(this,'y')">
    </div>
    <div class="drum-pos-group">
      <label>Z (높이)</label>
      <input class="drum-pos-inp" type="number" step="0.01" value="${drum.pos.z.toFixed(2)}"
        onchange="updateDrumPos('${drum.id}','z',+this.value)">
      <input class="drum-pos-slider" type="range" min="0.25" max="1.00" step="0.01"
        value="${drum.pos.z.toFixed(2)}"
        oninput="updateDrumPos('${drum.id}','z',+this.value);syncSlider(this,'z')">
    </div>
  </div>
  <span class="drum-reach-badge ${reachCls}">${reachTxt}</span>
  <div class="drag-hint">뷰포트에서 드래그로 위치 이동 가능</div>
</div>`;
  }).join('');
}

window.syncSlider = function (sliderEl, axis) {
  // 슬라이더 → 숫자 입력 동기화
  const item = sliderEl.closest('.drum-item');
  if (!item) return;
  const axisIdx = { x:0, y:1, z:2 }[axis];
  const inp = item.querySelectorAll('.drum-pos-inp')[axisIdx];
  if (inp) inp.value = parseFloat(sliderEl.value).toFixed(2);
};

window.updateDrumProp = function (id, prop, val) {
  const drum = drumKit.find(d => d.id === id);
  if (!drum) return;
  drum[prop] = val;
  // 타입 ↔ kick 전환 시 arm 정합성 보정 (kick은 팔 미배정)
  if (prop === 'type') {
    if (val === 'kick') drum.arm = 'kick';
    else if (drum.arm !== 'L' && drum.arm !== 'R') drum.arm = drum.pos.y >= 0 ? 'L' : 'R';
  }
  saveDrumKit();
  renderDrumList();
  rebuildDrumSpheres();
  renderTimeline();
};

window.updateDrumPos = function (id, axis, val) {
  const drum = drumKit.find(d => d.id === id);
  if (!drum || !isFinite(val)) return;
  drum.pos[axis] = val;

  const grp = drumGroups[id];
  if (grp) grp.position.set(drum.pos.x, drum.pos.y, drum.pos.z);

  // reach badge만 갱신 (전체 재렌더 방지)
  const item = document.querySelector(`.drum-item[data-id="${id}"]`);
  if (item) {
    const isKick   = drum.type === 'kick';
    const dist     = reachDist(drum);
    const badge    = item.querySelector('.drum-reach-badge');
    if (badge) {
      badge.className = 'drum-reach-badge ' + (isKick ? 'reach-ok' : dist > STICK_REACH ? 'reach-err' : dist > STICK_REACH * 0.88 ? 'reach-warn' : 'reach-ok');
      badge.textContent = isKick ? '표시 전용 (팔 미사용)' : dist > STICK_REACH ? `도달 불가 (${dist.toFixed(2)}m)` : `${dist.toFixed(2)}m`;
    }
    // 동기: 숫자입력 → 슬라이더
    const inps    = item.querySelectorAll('.drum-pos-inp');
    const sliders = item.querySelectorAll('.drum-pos-slider');
    const axisIdx = { x:0, y:1, z:2 }[axis];
    if (inps[axisIdx])    inps[axisIdx].value    = val.toFixed(2);
    if (sliders[axisIdx]) sliders[axisIdx].value  = val.toFixed(2);
  }
  saveDrumKit();
};

window.addDrum = function () {
  const id = 'd' + nextDrumId++;
  drumKit.push({ id, name:`드럼 ${nextDrumId}`, type:'snare', arm:'L', pos:{x:0.50, y:0.20, z:0.46} });
  saveDrumKit();
  renderDrumList();
  rebuildDrumSpheres();
  renderTimeline();
};

window.deleteDrum = function (id) {
  drumKit         = drumKit.filter(d => d.id !== id);
  timelineEvents  = timelineEvents.filter(e => e.drumId !== id);
  saveDrumKit();
  renderDrumList();
  rebuildDrumSpheres();
  renderTimeline();
};

// ═══════════════════════════════════════════════════════════════
//  패턴 적용
// ═══════════════════════════════════════════════════════════════
window.applyPattern = function () {
  bpm         = parseInt(document.getElementById('bpm-inp').value)  || 120;
  beatsPerBar = parseInt(document.getElementById('meter-sel').value) || 4;
  totalBars   = parseInt(document.getElementById('bars-inp').value)  || 4;

  _playKFs = buildFinalKeyframes();
  _playDur = _playKFs.totalTime;
  document.getElementById('scrubber').max = _playDur;

  renderTimeline();
  updateTLInfo();
  const kfCount = (_playKFs.L?.length ?? 0) + (_playKFs.R?.length ?? 0);
  setStatus(`적용됨 — ${kfCount}개 KF · ${_playDur.toFixed(1)}s`);
  stopAnim();
  if (timelineEvents.length) playAnim();
};

document.getElementById('bpm-inp').addEventListener('change', () => updateTLInfo());

// 스트로크 튜닝 슬라이더 공통 rebuild
function _rebuildStroke() {
  _playKFs = buildFinalKeyframes();
  _playDur  = _playKFs.totalTime;
  if (!isPlaying) renderFrame(pauseOffset);
}

// 스트로크 튜닝: 슬라이더 ↔ 숫자 입력 연동 헬퍼
function _bindStrokePair(sliderId, numId, setter, min, max) {
  const slider = document.getElementById(sliderId);
  const num    = document.getElementById(numId);
  slider.addEventListener('input', function () {
    const v = parseFloat(this.value);
    setter(v);
    num.value = v.toFixed(2);
    _rebuildStroke();
  });
  num.addEventListener('change', function () {
    const v = Math.min(max, Math.max(min, parseFloat(this.value) || 0));
    setter(v);
    slider.value = v;
    this.value   = v.toFixed(2);
    _rebuildStroke();
  });
}
_bindStrokePair('stick-j7-slider',  'stick-j7-val',  v => { stickJ7Offset  = v; saveSettings(); }, -1.5, 1.5);
_bindStrokePair('stroke-j4-slider', 'stroke-j4-val', v => { strokeJ4Offset = v; saveSettings(); }, -1.0, 1.0);
_bindStrokePair('stroke-j56-slider','stroke-j56-val',v => { strokeJ56Offset= v; saveSettings(); }, -1.5, 1.5);
document.getElementById('bpm-inp').addEventListener('input', () => saveSettings());
document.getElementById('meter-sel').addEventListener('change', () => {
  beatsPerBar = parseInt(document.getElementById('meter-sel').value) || 4;
  renderTimeline(); updateTLInfo(); saveSettings();
});
document.getElementById('bars-inp').addEventListener('change', () => {
  totalBars = parseInt(document.getElementById('bars-inp').value) || 4;
  renderTimeline(); updateTLInfo(); saveSettings();
});
document.getElementById('grid-sel').addEventListener('change', () => renderTimeline());

// ═══════════════════════════════════════════════════════════════
//  유틸
// ═══════════════════════════════════════════════════════════════
function setStatus(msg) {
  const el = document.getElementById('status-span');
  if (el) el.textContent = msg;
}

function updateTLInfo() {
  const b  = parseInt(document.getElementById('bpm-inp').value)    || bpm;
  const bp = parseInt(document.getElementById('meter-sel').value)  || beatsPerBar;
  const tb = parseInt(document.getElementById('bars-inp').value)   || totalBars;
  const el = document.getElementById('tl-info');
  if (el) el.textContent = `${tb}마디 · ${b}BPM · ${bp}/4박자`;
}

// ═══════════════════════════════════════════════════════════════
//  초기화
// ═══════════════════════════════════════════════════════════════
loadDrumKit();
window.addEventListener('resize', () => renderTimeline());

// 인트로/아웃트로 체크박스 변경 → 재생 타임라인 즉시 갱신
['chk-intro', 'chk-outro'].forEach(id => {
  document.getElementById(id)?.addEventListener('change', () => {
    _playKFs = buildFinalKeyframes();
    _playDur = _playKFs.totalTime;
    document.getElementById('scrubber').max = _playDur;
    document.getElementById('scrubber').value = 0;
    pauseOffset = 0;
    const inclIntro = document.getElementById('chk-intro')?.checked ?? true;
    const inclOutro = document.getElementById('chk-outro')?.checked ?? true;
    const label = [inclIntro && '인트로', inclOutro && '아웃트로'].filter(Boolean).join('+');
    setStatus(`타임라인 갱신: ${label || '드럼 본편만'} (${_playDur.toFixed(1)}s)`);
    saveSettings();
  });
});
updateFK({ ...NEUTRAL });
renderDrumList();
renderSkinPresets();
rebuildDrumSpheres();
loadSettings();   // BPM·박자·마디·체크박스·스트로크 오프셋 복원
loadTimeline();   // 타임라인 이벤트 복원
renderTimeline();
updateTLInfo();
if (timelineEvents.length) {
  _playKFs = buildFinalKeyframes();
  _playDur  = _playKFs.totalTime;
  document.getElementById('scrubber').max = _playDur;
}
setStatus('드럼 키트 로드됨 — 타임라인 클릭으로 배치 · 뷰포트 드래그로 위치 이동');
