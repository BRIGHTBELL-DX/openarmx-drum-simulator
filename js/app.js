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
  snare:  { name:'스네어',       color:'#ffffff', preDur:0.08, rebDur:0.10, style:'full',  tilt:15 }, // 흰색
  tom_h:  { name:'스몰 탐',      color:'#ff3366', preDur:0.09, rebDur:0.11, style:'full',  tilt:15 }, // 핑크레드
  tom_m:  { name:'미들 탐',      color:'#ff8800', preDur:0.09, rebDur:0.11, style:'full',  tilt:15 }, // 주황
  tom_f:  { name:'플로어 탐',    color:'#bb44ff', preDur:0.10, rebDur:0.13, style:'full',  tilt:15 }, // 보라
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
// 아래 좌표는 사용자가 로컬에서 최종 확정한 값 — J1(후인 금지)·J2(고정)·
// J5(안쪽 말림 금지) 제한(아래 _IK_LIMITS 참고) 하에서 실측 검증 결과
// 7드럼 전부 팁 오차 7mm 이내·수직성 0.93+·호 직진성 전부 양수(0.36~0.73)로
// 이번 세션 중 가장 고르게 좋은 결과였다.
// 스네어·플로어 탐은 X를 +0.06m 추가 조정(0.59→0.65) — 원래 위치에서도
// 도달은 됐지만 J3·J6이 크게(스네어 J3=-0.43·J6=-0.94, 플로어 탐
// J3=+0.45·J6=+0.93) 꺾여야 했다. X를 늘리자 두 관절 다 거의 0으로
// 완화되면서 직진성도 오히려 소폭 개선됐다(실측 검증).
let drumKit = [
  // ─ L팔 ─────────────────────────────────────────────────────────
  { id:'d0', name:'하이 햇',     type:'hihat', arm:'L', pos:{x:0.64, y: 0.41,  z:0.40} },
  { id:'d1', name:'크래쉬 심벌', type:'crash', arm:'L', pos:{x:0.77, y: 0.31,  z:0.50} },
  { id:'d2', name:'스네어',      type:'snare', arm:'L', pos:{x:0.65, y: 0.14,  z:0.28} },
  { id:'d3', name:'스몰 탐',     type:'tom_h', arm:'L', pos:{x:0.76, y: 0.11,  z:0.50} },
  // ─ 킥 (표시 전용, 팔 미사용) ─────────────────────────────────
  { id:'d4', name:'킥',          type:'kick',  arm:'kick', pos:{x:0.63, y: 0.00, z:0.12} },
  // ─ R팔 ─────────────────────────────────────────────────────────
  { id:'d5', name:'미들 탐',     type:'tom_m', arm:'R', pos:{x:0.77, y:-0.13,  z:0.50} },
  { id:'d6', name:'플로어 탐',   type:'tom_f', arm:'R', pos:{x:0.65, y:-0.16,  z:0.26} },
  { id:'d7', name:'라이드 심벌', type:'ride',  arm:'R', pos:{x:0.72, y:-0.40,  z:0.50} },
];
let nextDrumId = 8;

// 기본값 스냅샷 (초기화 버튼용)
const DEFAULT_DRUM_KIT = drumKit.map(d => ({...d, pos: {...d.pos}}));
const _DK_STORE = 'openarmx_drum_kit_v17';

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
  // 템플릿 선택 드롭다운과 정렬 — 선택된 템플릿이 있으면 그 템플릿 위치로
  // 초기화하고, 선택된 게 없을 때만 진짜 기본값(템플릿 1)으로 되돌린다.
  const sel = document.getElementById('preset-sel');
  const selectedName = sel ? sel.value : '';
  if (selectedName && drumPresets.some(p => p.name === selectedName)) {
    applyDrumPreset(selectedName);
    setStatus(`"${selectedName}" 템플릿 위치로 초기화됨`);
    return;
  }
  drumKit = DEFAULT_DRUM_KIT.map(d => ({...d, pos: {...d.pos}}));
  nextDrumId = DEFAULT_DRUM_KIT.length;
  saveDrumKit();
  renderDrumList(); rebuildDrumSpheres(); renderTimeline();
  _playKFs = buildFinalKeyframes(); _playDur = _playKFs.totalTime;
  setStatus('드럼 키트 기본값으로 초기화됨');
};

// ═══════════════════════════════════════════════════════════════
//  드럼 위치 프리셋(템플릿) — 실물 로봇 좌표 세팅을 이름으로 저장·전환
// ═══════════════════════════════════════════════════════════════
const _PRESET_STORE = 'openarmx_drum_presets_v1';

function _snapshotPositions() {
  const out = {};
  drumKit.forEach(d => { out[d.id] = { x: d.pos.x, y: d.pos.y, z: d.pos.z }; });
  return out;
}

function _loadDrumPresets() {
  // 배포 기본 시드 — 템플릿 1은 배포 기본값, 템플릿 2·3은 사용자가
  // 실물 테스트용으로 확정한 좌표
  const t1 = {};
  DEFAULT_DRUM_KIT.forEach(d => { t1[d.id] = { ...d.pos }; });
  const seeds = [
    { name: '템플릿 1', positions: t1 },
    { name: '템플릿 2', positions: {
        d0:{x:0.64, y:0.41,  z:0.40}, d1:{x:0.77, y:0.31,  z:0.50},
        d2:{x:0.66, y:0.19,  z:0.28}, d3:{x:0.76, y:0.11,  z:0.50},
        d4:{x:0.63, y:0.00,  z:0.12},
        d5:{x:0.77, y:-0.11, z:0.50}, d6:{x:0.66, y:-0.22, z:0.26},
        d7:{x:0.72, y:-0.40, z:0.50},
      } },
    { name: '템플릿 3', positions: {
        d0:{x:0.56, y:0.54,  z:0.40}, d1:{x:0.77, y:0.32,  z:0.50},
        d2:{x:0.59, y:0.42,  z:0.18}, d3:{x:0.76, y:0.11,  z:0.45},
        d4:{x:0.63, y:0.00,  z:0.12},
        d5:{x:0.76, y:-0.11, z:0.45}, d6:{x:0.55, y:-0.46, z:0.18},
        d7:{x:0.72, y:-0.40, z:0.50},
      } },
    { name: '템플릿 4', positions: {
        d0:{x:0.61, y:0.60,  z:0.40}, d1:{x:0.76, y:0.37,  z:0.50},
        d2:{x:0.51, y:0.41,  z:0.18}, d3:{x:0.76, y:0.16,  z:0.45},
        d4:{x:0.63, y:0.00,  z:0.12},
        d5:{x:0.76, y:-0.15, z:0.45}, d6:{x:0.51, y:-0.41, z:0.18},
        d7:{x:0.80, y:-0.41, z:0.50},
      } },
    { name: '템플릿 5', positions: {
        d0:{x:0.57, y:0.63,  z:0.35}, d1:{x:0.71, y:0.51,  z:0.45},
        d2:{x:0.63, y:0.36,  z:0.25}, d3:{x:0.76, y:0.16,  z:0.40},
        d4:{x:0.63, y:0.00,  z:0.12},
        d5:{x:0.76, y:-0.15, z:0.40}, d6:{x:0.59, y:-0.40, z:0.25},
        d7:{x:0.79, y:-0.41, z:0.45},
      } },
  ];
  try {
    const raw = localStorage.getItem(_PRESET_STORE);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length) {
        // "템플릿 N"(코드로 관리하는 공식 시드)은 항상 최신 코드 값으로 동기화하고,
        // 그 외 사용자가 직접 다른 이름으로 저장한 커스텀 프리셋만 그대로 보존.
        // 예전엔 localStorage에 값이 있으면 시드를 무시해서, 코드에서 템플릿 값을
        // 수정해도 이미 그 템플릿을 저장해본 적 있는 브라우저에는 반영되지
        // 않는 문제가 있었음(신규 템플릿 추가는 물론 기존 템플릿 값 변경도 누락됨).
        const seedNames = new Set(seeds.map(s => s.name));
        const customOnly = parsed.filter(p => !seedNames.has(p.name));
        return seeds.concat(customOnly);
      }
    }
  } catch (e) {}
  return seeds;
}
let drumPresets = _loadDrumPresets();
function _saveDrumPresets() {
  try { localStorage.setItem(_PRESET_STORE, JSON.stringify(drumPresets)); } catch (e) {}
}
function renderPresetDropdown() {
  const sel = document.getElementById('preset-sel');
  if (!sel) return;
  const cur = sel.value;
  sel.innerHTML = '<option value="">— 템플릿 선택 —</option>' +
    drumPresets.map(p => `<option value="${p.name}">${p.name}</option>`).join('');
  if (drumPresets.some(p => p.name === cur)) sel.value = cur;
}
window.applyDrumPreset = function (name) {
  if (!name) return;
  const preset = drumPresets.find(p => p.name === name);
  if (!preset) return;
  drumKit.forEach(d => {
    const p = preset.positions[d.id];
    if (p) Object.assign(d.pos, p);
  });
  saveDrumKit();
  renderDrumList(); rebuildDrumSpheres(); renderTimeline();
  _playKFs = buildFinalKeyframes(); _playDur = _playKFs.totalTime;
  setStatus(`"${name}" 템플릿 적용됨`);
};
window.saveDrumPreset = function () {
  const sel = document.getElementById('preset-sel');
  const name = prompt('저장할 템플릿 이름(기존 이름을 입력하면 덮어씁니다):', sel.value || '');
  if (!name) return;
  const positions = _snapshotPositions();
  const idx = drumPresets.findIndex(p => p.name === name);
  if (idx >= 0) drumPresets[idx] = { name, positions };
  else drumPresets.push({ name, positions });
  _saveDrumPresets();
  renderPresetDropdown();
  sel.value = name;
  setStatus(`"${name}" 템플릿으로 저장됨`);
};
window.deleteDrumPreset = function () {
  const sel = document.getElementById('preset-sel');
  const name = sel.value;
  if (!name) { setStatus('삭제할 템플릿을 먼저 선택하세요'); return; }
  if (!confirm(`"${name}" 템플릿을 삭제할까요?`)) return;
  drumPresets = drumPresets.filter(p => p.name !== name);
  _saveDrumPresets();
  renderPresetDropdown();
  setStatus(`"${name}" 템플릿 삭제됨`);
};

// 템플릿이 선택된 상태에서 드럼 위치를 손으로 바꾸면, 더 이상 그 템플릿과
// 일치하지 않으므로 드롭다운을 "선택 안 됨"으로 되돌려 저장을 유도한다
// (선택된 템플릿 이름이 그대로 남아있으면 실제로는 다른 위치인데도 마치
// 그 템플릿 그대로인 것처럼 보이는 문제가 있었음).
function _checkTemplateDirty() {
  const sel = document.getElementById('preset-sel');
  if (!sel || !sel.value) return;
  const preset = drumPresets.find(p => p.name === sel.value);
  if (!preset) return;
  const EPS = 0.005;
  const matches = drumKit.every(d => {
    const p = preset.positions[d.id];
    if (!p) return true;
    return Math.abs(d.pos.x - p.x) < EPS && Math.abs(d.pos.y - p.y) < EPS && Math.abs(d.pos.z - p.z) < EPS;
  });
  if (!matches) {
    const prevName = sel.value;
    sel.value = '';
    setStatus(`위치가 "${prevName}"에서 변경됨 — 이 위치를 저장하려면 💾 저장을 눌러주세요`);
  }
}

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
      introStyleId: document.getElementById('intro-style-sel')?.value || 'spread',
      stickJ7Offset,
      complexityMode,
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
    if (s.introStyleId != null) { const el = document.getElementById('intro-style-sel'); if (el) el.value = s.introStyleId; }
    if (s.stickJ7Offset   != null) { stickJ7Offset   = s.stickJ7Offset;   _setSliderPair('stick-j7-slider',   'stick-j7-val',   stickJ7Offset); }
    if (s.complexityMode  != null) { window.setComplexity(s.complexityMode); }
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
let complexityMode = 'M'; // 자동 생성 복잡도: L(단순)·M(기본)·H(화려)
// 타격점(J1~J7)은 고정 — raise 시 J7이 얼마나 더 젖혀지는지(들어올리는 높이)만 조절.
// 양수 = 더 높이 들어 강하게, 음수 = 낮게 들어 약하게. 팔별 부호(L:-/R:+)는
// computeStrikePose에서 자동 처리되므로 여기선 하나의 magnitude만 관리한다.
let stickJ7Offset  = 0;
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
// L1 상한(구 0.2)·R1 하한(구 -0.2)은 스틱 이전 시스템에서 정한 값이라
// "팔이 몸 뒤로 젖혀지며 뻗는" 자세를 원천 차단하고 있었다 — 실제로 하이햇
// 등에서 그레이디언트가 이 벽에 눌려붙어(J1=0.19≈0.2) J2가 대신 한계까지
// 밀리는 부자연스러운 해로 이어짐. 양쪽으로 넓혀 자유탐색이 자체적으로
// "J1·J2가 함께 크게 움직이는" 더 자연스러운 분기를 찾도록 한다.
// L2>0(왼팔)·R2<0(오른팔)는 어깨가 몸통 쪽으로 접히는 방향 — 팔꿈치가
// 중앙 기둥(body)에 바짝 붙는 충돌 위험 자세로 이어진다. 부호를 팔별로
// 강제해 항상 몸통 반대쪽으로만 접히도록 한다.
//
// J2(어깨 좌우 벌림/사이드레터럴)는 위 안전 부호 안에서도 좁은 구간으로
// 고정한다 — 기존엔 드럼마다 J2가 크게(왼팔 ~53°·오른팔 ~37°) 움직여
// "날개를 폈다 접는" 관성이 큰 동작으로 보였다. 고정 구간은 사용자가
// 참고한 실제 관절값(왼팔 J2≈-0.13~-0.20)에 맞췄다 — 처음엔 -0.75~-1.05
// (하이햇 등 넓게 벌어진 값 기준)로 고정해봤으나, 사용자 참고값과 달라
// -0.13~-0.20으로 다시 좁혔다. 이 값은 원래(고정 전) 스네어의 자연스러운
// J2와 거의 같아, 스네어는 위치 변경 없이 그대로 통과하지만 하이햇·
// 크래쉬·스몰 탐·미들 탐·라이드는 이 좁은 구간에서 팁 오차·수직성·호
// 직진성이 나오도록 위치를 재조정해야 했다(드럼 키트 배열 주석 참고).
// J6은 한계(±1.57)까지 못 미쳐(최대 ~1.26) 여유가 있어 J2를 넓게 풀어줄
// 필요가 없었다(과거엔 이 여유 없이 J6이 국소해에 몰리는 문제가 있어
// 측면 드럼에 한해 J2를 넓히는 별도 분기가 있었으나, 그 분기가 오히려
// 이 좁은 구간을 덮어써 무력화시켜 제거함 — 아래 lateralY 관련 분기 삭제).
//
// J1(어깨 요)도 한쪽 방향으로 막는다 — 왼팔 J1>0("후인", 팔이 몸 뒤로
// 젖혀짐)·오른팔 J1<0은 드럼이 전부 로봇 앞쪽에 있는 배치와 맞지 않는
// 부자연스러운 자세다(사용자 실측 스크린샷으로 확인). 예전엔 이 후인
// 분기를 일부러 시드로 탐색해 수직성 점수를 높였는데, 점수만 좋을 뿐
// 시각적으로 틀린 자세였다 — 아래 J1_SEEDS를 반대(전방) 방향으로 바꿈.
// 상한만 막는 것으론 부족했다 — 반대쪽(하한 -2.0)이 너무 넓어 극단적인
// 전방 회전(-1.6 이상)에 빠져 J6이 국소해로 몰리는 별개의 문제가 있었다
// (스몰 탐·미들 탐 실측으로 확인). 하한도 -0.6 정도로 좁혀 "0 근처의
// 적당한 전방 회전"만 허용한다.
// J5(전완 롤)도 같은 이유로 한쪽만 허용한다 — 왼팔 J5<0이면 전완이
// 돌아가며 팔이 몸 안쪽으로 말려 들어온다(크래쉬 타격에서 실측 확인).
const _IK_LIMITS = {
  L1:[-0.6, 0.05], L2:[-0.20, -0.13], L3:[-2.9, 2.9],
  L4:[0.05, 1.70], L5:[-0.05, 2.9], L6:[-1.57, 1.57],
  R1:[-0.05, 0.6], R2:[0.13, 0.20], R3:[-2.9, 2.9],
  R4:[0.05, 1.70], R5:[-2.9, 0.05], R6:[-1.57, 1.57],
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
  // strike 위상의 J7은 고정 타격점 — 스트로크 튜닝(stickJ7Offset)의 영향을 받지
  // 않는다(사용자 요구: 타격점은 유지, raise 높이만 조절). 캐시 키에도 넣지 않음.
  const j7Raw = 0.18 * vs.j7Strike * styleScale;
  const j7    = s === 'L' ? j7Raw : -j7Raw;

  // 캐시 키에는 IK 해에 영향을 주는 모든 입력을 포함해야 한다. id·pos 외에도
  // arm(어느 팔 조인트를 푸는지)·type(style/styleScale/isCymbal/한계)·tilt(헤드
  // 법선→접촉각 보정)가 결과를 바꾸므로 함께 넣는다. 이렇게 하면 드럼 종류·팔을
  // 바꿔도 키가 달라져 자동으로 새로 풀리므로 별도 무효화가 필요 없다.
  const effTilt = drum.tiltDeg ?? DRUM_TYPES[drum.type]?.tilt ?? 0;
  const key = [drum.id, drum.arm, drum.type, vel, effTilt,
               drum.pos.x.toFixed(3), drum.pos.y.toFixed(3), drum.pos.z.toFixed(3)].join('|');
  const hit = _strikeSolveCache.get(key);
  if (hit) return hit;

  const isCymbal = ['crash', 'ride', 'hihat'].includes(drum.type);

  // 드럼 헤드 표면 법선(스틱이 파고들어야 하는 방향의 반대) — 렌더링 코드의
  // drumHead.rotation.y = -(tiltDeg*PI/180)와 동일한 프레임/부호로 계산.
  // 탐처럼 tilt가 큰(15°) 드럼은 헤드가 로봇 쪽으로 기울어 있어, 법선을
  // 무시하고 순수 수직으로만 내려치면 스틱이 헤드에 스치듯 비스듬히 닿는다.
  // 심벌은 원래 옆면을 스치듯 치는 게 자연스러워 이 보정에서 제외한다.
  const tiltDeg    = drum.tiltDeg ?? DRUM_TYPES[drum.type]?.tilt ?? 0;
  const tiltRad    = tiltDeg * PI / 180;
  const headNormal = new THREE.Vector3(-Math.sin(tiltRad), 0, Math.cos(tiltRad));

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
  // (구) 측면 드럼에 한해 J2를 넓게 유도하던 분기는 J2 고정 정책과
  // 충돌해 제거했다 — _IK_LIMITS.L2/R2 고정 구간 안에서도 J1·J3·J6이
  // 측면 드럼(하이햇·크래쉬·플로어탐·라이드)을 문제없이 커버한다.

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
  // J5(전완 롤) 시드는 이제 "팔이 안쪽으로 말리지 않는" 방향(왼팔 양수·
  // 오른팔 음수)만 탐색한다 — _IK_LIMITS.L5/R5가 반대 부호를 이미 막고
  // 있으므로 그 반대쪽 시드는 클램프되어 낭비였다.
  const j5Sign = s === 'L' ? 1 : -1;
  const J5_SEEDS = [0, 0.7, 1.1, 1.4, -0.3].map(v => v * j5Sign);

  // J1(어깨 요) 시드도 "전방으로 뻗는" 방향(왼팔 음수·오른팔 양수)만
  // 탐색한다 — _IK_LIMITS.L1/R1이 반대(후인) 방향을 막고 있어 그쪽 시드는
  // 이제 클램프될 뿐이다. 전방 시드로 시작해야 그 방향의 자연스러운
  // 해(팔꿈치를 굽혀 앞으로 뻗는 자세)가 탐색된다.
  // 우선 시도하고, 수직성이 이미 충분히 좋으면(>0.95) 바로 채택해 비용을 아낀다.
  const j1FwdSign = s === 'L' ? -1 : 1;
  const J1_SEEDS = [j1FwdSign * 0.4, null];   // null = 해석적 추정치 그대로

  // raise 위상의 J7 (computeStrikePose와 동일 공식, medium velocity 기준)
  // — 후보 평가용. 관절 크기 자체엔 목표가 없다(가까운/먼 드럼 모두 필요한
  // 만큼 J1~J6을 움직여도 됨). 유일한 기준은 "J7 스윙이 하늘→바닥으로
  // 얼마나 수직에 가까운가" — 몸 안쪽으로 스치지 않는 자연스러운 타격.
  const raiseJ7Phase = (s === 'L' ? -0.86 : 0.86) * styleScale;
  const raiseJ7 = j7 + (raiseJ7Phase - j7) * 0.8;

  // raise↔strike는 J1~J6이 고정된 채 J7만 도는 단일 힌지 운동이라 스틱 끝은
  // 필연적으로 원호를 그린다. 양 끝점(raise·strike)만 수직으로 이어져 있어도
  // 그 "사이" 호가 옆으로 부풀 수 있고, 실측 결과 그 부푼 지점이 인접한
  // 심벌을 스치는 원인이었다(양 끝점만 보는 검사로는 못 잡음). 스윙 도중
  // 여러 지점을 샘플링해 strike 지점을 지나는 수직선에서 얼마나 벗어나는지
  // (수평 편차)를 측정해 채점에 반영한다 — 사후 키프레임 삽입이 아니라
  // 애초에 호 전체가 곧은 자세를 고르는 방식.
  function arcMaxHorizDev(pose, raiseJ7v, strikeJ7v, strikeTip) {
    let maxDev = 0;
    for (let i = 1; i < 8; i++) {
      const j7v = raiseJ7v + (strikeJ7v - raiseJ7v) * (i / 8);
      const tip = _pureFKStick({ ...pose, [`${s}7`]: j7v }, s).tip;
      const dev = Math.hypot(tip.x - strikeTip.x, tip.y - strikeTip.y);
      if (dev > maxDev) maxDev = dev;
    }
    return maxDev;
  }
  function poseScore(pose, raiseJ7v, strikeJ7v, withContact) {
    const strikeTip = _pureFKStick(pose, s).tip;
    const raiseTip  = _pureFKStick({ ...pose, [`${s}7`]: raiseJ7v }, s).tip;
    const swing = strikeTip.clone().sub(raiseTip);
    const swingLen = swing.length();
    const verticality = swingLen > 1e-4 ? (-swing.z / swingLen) : -1;
    const maxDev = arcMaxHorizDev(pose, raiseJ7v, strikeJ7v, strikeTip);
    const straightness = clamp(1 - maxDev / 0.08, -1, 1);
    if (!withContact) return verticality * 0.5 + straightness * 0.5;
    const contact = -_pureFKStick(pose, s).dir.dot(headNormal);
    return contact * 0.6 + verticality * 0.1 + straightness * 0.3;
  }

  let overallBest = null, overallScore = -Infinity;
  outer_seed:
  for (const j1Seed of J1_SEEDS) {
    for (const j5Seed of J5_SEEDS) {
      let proxy = { x: drum.pos.x, y: drum.pos.y, z: drum.pos.z };
      let best = null, bestErr = Infinity, init = null;
      const DAMPING = 0.5;
      for (let outer = 0; outer < 14; outer++) {
        if (!init) {
          const guess = _analyticGuess({ ...drum, pos: proxy }, 'strike');
          init = {};
          [2,3,4,6].forEach(i => { init[`${s}${i}`] = guess[`${s}${i}`]; });
          init[`${s}1`] = j1Seed ?? guess[`${s}1`];
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

      const score = poseScore(best, raiseJ7, j7, false);
      if (score > overallScore) { overallScore = score; overallBest = best; overallBest._err = bestErr; }
      if (overallScore > 0.9) break outer_seed;   // 충분히 좋음 — 더 찾을 필요 없음(속도)
    }
  }
  // ── 접촉각 보정 ────────────────────────────────────────────────
  // 위에서 찾은 자세(overallBest)는 위치·수직성·직진성만 기준으로 골랐기
  // 때문에, 헤드가 기울어진 드럼(탐류 15° 등)에서는 스틱이 헤드에 거의
  // 평행하게(스치듯) 닿을 수 있다. 이미 찾은 자연스러운 자세에서 "웜스타트"로
  // J7을 소폭(최대 ±0.6)만 바꿔 다시 수렴시켜, 접촉각이 실제로 개선될 때만
  // 채택한다 — 큰 배율로 J7을 바꾸면 raise/rebound 스윙이 함께 커져
  // "손목이 과하게 꺾이는" 부작용이 생기므로 이번엔 작은 폭만 시도한다.
  // (raise/rebound에도 이 델타를 그대로 더해서 스윙 폭 자체는 안 변한다 —
  // computeStrikePose 참고)
  let contactDelta = 0;
  let finalPose = overallBest;
  if (!isCymbal && overallBest) {
    const baseContact = -_pureFKStick(overallBest, s).dir.dot(headNormal);
    let bestDeltaScore = poseScore(overallBest, raiseJ7, j7, true);
    if (baseContact < 0.5) {   // 이미 충분히 수직으로 닿으면 손대지 않음
      const DELTA_CANDIDATES = [-0.3, -0.6, 0.3, 0.6];
      for (const d of DELTA_CANDIDATES) {
        const j7Try = j7 + d;
        let proxy = { x: drum.pos.x, y: drum.pos.y, z: drum.pos.z };
        let init  = { ...overallBest };
        let cand  = overallBest, candErr = Infinity;
        for (let outer = 0; outer < 14; outer++) {
          const sol = _solveIK(s, proxy, init, j7Try,
                                Object.keys(extraLimits).length ? extraLimits : undefined);
          [1,2,3,4,5,6].forEach(i => { init[`${s}${i}`] = sol[`${s}${i}`]; });
          const tip = _pureFKStick(sol, s).tip;
          const err = target.clone().sub(tip);
          const errLen = err.length();
          if (errLen < candErr) { candErr = errLen; cand = sol; }
          if (errLen < 0.004) break;
          proxy = { x: proxy.x + err.x * 0.5, y: proxy.y + err.y * 0.5, z: proxy.z + err.z * 0.5 };
        }
        if (candErr >= 0.015) continue;   // 웜스타트로도 수렴 실패 → 제외

        const candScore = poseScore(cand, raiseJ7 + d, j7Try, true);
        if (candScore > bestDeltaScore) {
          bestDeltaScore = candScore; contactDelta = d; finalPose = cand;
        }
      }
    }
  }

  // 모든 시드가 수렴 실패한 극단적 경우에만 폴백(첫 시드 결과라도 사용)
  const solved  = finalPose ?? _analyticGuess(drum, 'strike');
  const errTip  = overallBest ? overallBest._err : 0.999;
  const result = { pose: solved, ok: errTip < 0.015, j7Strike: j7 + contactDelta, nominalJ7: j7, contactDelta };
  if (_strikeSolveCache.size > 300) _strikeSolveCache.clear();
  _strikeSolveCache.set(key, result);
  return result;
}

function computeStrikePose(drum, phase, vel = 'medium') {
  const s     = drum.arm;
  const style = DRUM_TYPES[drum.type]?.style || 'full';
  const vs    = VEL_SCALE[vel] ?? VEL_SCALE.medium;
  const styleScale = { big:1.05, wrist:1.00, full:0.88, none:0 }[style] ?? 1.0;

  const { pose: solved, j7Strike, nominalJ7, contactDelta } = _solveStickStrike(drum, vel);

  // 포즈 조립 (해당 팔만 — buildKeyframes에서 L/R 트랙 분리)
  const pose = { ...NEUTRAL };
  [1,2,3,4,5,6,7].forEach(i => { pose[`${s}${i}`] = solved[`${s}${i}`]; });

  // raise/rebound = 손목(J7) 코킹 — 팔 관절(J1~J6)은 strike와 완전히 동일
  // (타격점 고정). 코킹 폭은 velocity(vs.raiseZ/rebZ)와 스트로크 튜닝
  // (stickJ7Offset)이 함께 결정 — 둘 다 "raise 위상의 J7 기울기"에만 영향을
  // 주고 strike의 타격점(j7Strike 포함 전체 포즈)은 절대 건드리지 않는다.
  // stickJ7Offset은 baseRaw(부호 반영 전, 왼팔 기준 음수)에 직접 더해지므로
  // 왼팔은 자동으로 음수 방향, 오른팔은 부호가 뒤집혀 양수 방향으로 적용된다.
  // cockScale 0.8: 과도한 손목 스윙(팁이 1m 가까이 치솟는 현상) 억제
  // → 전환 시 스틱이 인접 드럼을 스치는 문제 해소 (실측 검증)
  //
  // 스윙 계산은 j7Strike(접촉각 보정으로 이동했을 수 있음)가 아니라
  // nominalJ7(속도·스타일로만 정해지는 원래 값)을 기준으로 한다 — 그래야
  // 접촉각 보정 폭(contactDelta)이 얼마든 raise↔strike 스윙 크기는 항상
  // 그대로다. contactDelta는 strike·raise·rebound 전부에 똑같이 더해서
  // "타격점 자체가 이동"한 효과만 내고 스윙에는 영향을 주지 않는다.
  if (phase === 'raise' || phase === 'rebound') {
    const baseRaw  = ({ raise: -0.86, rebound: -0.54 })[phase] * styleScale - stickJ7Offset;
    const j7Phase  = s === 'L' ? baseRaw : -baseRaw;
    const velScale = phase === 'raise'
      ? clamp(vs.raiseZ, 0.55, 1.35)
      : clamp(vs.rebZ,   0.50, 1.30);
    const cockScale = 0.8 * velScale;
    const nominal  = nominalJ7 ?? j7Strike;
    const delta    = contactDelta ?? 0;
    pose[`${s}7`] = nominal + (j7Phase - nominal) * cockScale + delta;
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

const _SIDE_KEYS = { L: ['L1','L2','L3','L4','L5','L6','L7'], R: ['R1','R2','R3','R4','R5','R6','R7'] };
function _sidePick(pose, side) {
  const out = {};
  _SIDE_KEYS[side].forEach(k => { out[k] = pose[k]; });
  return out;
}

/** 해당 팔의 가장 이른 타격 이벤트(드럼·세기) — 킥 제외. 이벤트 없으면 null */
function _firstArmHit(arm) {
  let best = null;
  timelineEvents.forEach(evt => {
    const drum = drumKit.find(d => d.id === evt.drumId);
    if (!drum || drum.type === 'kick' || drum.arm !== arm) return;
    if (!best || evt.beat < best.evt.beat) best = { evt, drum };
  });
  return best ? { drum: best.drum, vel: best.evt.vel ?? 'medium' } : null;
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

        // 중심선 안전 여유: 피크(팔꿈치를 굽혀 드럼 사이를 넘어가는 구간)에서
        // 팁이 몸 중심선(Y=0)에 너무 가까워지면 반대팔과 부딪힐 수 있다
        // (실측: 양팔이 동시에 피크를 지나며 5~6cm까지 근접). 정밀 타격점이
        // 아니라 통과 지점이므로 위치 오차는 문제없어, J3(가장 큰 레버리지)를
        // 살짝 움직여 자기 팔 쪽으로 밀어낸다. 방향은 하드코딩하지 않고
        // 매번 작게 찔러봐서(probe) 실제로 안전 방향인 쪽으로만 이동한다.
        const MIN_PEAK_Y = 0.12;
        const wantSign   = arm === 'L' ? 1 : -1;
        const j3Key      = `${arm}3`;
        const [j3Lo, j3Hi] = _IK_LIMITS[j3Key] ?? [-PI, PI];
        let peakFK = _pureFKStick(peak, arm);
        if (peakFK.tip.y * wantSign < MIN_PEAK_Y) {
          const probeStep = 0.02;
          const probeV = clamp(peak[j3Key] + probeStep, j3Lo, j3Hi);
          const probeFK = _pureFKStick({ ...peak, [j3Key]: probeV }, arm);
          const dir = Math.sign((probeFK.tip.y - peakFK.tip.y) * wantSign) || 1;
          for (let iter = 0; iter < 40; iter++) {
            const nextV = clamp(peak[j3Key] + dir * probeStep, j3Lo, j3Hi);
            if (nextV === peak[j3Key]) break;   // 관절 한계 도달
            peak[j3Key] = nextV;
            peakFK = _pureFKStick(peak, arm);
            if (peakFK.tip.y * wantSign >= MIN_PEAK_Y) break;
          }
        }

        addPose(poseMap, peakT, peak, sideKeys);

        // 피크 이후 다음 타격 직전까지 남는 시간 안에서 raise(B)를 한 번 더 찍는다.
        // 이렇게 하면 다른 드럼으로 넘어갈 때도 마지막 진입 구간만큼은 J1~J6 고정 +
        // J7만 움직이는 손목 스냅이 되어 수직으로 내려친다(연타 시의 raise→strike와 동일 원리).
        // 이게 없으면 피크(중간 평균 자세)에서 곧장 strike(B)로 가며 여러 조인트가
        // 동시에 움직여 "비스듬히 빗겨치는" 느낌이 난다.
        const availGap  = next.t - peakT;
        const raiseLead = Math.min(preDur, availGap * 0.7);
        const raiseBT   = parseFloat((next.t - raiseLead).toFixed(3));
        if (raiseLead > 0.03 && raiseBT > peakT) {
          addPose(poseMap, raiseBT, posB, sideKeys);
        }
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
    const bus  = _makeDrumBus(ctx);
    const bd   = 60 / bpm;
    const iOff = _getAudioTimeOffset(); // 인트로 오프셋

    // ── 드럼 합성음 스케줄 ─────────────────────────────────────
    timelineEvents.forEach(evt => {
      const drum = drumKit.find(d => d.id === evt.drumId);
      if (!drum) return;
      const hitT = (evt.beat - 1) * bd + iOff;
      if (hitT < 0 || hitT >= totalDur) return;
      const fn = _drumSounds[drum.type] || _drumSounds.tom_m;
      fn(hitT, ctx, undefined, bus);
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
  updateJointHud(angles);
}

function updateJointHud(angles) {
  ['L','R'].forEach(s => {
    const el = document.getElementById(`joint-${s.toLowerCase()}`);
    if (!el) return;
    const txt = [1,2,3,4,5,6,7].map(i => {
      const v = angles[`${s}${i}`] ?? 0;
      return `J${i}${v>=0?'+':''}${v.toFixed(2)}`;
    }).join(' ');
    el.textContent = txt;
  });
}

// ═══════════════════════════════════════════════════════════════
//  드럼 사운드 합성 (Web Audio — 외부 파일 없이 합성음 사용)
// ═══════════════════════════════════════════════════════════════
let _drumAudioCtx  = null;
let _drumMasterBus = null;
let _drumSoundOn   = true;

function _getDrumCtx() {
  if (!_drumAudioCtx) {
    _drumAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    _drumMasterBus = _makeDrumBus(_drumAudioCtx);
  }
  if (_drumAudioCtx.state === 'suspended') _drumAudioCtx.resume();
  return _drumAudioCtx;
}
// 여러 파셜/노이즈 레이어가 겹쳐도 뭉개지지 않도록 컴프레서를 하나 거쳐
// destination으로 보낸다. 오프라인(WAV 내보내기) 컨텍스트는 매번 새로
// 만들어지므로 그때그때 별도로 하나 만들어 쓴다(_drumSounds 쪽은 dest를
// 인자로 받아 양쪽 다 대응).
function _makeDrumBus(c) {
  const comp = c.createDynamicsCompressor();
  // 임계값을 높이고(덜 자주 눌림) release를 짧게 해서, 라이드처럼 길게
  // 우는 소리 직후에 오는 스네어 등이 눌려서 작게 들리는 문제를 줄인다.
  comp.threshold.value = -10; comp.knee.value = 6;
  comp.ratio.value = 3; comp.attack.value = 0.002; comp.release.value = 0.06;
  comp.connect(c.destination);
  return comp;
}

// ── 저수준 합성 유틸 ──────────────────────────────────────────
// 실제 어쿠스틱 드럼은 (1) 스틱이 헤드에 부딪히는 순간의 짧은 클릭
// 트랜지언트, (2) 헤드/셸이 진동하는 여러 개의 비조화(inharmonic) 파셜,
// (3) 스네어 와이어 등의 노이즈 성분이 겹쳐서 소리를 만든다. 기존엔
// 오실레이터 1개(피치 스윕)나 필터 노이즈 1개만 써서 "전자음" 느낌이
// 강했다 — 아래 유틸로 이 세 요소를 조합해 좀 더 어쿠스틱하게 만든다.

// 스틱 임팩트 클릭 — 아주 짧은 광대역 노이즈
function _synthClick(c, dest, t, gain, dur = 0.006) {
  const buf = c.createBuffer(1, Math.ceil(c.sampleRate * dur), c.sampleRate);
  const d   = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource(), hp = c.createBiquadFilter(), g = c.createGain();
  src.buffer = buf; src.connect(hp); hp.connect(g); g.connect(dest);
  hp.type = 'highpass'; hp.frequency.value = 2500;
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
  src.start(t); src.stop(t + dur + 0.005);
}
// 드럼 헤드/셸의 진동 — 여러 사인 파셜을 서로 다른 배음비·감쇠로 겹친다.
// partials: [{ratio, decay, level, drop}] — ratio는 f0 대비 배수(비조화),
// drop이 있으면 그 파셜도 짧게 피치가 떨어진다(때림 직후의 "보잉" 느낌).
function _synthPartials(c, dest, t, f0, dur, gain, partials) {
  partials.forEach(p => {
    const osc = c.createOscillator(), g = c.createGain();
    osc.connect(g); g.connect(dest);
    osc.type = 'sine';
    const freq = f0 * p.ratio;
    if (p.drop) {
      osc.frequency.setValueAtTime(freq * p.drop, t);
      osc.frequency.exponentialRampToValueAtTime(freq, t + dur * 0.6);
    } else {
      osc.frequency.setValueAtTime(freq, t);
    }
    const pd = dur * (p.decay ?? 1);
    g.gain.setValueAtTime(gain * p.level, t);
    g.gain.exponentialRampToValueAtTime(0.0005, t + pd);
    osc.start(t); osc.stop(t + pd + 0.01);
  });
}
// 필터링된 노이즈 레이어(심벌/스네어 노이즈 성분) — dest를 받아 라이브/
// 오프라인 컨텍스트 양쪽에서 재사용 가능
function _synthNoiseLayer(c, dest, t, filterType, freq, Q, dur, gain) {
  const buf = c.createBuffer(1, Math.ceil(c.sampleRate * dur), c.sampleRate);
  const d   = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
  src.buffer = buf; src.connect(f); f.connect(g); g.connect(dest);
  f.type = filterType; f.frequency.value = freq; f.Q.value = Q;
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
  src.start(t); src.stop(t + dur + 0.01);
}

const _drumSounds = {
  // 킥: 임팩트 클릭 + 서브 피치 스윕(빠른 초반 하강으로 펀치감) + 배음 2개
  // (저역 서브 + 셸이 울리는 중역 바디감 추가)
  kick(t, c, g = 0.9, dest) {
    const d = dest || c.destination;
    _synthClick(c, d, t, g * 0.35, 0.004);
    _synthPartials(c, d, t, 62, 0.30, g, [
      { ratio: 1,    level: 1.0,  decay: 1.0,  drop: 2.4 },
      { ratio: 2.4,  level: 0.18, decay: 0.35 },
      { ratio: 3.6,  level: 0.08, decay: 0.2 },
    ]);
  },
  // 플로어 탐: 킥보다 높은 톤 + 배음 3개(비조화 비율)로 "통 울림" 표현
  tom_f(t, c, g = 0.8, dest) {
    const d = dest || c.destination;
    _synthClick(c, d, t, g * 0.25, 0.005);
    _synthPartials(c, d, t, 95, 0.32, g, [
      { ratio: 1,    level: 1.0,  decay: 1.0,  drop: 1.7 },
      { ratio: 1.63, level: 0.35, decay: 0.55 },
      { ratio: 2.31, level: 0.16, decay: 0.35 },
      { ratio: 3.12, level: 0.07, decay: 0.22 },
    ]);
  },
  // 스네어: 배음 3개 + 긴 피치 글라이드 조합이 꽹과리/종처럼 들렸다 —
  // 실제 스네어는 셸 톤이 아주 짧게 "툭"하고 끝나고 와이어 노이즈가
  // 주도해야 한다. 배음을 기본음 하나로 줄이고 아주 짧게(45ms), 피치
  // 글라이드도 살짝만 남기고, 노이즈 쪽 비중과 밝기를 더 키웠다.
  snare(t, c, g = 1.0, dest) {
    const d = dest || c.destination;
    _synthClick(c, d, t, g * 0.6, 0.005);
    _synthPartials(c, d, t, 180, 0.045, g * 0.3, [
      { ratio: 1, level: 1.0, decay: 1.0, drop: 1.15 },
    ]);
    _synthNoiseLayer(c, d, t, 'bandpass', 2600, 0.7, 0.11, g);
    _synthNoiseLayer(c, d, t, 'bandpass', 1200, 1.0, 0.16, g * 0.55);
    _synthNoiseLayer(c, d, t, 'highpass', 6000, 0.6, 0.06, g * 0.45);
  },
  // 스몰/미들 탐: 배음 3~4개로 통 울림, 스몰이 미들보다 배음 비율이 촘촘
  tom_h(t, c, g = 0.7, dest) {
    const d = dest || c.destination;
    _synthClick(c, d, t, g * 0.22, 0.004);
    _synthPartials(c, d, t, 200, 0.24, g, [
      { ratio: 1,    level: 1.0,  decay: 1.0,  drop: 1.5 },
      { ratio: 1.72, level: 0.3,  decay: 0.5 },
      { ratio: 2.4,  level: 0.14, decay: 0.3 },
      { ratio: 3.24, level: 0.06, decay: 0.18 },
    ]);
  },
  tom_m(t, c, g = 0.7, dest) {
    const d = dest || c.destination;
    _synthClick(c, d, t, g * 0.22, 0.005);
    _synthPartials(c, d, t, 135, 0.27, g, [
      { ratio: 1,    level: 1.0,  decay: 1.0,  drop: 1.6 },
      { ratio: 1.66, level: 0.32, decay: 0.5 },
      { ratio: 2.35, level: 0.14, decay: 0.3 },
      { ratio: 3.18, level: 0.06, decay: 0.18 },
    ]);
  },
  // 하이햇(클로즈드): 겹친 고역 노이즈 밴드 여러 개 + 아주 짧은 감쇠로
  // "치익" 하는 타격감. 금속성 느낌을 위해 좁은 대역 몇 개를 겹치고,
  // 아주 짧고 조용한 비조화 파셜 2개를 얹어 순수 노이즈보다 금속감을 더한다.
  hihat(t, c, g = 0.45, dest) {
    const d = dest || c.destination;
    _synthClick(c, d, t, g * 0.3, 0.003);
    _synthNoiseLayer(c, d, t, 'highpass', 9000,  0.9, 0.05, g * 0.8);
    _synthNoiseLayer(c, d, t, 'bandpass', 11500, 3.0, 0.045, g * 0.4);
    _synthNoiseLayer(c, d, t, 'bandpass', 7200,  4.0, 0.04, g * 0.3);
    _synthPartials(c, d, t, 3100, 0.045, g * 0.12, [
      { ratio: 1,    level: 1.0, decay: 1.0 },
      { ratio: 2.76, level: 0.6, decay: 0.7 },
    ]);
  },
  // 크래시: 넓게 퍼지는 비조화 노이즈 레이어(저역 바디+고역 쉬머) + 은은한
  // 금속 파셜 몇 개로 "챙~" 하는 잔향 표현
  crash(t, c, g = 0.5, dest) {
    const d = dest || c.destination;
    _synthClick(c, d, t, g * 0.3, 0.006);
    _synthNoiseLayer(c, d, t, 'bandpass', 3200, 0.5, 0.75, g * 0.55);
    _synthNoiseLayer(c, d, t, 'bandpass', 6000, 0.4, 0.85, g * 0.5);
    _synthNoiseLayer(c, d, t, 'highpass', 8500, 0.8, 0.65, g * 0.35);
    _synthPartials(c, d, t, 420, 0.6, g * 0.25, [
      { ratio: 1,    level: 1.0, decay: 1.0 },
      { ratio: 1.41, level: 0.6, decay: 0.9 },
      { ratio: 2.03, level: 0.4, decay: 0.7 },
    ]);
  },
  // 라이드: 이전엔 배음이 3개뿐이고 정수비에 가까워 "종/깡통"처럼 들렸다.
  // 실제 심벌은 배음이 훨씬 촘촘하고 비조화적이며, 노이즈(쉼머)가 톤보다
  // 우세해야 "금속판" 느낌이 난다 — 배음을 6개로 늘리고 비조화 비율로,
  // 레벨은 낮춰서 노이즈 워시 위에 살짝 얹히는 "핑"으로만 남긴다.
  ride(t, c, g = 0.2, dest) {
    const d = dest || c.destination;
    _synthClick(c, d, t, g * 0.2, 0.004);
    _synthNoiseLayer(c, d, t, 'highpass', 6500, 0.7, 0.4,  g * 0.55);
    _synthNoiseLayer(c, d, t, 'bandpass', 9200, 0.5, 0.32, g * 0.38);
    _synthNoiseLayer(c, d, t, 'bandpass', 4200, 0.6, 0.22, g * 0.22);
    _synthPartials(c, d, t, 780, 0.4, g * 0.22, [
      { ratio: 1,    level: 1.0,  decay: 1.0 },
      { ratio: 1.83, level: 0.55, decay: 0.85 },
      { ratio: 2.62, level: 0.4,  decay: 0.7 },
      { ratio: 3.44, level: 0.3,  decay: 0.55 },
      { ratio: 4.28, level: 0.2,  decay: 0.4 },
      { ratio: 5.11, level: 0.13, decay: 0.3 },
    ]);
  },
};

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
    fn(c.currentTime + 0.005, c, undefined, _drumMasterBus);
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
 *  0.00s: neutral          — 시작
 *  1.30s: armSpreadPose    — 양팔 옆으로 최대 벌림 (충돌 없는 후퇴)
 *  2.75s: firstRaisePose   — 첫 드럼을 향해 회전 + 코킹(raise, J7)까지 완료
 *  3.00s: firstRaisePose   — 홀드
 *  3.30s: breathe in (+0.04)
 *  3.70s: breathe out      — 정지 (firstRaisePose 그대로)
 *  4.00s: firstStrikePose  — ▶ 손목(J7)만 움직여 내려치기 — 일반 타격과 동일한 수직 스냅
 *
 *  raise→strike 구간은 J1~J6이 firstRaisePose와 완전히 동일하고 J7만 달라지므로,
 *  두 번째 타격부터의 raise→strike와 똑같은 수직 궤적으로 보인다.
 *  팔 방향 전환(J1~J6)이라는 "무거운" 움직임은 1.30~3.70s의 여유 구간에서 끝내고,
 *  마지막 0.3초는 순수 손목 스냅만 남기는 것이 핵심.
 *
 *  smoothstep 보간: 각 구간이 S곡선으로 자연스럽게 연결됨
 */
function createDrumIntroTimeline(firstRaisePose, firstStrikePose, preset, styleId = 'spread') {
  const nu = _arrToAngles(preset.neutralPose);
  const style = (typeof INTRO_STYLES !== 'undefined' && INTRO_STYLES[styleId]) || {};

  // firstRaisePose 도달 이후(2.75~4.00s)는 스타일과 무관하게 항상 동일 —
  // 어떤 스타일을 골라도 실제 첫 타격 시작 위치·타이밍은 그대로 유지된다.
  const tail = [
    { time: 2.75, angles: firstRaisePose                     },  // 첫 드럼 방향으로 회전 + 코킹
    { time: 3.00, angles: firstRaisePose                     },  // 홀드
    { time: 3.30, angles: _breathePose(firstRaisePose, +0.04)},  // 숨 들이쉬기
    { time: 3.70, angles: firstRaisePose                     },  // 숨 내쉬기 → 정지
    { time: 4.00, angles: firstStrikePose                    },  // ▶ 손목 스냅으로 내려치기
  ];

  if (styleId === 'retreat' && style.poseA && style.poseB) {
    const poseA = _arrToAngles(style.poseA);
    const poseB = _arrToAngles(style.poseB);
    return [
      { time: 0.00, angles: nu    },
      { time: 1.00, angles: poseA },  // J1 후인 + J7 들어올림
      { time: 1.65, angles: poseB },  // J1만 복귀
      ...tail,
    ];
  }

  if (styleId === 'xstrike' && style.crossPose) {
    // 앞에 드럼이 있으므로 진입은 retreat 스타일(poseA/poseB)을 그대로
    // 재사용 — armSpreadPose처럼 neutral→cross 직행이 드럼과 부딪힐 수 있음.
    const retreatStyle = (typeof INTRO_STYLES !== 'undefined' && INTRO_STYLES.retreat) || {};
    const poseA = _arrToAngles(retreatStyle.poseA || style.crossPose);
    const poseB = _arrToAngles(retreatStyle.poseB || style.crossPose);
    const cross = _arrToAngles(style.crossPose);

    // 스틱을 쥔 두 팔이 동시에 교차 자세로 들어가면 궤적이 겹칠 수 있어(서로
    // 통과 불가) 왼팔이 먼저 들어가 고정하고, 오른팔이 그 앞을 가로질러
    // 들어가며 코킹 없이 곧바로 타격 각도로 도착(속도감). 그다음 왼팔은
    // 이미 제자리에 있으므로 손목만 스냅해 2번째 타격.
    const leftInCross = { ...poseB,
      L1: cross.L1, L2: cross.L2, L3: cross.L3, L4: cross.L4, L7: cross.L7 };
    const rightStrike = { ...leftInCross,
      R1: cross.R1, R2: cross.R2, R3: cross.R3, R4: cross.R4, R7: style.strikeR7 };
    const leftStrike  = { ...rightStrike, L7: style.strikeL7 };

    return [
      { time: 0.00, angles: nu          },
      { time: 0.55, angles: poseA       },  // 후인 + 손목 들기(공통 진입)
      { time: 0.90, angles: poseB       },  // J1 복귀
      { time: 1.30, angles: leftInCross },  // 왼팔 먼저 교차 자세로 진입 + 고정
      { time: 1.65, angles: rightStrike },  // 오른팔이 앞을 가로질러 들어가며 1번째 타격
      { time: 2.00, angles: leftStrike  },  // 왼팔 손목 스냅 — 2번째 타격
      ...tail,
    ];
  }

  // 기본(spread): 팔 양옆 벌림
  const as = _arrToAngles(preset.armSpreadPose ?? preset.rearClearPose); // 하위 호환
  return [
    { time: 0.00, angles: nu },
    { time: 1.30, angles: as },  // 팔 양옆 벌림
    ...tail,
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
          introOutroPresetId = 'default', introStyleId = 'spread' } = options;

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
    // 각 팔의 실제 첫 타격 드럼에 대해 raise/strike 포즈를 직접 계산
    // (해당 팔이 아예 연주하지 않으면 frontReadyPose로 대기)
    const { L: READY_L, R: READY_R } = _getReadyPoses();
    const hitL = _firstArmHit('L');
    const hitR = _firstArmHit('R');
    const raiseL  = hitL ? computeStrikePose(hitL.drum, 'raise',  hitL.vel) : null;
    const strikeL = hitL ? computeStrikePose(hitL.drum, 'strike', hitL.vel) : null;
    const raiseR  = hitR ? computeStrikePose(hitR.drum, 'raise',  hitR.vel) : null;
    const strikeR = hitR ? computeStrikePose(hitR.drum, 'strike', hitR.vel) : null;

    const firstRaisePose = {
      ...READY_L, ...READY_R,
      ...(raiseL ? _sidePick(raiseL, 'L') : {}),
      ...(raiseR ? _sidePick(raiseR, 'R') : {}),
    };
    const firstStrikePose = {
      ...firstRaisePose,
      ...(strikeL ? _sidePick(strikeL, 'L') : {}),
      ...(strikeR ? _sidePick(strikeR, 'R') : {}),
    };

    const intro   = createDrumIntroTimeline(firstRaisePose, firstStrikePose, preset, introStyleId);
    const shifted = shiftTimeline(drumTL, 4.0);
    // shifted[0] = drumTL의 첫 프레임(대개 preLift/strike 혼재) → intro 마지막(firstStrikePose)이
    // 이를 대체하므로 제거(slice(1))
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
  const introStyleId = document.getElementById('intro-style-sel')?.value || 'spread';
  return (inclIntro || inclOutro)
    ? buildTimelineWithIntroOutro({ includeIntro: inclIntro, includeOutro: inclOutro, introStyleId })
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

// 정지/일시정지 상태에서 편집(강도 변경·스트로크 튜닝 등) 직후 현재 위치의
// 포즈를 즉시 다시 그린다. 재생 중엔 animate() 루프가 매 프레임 갱신하므로
// 호출되지 않는다. 미리보기 애니메이션 중엔 animate()와 동일하게 덮어쓰기 방지.
function renderFrame(t) {
  if (window._drumPreviewActive) return;
  updateFK(interpolateAngles(t, _playKFs));
}

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
//  드럼 오디오 분석 → 타임라인 자동 생성
//  (온셋 검출 → 템포 추정 → 대역 분류 → 마디 반복 보정 → 3단계 밀도 생성)
//  "🎵 음악 로드"(배경 재생용)와는 완전히 별개 기능 — 여기선 오디오 자체를
//  분석해 실제 타격 타임라인을 만든다.
// ═══════════════════════════════════════════════════════════════
let _daResult = null; // { bpm, beatsPerBar, totalBars, durationSec, onsetCount, tiers, fileName, audioBuffer }

window.analyzeDrumAudio = function (input) {
  const file = input.files[0];
  if (!file) return;
  const nameEl = document.getElementById('drum-audio-name');
  if (nameEl) nameEl.textContent = file.name;

  document.getElementById('drum-analysis-modal').style.display = 'flex';
  document.getElementById('drum-analysis-content').innerHTML = '<div class="da-progress">분석 중... (곡 길이에 따라 몇 초~수십 초 걸릴 수 있습니다)</div>';

  const reader = new FileReader();
  reader.onload = async e => {
    try {
      if (!_audioCtx) _audioCtx = new AudioContext();
      const buf = await _audioCtx.decodeAudioData(e.target.result.slice(0));
      const result = await _runDrumAnalysis(buf, _audioCtx);
      result.fileName = file.name;
      result.audioBuffer = buf;
      result.sourceLabel = '오디오 분석';
      _daResult = result;
      _renderDrumAnalysisResult(result);
    } catch (err) {
      document.getElementById('drum-analysis-content').innerHTML =
        `<div class="val-err">분석 실패: ${err.message}</div>`;
    }
  };
  reader.readAsArrayBuffer(file);
};

window.closeDrumAnalysis = function () {
  document.getElementById('drum-analysis-modal').style.display = 'none';
};

// ── RMS 엔벌로프 / 온셋(양의 반파 정류 미분) ────────────────────────
function _rmsEnvelope(data, hop, numFrames) {
  const e = new Float32Array(numFrames);
  for (let f = 0; f < numFrames; f++) {
    let sum = 0; const start = f * hop;
    for (let i = 0; i < hop; i++) { const v = data[start + i] || 0; sum += v * v; }
    e[f] = Math.sqrt(sum / hop);
  }
  return e;
}
function _halfWaveFlux(env) {
  const flux = new Float32Array(env.length);
  for (let i = 1; i < env.length; i++) { const d = env[i] - env[i - 1]; flux[i] = d > 0 ? d : 0; }
  return flux;
}
// 적응형 임계값(±300ms 지역 평균+1.5*표준편차) + 최소 간격 60ms 피크 피킹
function _pickOnsets(flux, frameSec) {
  const n = flux.length;
  const winFrames = Math.round(0.3 / frameSec);
  const minSpacingFrames = Math.round(0.06 / frameSec);
  const onsets = [];
  for (let i = 2; i < n - 2; i++) {
    const lo = Math.max(0, i - winFrames), hi = Math.min(n, i + winFrames);
    let sum = 0, sumSq = 0; const cnt = hi - lo;
    for (let k = lo; k < hi; k++) { sum += flux[k]; sumSq += flux[k] * flux[k]; }
    const mean = sum / cnt, variance = sumSq / cnt - mean * mean, std = Math.sqrt(Math.max(0, variance));
    const thresh = mean + 1.5 * std + 0.001;
    if (flux[i] > thresh && flux[i] >= flux[i - 1] && flux[i] >= flux[i + 1] && flux[i] > flux[i - 2] && flux[i] > flux[i + 2]) onsets.push(i);
  }
  const filtered = [];
  for (const idx of onsets) {
    if (!filtered.length) { filtered.push(idx); continue; }
    const last = filtered[filtered.length - 1];
    if (idx - last < minSpacingFrames) { if (flux[idx] > flux[last]) filtered[filtered.length - 1] = idx; }
    else filtered.push(idx);
  }
  return filtered;
}

// ── 템포 추정: flux 자기상관 + 그리드 정합도로 옥타브(절반/2배) 모호성 해소 ──
function _estimateTempo(flux, frameSec, onsetTimes) {
  const n = flux.length;
  const minBPM = 60, maxBPM = 200;
  const minLag = Math.round((60 / maxBPM) / frameSec);
  const maxLag = Math.round((60 / minBPM) / frameSec);
  const acf = new Float32Array(Math.max(1, maxLag - minLag + 1));
  for (let lag = minLag; lag <= maxLag; lag++) {
    let sum = 0;
    for (let i = 0; i < n - lag; i++) sum += flux[i] * flux[i + lag];
    acf[lag - minLag] = sum;
  }
  const peaks = [];
  for (let i = 1; i < acf.length - 1; i++) {
    if (acf[i] > acf[i - 1] && acf[i] > acf[i + 1]) {
      const lag = i + minLag;
      peaks.push({ bpm: 60 / (lag * frameSec), strength: acf[i] });
    }
  }
  peaks.sort((a, b) => b.strength - a.strength);
  if (!peaks.length || !onsetTimes.length) return 120;
  const top = peaks.slice(0, 6);
  function gridResidual(bpmCand) {
    const sixteenth = 60 / bpmCand / 4;
    let sumDev = 0;
    for (const t of onsetTimes) { const rem = t % sixteenth; sumDev += Math.min(rem, sixteenth - rem) / sixteenth; }
    return sumDev / onsetTimes.length;
  }
  let best = top[0], bestRes = gridResidual(top[0].bpm);
  for (const p of top.slice(1)) {
    const res = gridResidual(p.bpm);
    if (res < bestRes - 0.005) { best = p; bestRes = res; } // 명확히 더 좋은 정합일 때만 교체(동률이면 자기상관 세기가 높은 후보 유지)
  }
  return best.bpm;
}

// ── 주파수 대역 분리(킥/스네어·탐 바디/스네어 크랙/하이햇·심벌) ──────────
// 대역별 특성 주파수에 맞춰 엔벌로프 측정 윈도우 크기를 다르게 함(저역일수록
// 윈도우가 짧으면 파형 1주기도 못 담아 노이즈처럼 흔들리는 문제가 실측으로
// 확인됨 — 킥 16ms/미드 6ms/크랙 3ms/하이 2ms로 보정 후 분류 균형이 개선됨).
async function _splitBands(ctx, monoBuf, sr) {
  async function renderBand(setupFn) {
    const oac = new OfflineAudioContext(1, monoBuf.length, sr);
    const src = oac.createBufferSource(); src.buffer = monoBuf;
    const outNode = setupFn(oac, src);
    outNode.connect(oac.destination);
    src.start();
    const rendered = await oac.startRendering();
    return rendered.getChannelData(0);
  }
  function makeBand(data, winMs) {
    const w = Math.max(1, Math.round(sr * winMs / 1000));
    const numF = Math.floor(data.length / w);
    const e = new Float32Array(numF);
    for (let f = 0; f < numF; f++) {
      let sum = 0; const start = f * w;
      for (let i = 0; i < w; i++) { const v = data[start + i] || 0; sum += v * v; }
      e[f] = Math.sqrt(sum / w);
    }
    const fl = new Float32Array(numF);
    let max = 0;
    for (let i = 1; i < numF; i++) { const d = e[i] - e[i - 1]; fl[i] = d > 0 ? d : 0; if (fl[i] > max) max = fl[i]; }
    return { flux: fl, w, max: max || 1 };
  }

  const kickData  = await renderBand((oac, src) => { const lp = oac.createBiquadFilter(); lp.type = 'lowpass';  lp.frequency.value = 150;  lp.Q.value = 0.7; src.connect(lp); return lp; });
  const midData   = await renderBand((oac, src) => { const bp = oac.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 450;  bp.Q.value = 0.8; src.connect(bp); return bp; });
  const crackData = await renderBand((oac, src) => { const bp = oac.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 3500; bp.Q.value = 0.7; src.connect(bp); return bp; });
  const hiData    = await renderBand((oac, src) => { const hp = oac.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 6000; hp.Q.value = 0.7; src.connect(hp); return hp; });

  return {
    kick:  makeBand(kickData, 16),
    mid:   makeBand(midData, 6),
    crack: makeBand(crackData, 3),
    hi:    makeBand(hiData, 2),
  };
}

// ── 온셋별 대역 점수 샘플링 + 드럼 타입 분류 ─────────────────────────
function _sampleBandAt(band, tSec, sr, radiusMs) {
  const frameIdx = Math.round((tSec * sr) / band.w);
  const radiusFrames = Math.max(1, Math.round(radiusMs / (band.w / sr * 1000)));
  let best = 0;
  for (let d = -radiusFrames; d <= radiusFrames; d++) {
    const idx = frameIdx + d;
    if (idx >= 0 && idx < band.flux.length) best = Math.max(best, band.flux[idx]);
  }
  return best / band.max;
}
// 4개 대역(킥/미드/크랙/하이) 점수만으로 7종 드럼 타입을 추정하는 v1 휴리스틱.
// 킥·스네어·탐의 저역대가 실제로 겹쳐서 완벽한 분리는 어렵고, 하이햇/라이드
// 구분은 현재 대역 설계로는 신호가 부족해 하이 우세 시 기본적으로 hihat으로
// 처리한다(실측 검증 시 확인된 한계 — 추후 청음 튜닝 대상).
function _classifyBandScores(k, m, c, h) {
  // 크래시: 크랙+하이가 동시에 강하게 뜨는 경우 우선 처리(밝고 오래 울리는 심벌)
  if (c > 0.45 && h > 0.45) return 'crash';
  // 그 외엔 4개 대역 중 최댓값(argmax)으로 분류 — 실측 검증 시 임계값 캐스케이드보다
  // argmax 방식이 킥으로 쏠리는 오분류가 훨씬 적었다(캐스케이드는 애매한 경우 전부
  // 마지막 fallback인 킥으로 떨어지는 버그가 있었음).
  const bands = [['kick', k], ['mid', m], ['crack', c], ['hi', h]];
  bands.sort((a, b) => b[1] - a[1]);
  const top = bands[0][0];
  if (top === 'hi') return 'hihat';
  if (top === 'crack') return 'snare';
  if (top === 'kick') return 'kick';
  // mid 우세 → 킥 성분이 섞인 정도로 탐(저음일수록 플로어탐) vs 스네어 구분
  if (k > 0.25) {
    if (k > 0.42) return 'tom_f';
    if (k > 0.32) return 'tom_m';
    return 'tom_h';
  }
  return 'snare';
}
function _classifyOnsets(onsetTimes, bands, sr) {
  return onsetTimes.map(t => {
    const k = _sampleBandAt(bands.kick, t, sr, 15);
    const m = _sampleBandAt(bands.mid, t, sr, 10);
    const c = _sampleBandAt(bands.crack, t, sr, 8);
    const h = _sampleBandAt(bands.hi, t, sr, 8);
    return { t, k, m, c, h, type: _classifyBandScores(k, m, c, h) };
  });
}

// ── 마디 반복 기반 다수결 보정 ───────────────────────────────────────
// 같은 마디-내 위치(1/16 그리드)에 반복적으로 나타나는 타격들을 모아, 압도적
// 다수(65%+, 최소 4회 반복)가 동의하는 타입이 있을 때만 "확신도가 낮았던"
// 개별 타격의 분류를 그 타입으로 교정한다.
// 주의: 실측해보니 단순 과반(50%)만으로 전부 교체하면, 곡 전체에서 가장 흔한
// 타입(예: 킥)이 우연히 여러 슬롯에서도 다수를 차지해 오히려 다양성 있는
// 정확한 개별 분류까지 지워버리는 역효과가 나타났다(1184개 중 284개가 전부
// 킥으로 획일화됨). 그래서 이미 확신도 높은(1위·2위 대역 점수 차이>0.15)
// 개별 분류는 다수결과 달라도 건드리지 않고, 애매했던 것만 보정 대상으로 좁혔다.
function _refineByRepetition(classified, estBpm, beatsPerBarLocal) {
  const beatDur = 60 / estBpm;
  const barDur = beatDur * beatsPerBarLocal;
  const slotsPerBar = beatsPerBarLocal * 4; // 1/16 그리드
  const buckets = new Map();
  classified.forEach(hit => {
    const posInBar = ((hit.t % barDur) + barDur) % barDur / barDur;
    const bin = Math.round(posInBar * slotsPerBar) % slotsPerBar;
    if (!buckets.has(bin)) buckets.set(bin, []);
    buckets.get(bin).push(hit);
  });
  buckets.forEach(hits => {
    if (hits.length < 4) return;
    const tally = {};
    hits.forEach(h => { tally[h.type] = (tally[h.type] || 0) + 1; });
    let majType = null, majCount = 0;
    Object.entries(tally).forEach(([type, count]) => { if (count > majCount) { majType = type; majCount = count; } });
    if (majCount / hits.length < 0.65) return;
    hits.forEach(h => {
      if (h.type === majType) return;
      const scores = [h.k, h.m, h.c, h.h].sort((a, b) => b - a);
      if (scores[0] - scores[1] > 0.15) return; // 원분류 확신도가 높으면 유지
      h.type = majType;
    });
  });
}

// ── 분류 결과 → 타격 리스트(마디/박자 좌표계) + 중요도 점수 ────────────
function _classifiedToHits(classified, estBpm) {
  const beatDur = 60 / estBpm;
  return classified.map(h => {
    const beat = 1 + h.t / beatDur;
    const loud = Math.max(h.k, h.m, h.c, h.h);
    const fracBeat = ((beat - 1) % 1 + 1) % 1;
    const onDownbeat = fracBeat < 0.05 || fracBeat > 0.95;
    const onHalfbeat = Math.abs(fracBeat - 0.5) < 0.05;
    let score = loud;
    if (onDownbeat) score += 0.5; else if (onHalfbeat) score += 0.2;
    if (h.type === 'kick' || h.type === 'snare') score += 0.3;
    return { type: h.type, beat, score, vel: loud > 0.7 ? 'hard' : (loud > 0.35 ? 'medium' : 'soft') };
  });
}

// ── 3단계 밀도 타임라인 생성(스파스/미디엄/정확) ─────────────────────
function _buildDensityTiers(hits) {
  const exact = hits.slice().sort((a, b) => a.beat - b.beat);
  const byScoreDesc = hits.slice().sort((a, b) => b.score - a.score);

  const mediumCount = Math.max(1, Math.round(hits.length * 0.55));
  const medium = byScoreDesc.slice(0, mediumCount).sort((a, b) => a.beat - b.beat);

  // 스파스: 중요도 상위 후보 중, 정수 박(quarter-beat) 슬롯당 최대 1개만 채택
  const sparseCount = Math.max(1, Math.round(hits.length * 0.22));
  const seenSlots = new Set();
  const sparse = [];
  for (const h of byScoreDesc) {
    const slot = Math.round(h.beat);
    if (seenSlots.has(slot)) continue;
    seenSlots.add(slot);
    sparse.push(h);
    if (sparse.length >= sparseCount) break;
  }
  sparse.sort((a, b) => a.beat - b.beat);

  return { sparse, medium, exact };
}

// ── 타격 리스트 → timelineEvents({drumId,beat,vel}) 변환 ────────────
// 팔(L/R/kick)별로 시간순 정렬 후, 물리적으로 너무 가까운(55ms 미만) 연속
// 타격은 중요도가 높은 쪽만 남겨 실행 불가능한 타임라인이 생기지 않게 한다.
function _hitsToTimelineEvents(hits, estBpm) {
  const beatDur = 60 / estBpm;
  const minGapBeats = 0.055 / beatDur;
  const fallbackType = { tom_h:'snare', tom_m:'snare', tom_f:'snare', crash:'hihat', ride:'hihat', hihat:'ride', snare:'tom_h' };

  const byArm = { L: [], R: [], kick: [] };
  hits.forEach(h => {
    let drum = drumKit.find(d => d.type === h.type);
    if (!drum) drum = drumKit.find(d => d.type === fallbackType[h.type]) || drumKit.find(d => d.type !== 'kick');
    if (!drum || !byArm[drum.arm]) return;
    byArm[drum.arm].push({ drumId: drum.id, beat: h.beat, vel: h.vel, score: h.score });
  });

  const events = [];
  ['L', 'R', 'kick'].forEach(arm => {
    const list = byArm[arm].sort((a, b) => a.beat - b.beat);
    let lastPushed = null;
    list.forEach(ev => {
      if (lastPushed && ev.beat - lastPushed.beat < minGapBeats) {
        if (ev.score > lastPushed.score) { lastPushed.drumId = ev.drumId; lastPushed.beat = ev.beat; lastPushed.vel = ev.vel; lastPushed.score = ev.score; }
        return;
      }
      const pushed = { drumId: ev.drumId, beat: ev.beat, vel: ev.vel, score: ev.score };
      events.push(pushed);
      lastPushed = pushed;
    });
  });
  return events.map(({ drumId, beat, vel }) => ({ drumId, beat: parseFloat(beat.toFixed(3)), vel }));
}

// ── 분석 파이프라인 총괄 ─────────────────────────────────────────────
async function _runDrumAnalysis(buf, ctx) {
  const sr = buf.sampleRate;
  const ch0 = buf.getChannelData(0);
  const ch1 = buf.numberOfChannels > 1 ? buf.getChannelData(1) : ch0;
  const n = ch0.length;
  const mono = new Float32Array(n);
  for (let i = 0; i < n; i++) mono[i] = (ch0[i] + ch1[i]) * 0.5;

  const hop = Math.round(sr * 0.005);
  const numFrames = Math.floor(n / hop);
  const frameSec = hop / sr;
  const env = _rmsEnvelope(mono, hop, numFrames);
  const flux = _halfWaveFlux(env);
  const onsetFrames = _pickOnsets(flux, frameSec);
  const onsetTimes = onsetFrames.map(i => i * frameSec);

  const estBpm = _estimateTempo(flux, frameSec, onsetTimes);
  const beatsPerBarLocal = beatsPerBar; // 현재 설정된 박자를 그대로 가정(자동 박자 감지는 미지원)

  const monoBuf = ctx.createBuffer(1, mono.length, sr);
  monoBuf.copyToChannel(mono, 0);
  const bands = await _splitBands(ctx, monoBuf, sr);

  const classified = _classifyOnsets(onsetTimes, bands, sr);
  _refineByRepetition(classified, estBpm, beatsPerBarLocal);
  const hits = _classifiedToHits(classified, estBpm);
  const densityTiers = _buildDensityTiers(hits);
  const tiers = {
    sparse: _hitsToTimelineEvents(densityTiers.sparse, estBpm),
    medium: _hitsToTimelineEvents(densityTiers.medium, estBpm),
    exact:  _hitsToTimelineEvents(densityTiers.exact, estBpm),
  };
  // 스파스/미디엄/정확 각각 몇 개 타격인지 표시용으로 별도 보관(위 변환 후 개수와 동일)
  const tierCounts = { sparse: tiers.sparse.length, medium: tiers.medium.length, exact: tiers.exact.length };

  const totalBeats = buf.duration / (60 / estBpm);
  const totalBarsNeeded = Math.min(400, Math.max(1, Math.ceil(totalBeats / beatsPerBarLocal)));
  const truncated = Math.ceil(totalBeats / beatsPerBarLocal) > 400;

  return {
    bpm: Math.round(estBpm * 100) / 100,
    beatsPerBar: beatsPerBarLocal,
    totalBars: totalBarsNeeded,
    truncated,
    durationSec: buf.duration,
    onsetCount: onsetTimes.length,
    tierCounts,
    tiers,
  };
}

// ═══════════════════════════════════════════════════════════════
//  MIDI 채보 파일 → 타임라인 자동 생성
//  드럼 종류가 노트 번호로 이미 확정돼 있어(General MIDI 드럼 맵), 오디오
//  분석의 온셋 검출·대역 분류·마디 반복 보정이 전부 필요 없다 — 노트 번호를
//  타입으로 매핑하고 벨로시티를 그대로 중요도로 쓰면 되므로 훨씬 정확하다.
//  3단계 밀도 생성(_buildDensityTiers)과 팔별 충돌 회피 변환
//  (_hitsToTimelineEvents)은 오디오 분석 경로와 동일한 함수를 그대로 재사용.
// ═══════════════════════════════════════════════════════════════
// 기본 매핑은 README의 GM 노트 맵(킥36·스네어38·하이햇42·플로어탐43·미들탐47·
// 크래시49·스몰탐50·라이드51) 그대로. 실제 파일 검증 중 README엔 없던 오픈
// 하이햇(46)이 37건 섞여 있어 전부 "hihat"으로 놓치고 있었음을 발견해 추가.
// 그 외 GM 표준에서 흔히 쓰이는 동의어 노트(킥35, 스네어40, 페달하이햇44,
// 크래시52/55/57, 라이드53/59)도 다른 곡 MIDI를 대비해 함께 매핑해 둠.
const GM_DRUM_NOTE_MAP = {
  35: 'kick',  36: 'kick',
  38: 'snare', 40: 'snare',
  42: 'hihat', 44: 'hihat', 46: 'hihat',
  43: 'tom_f',
  47: 'tom_m',
  50: 'tom_h',
  49: 'crash', 52: 'crash', 55: 'crash', 57: 'crash',
  51: 'ride',  53: 'ride',  59: 'ride',
};

// Standard MIDI File(SMF) 파서 — 헤더/트랙 청크를 읽어 노트온 이벤트와
// 템포(마이크로초/4분음표) 변화를 시간(초) 기준으로 변환해 돌려준다.
function _parseMidiFile(buf) {
  const data = new DataView(buf);
  let pos = 0;
  function u8()  { const v = data.getUint8(pos);  pos += 1; return v; }
  function u16() { const v = data.getUint16(pos); pos += 2; return v; }
  function u32() { const v = data.getUint32(pos); pos += 4; return v; }
  function chunkType() { let s = ''; for (let i = 0; i < 4; i++) s += String.fromCharCode(u8()); return s; }
  function readVLQ() {
    let value = 0, byte;
    do { byte = u8(); value = (value << 7) | (byte & 0x7f); } while (byte & 0x80);
    return value;
  }

  if (chunkType() !== 'MThd') throw new Error('MIDI 헤더(MThd)를 찾을 수 없습니다 — 올바른 .mid 파일인지 확인하세요');
  const headerLen = u32();
  const headerEnd = pos + headerLen;
  u16(); // format — 사용하지 않음(멀티트랙이어도 트랙별로 순회하므로 무관)
  const ntrks = u16();
  const division = u16();
  if (division & 0x8000) throw new Error('SMPTE 타임코드 기반 MIDI는 지원하지 않습니다');
  const ticksPerQuarter = division;
  pos = headerEnd;

  const tempoMap = [];   // { tick, usPerQuarter }
  const noteEvents = []; // { tick, channel, note, velocity }

  for (let t = 0; t < ntrks; t++) {
    if (chunkType() !== 'MTrk') throw new Error(`${t}번째 트랙에서 MTrk 청크를 찾지 못했습니다`);
    const chunkLen = u32();
    const chunkEnd = pos + chunkLen;
    let tick = 0, runningStatus = 0;
    while (pos < chunkEnd) {
      tick += readVLQ();
      let statusByte = u8();
      if (statusByte < 0x80) { pos -= 1; statusByte = runningStatus; }
      else if (statusByte < 0xF0) runningStatus = statusByte; // 채널 메시지만 러닝 스테이터스 갱신

      if (statusByte === 0xFF) {
        const metaType = u8();
        const len = readVLQ();
        const metaEnd = pos + len;
        if (metaType === 0x51 && len === 3) {
          tempoMap.push({ tick, usPerQuarter: (u8() << 16) | (u8() << 8) | u8() });
        }
        pos = metaEnd;
      } else if (statusByte === 0xF0 || statusByte === 0xF7) {
        pos += readVLQ();
      } else {
        const type = statusByte & 0xF0;
        const channel = statusByte & 0x0F;
        if (type === 0xC0 || type === 0xD0) {
          u8();
        } else {
          const d1 = u8(), d2 = u8();
          if (type === 0x90 && d2 > 0) noteEvents.push({ tick, channel, note: d1, velocity: d2 });
        }
      }
    }
    pos = chunkEnd;
  }

  if (!tempoMap.length) tempoMap.push({ tick: 0, usPerQuarter: 500000 }); // 기본 120BPM
  tempoMap.sort((a, b) => a.tick - b.tick);

  function tickToSec(targetTick) {
    let sec = 0, lastTick = 0, usPerQuarter = tempoMap[0].usPerQuarter;
    for (const tp of tempoMap) {
      if (tp.tick > targetTick) break;
      sec += (tp.tick - lastTick) * usPerQuarter / ticksPerQuarter / 1e6;
      lastTick = tp.tick; usPerQuarter = tp.usPerQuarter;
    }
    sec += (targetTick - lastTick) * usPerQuarter / ticksPerQuarter / 1e6;
    return sec;
  }

  const hits = noteEvents
    .map(ev => ({ tSec: tickToSec(ev.tick), note: ev.note, velocity: ev.velocity, channel: ev.channel }))
    .sort((a, b) => a.tSec - b.tSec);

  return { hits, tempoMap };
}

// MIDI 노트 이벤트 → 오디오 분석 경로와 동일한 {type,beat,score,vel} 형태로 변환
// (벨로시티가 곧 실제 세기이므로 오디오 쪽처럼 대역 신호로 음량을 추정할 필요가 없음)
function _midiHitsToScoredHits(midiHits, bpm) {
  const beatDur = 60 / bpm;
  return midiHits.map(h => {
    const type = GM_DRUM_NOTE_MAP[h.note];
    if (!type) return null;
    const beat = 1 + h.tSec / beatDur;
    const loud = h.velocity / 127;
    const fracBeat = ((beat - 1) % 1 + 1) % 1;
    const onDownbeat = fracBeat < 0.05 || fracBeat > 0.95;
    const onHalfbeat = Math.abs(fracBeat - 0.5) < 0.05;
    let score = loud;
    if (onDownbeat) score += 0.5; else if (onHalfbeat) score += 0.2;
    if (type === 'kick' || type === 'snare') score += 0.3;
    return { type, beat, score, vel: loud > 0.7 ? 'hard' : (loud > 0.35 ? 'medium' : 'soft') };
  }).filter(Boolean);
}

async function _runMidiAnalysis(arrayBuffer) {
  const { hits: midiHits, tempoMap } = _parseMidiFile(arrayBuffer);
  const filtered = midiHits.filter(h => GM_DRUM_NOTE_MAP[h.note] !== undefined);
  if (!filtered.length) throw new Error('GM 드럼 노트(킥36·스네어38·하이햇42 등)를 찾지 못했습니다');

  const bpm = 60000000 / (tempoMap[0]?.usPerQuarter || 500000);
  const beatsPerBarLocal = beatsPerBar;

  const hits = _midiHitsToScoredHits(filtered, bpm);
  const densityTiers = _buildDensityTiers(hits);
  const tiers = {
    sparse: _hitsToTimelineEvents(densityTiers.sparse, bpm),
    medium: _hitsToTimelineEvents(densityTiers.medium, bpm),
    exact:  _hitsToTimelineEvents(densityTiers.exact, bpm),
  };
  const tierCounts = { sparse: tiers.sparse.length, medium: tiers.medium.length, exact: tiers.exact.length };

  let lastTSec = 0;
  filtered.forEach(h => { if (h.tSec > lastTSec) lastTSec = h.tSec; });
  const totalBeats = lastTSec / (60 / bpm) + beatsPerBarLocal;
  const totalBarsNeeded = Math.min(400, Math.max(1, Math.ceil(totalBeats / beatsPerBarLocal)));
  const truncated = Math.ceil(totalBeats / beatsPerBarLocal) > 400;

  return {
    bpm: Math.round(bpm * 100) / 100,
    beatsPerBar: beatsPerBarLocal,
    totalBars: totalBarsNeeded,
    truncated,
    durationSec: lastTSec,
    onsetCount: filtered.length,
    tierCounts,
    tiers,
    sourceLabel: 'MIDI 채보',
    bpmLabel: 'BPM(파일 지정)',
  };
}

window.analyzeMidiFile = function (input) {
  const file = input.files[0];
  if (!file) return;
  const nameEl = document.getElementById('drum-midi-name');
  if (nameEl) nameEl.textContent = file.name;

  document.getElementById('drum-analysis-modal').style.display = 'flex';
  document.getElementById('drum-analysis-content').innerHTML = '<div class="da-progress">MIDI 분석 중...</div>';

  const reader = new FileReader();
  reader.onload = async e => {
    try {
      const result = await _runMidiAnalysis(e.target.result);
      result.fileName = file.name;
      _daResult = result;
      _renderDrumAnalysisResult(result);
    } catch (err) {
      document.getElementById('drum-analysis-content').innerHTML =
        `<div class="val-err">MIDI 분석 실패: ${err.message}</div>`;
    }
  };
  reader.readAsArrayBuffer(file);
};

function _renderDrumAnalysisResult(result) {
  const titleEl = document.getElementById('drum-analysis-title');
  if (titleEl) titleEl.textContent = `🥁 ${result.sourceLabel || '드럼 분석'} 결과`;
  const el = document.getElementById('drum-analysis-content');
  const durMin = Math.floor(result.durationSec / 60), durSec = Math.round(result.durationSec % 60);
  const warn = result.truncated ? `<br><span class="val-warn">⚠ 곡이 길어 최대 400마디로 잘렸습니다</span>` : '';
  const bpmLabel = result.bpmLabel || '추정 BPM';
  el.innerHTML = `
    <div class="da-summary">
      <b>${result.fileName}</b><br>
      길이 ${durMin}:${String(durSec).padStart(2, '0')} · ${bpmLabel} <b>${result.bpm}</b> · 검출 타격 ${result.onsetCount}개 · 필요 ${result.totalBars}마디(현재 ${result.beatsPerBar}/4박자 기준)${warn}
    </div>
    <div class="da-tier" onclick="applyDrumAnalysisTier('sparse')">
      <div class="da-tier-name">① 스파스 — 가장 단순</div>
      <div class="da-tier-desc">중요도 상위 타격만, 박당 최대 1개 — 팔 이동 최소화</div>
      <div class="da-tier-stat">${result.tierCounts.sparse}개 타격</div>
    </div>
    <div class="da-tier" onclick="applyDrumAnalysisTier('medium')">
      <div class="da-tier-name">② 미디엄 — 중간</div>
      <div class="da-tier-desc">주요 타격 위주로 곡을 따라감</div>
      <div class="da-tier-stat">${result.tierCounts.medium}개 타격</div>
    </div>
    <div class="da-tier" onclick="applyDrumAnalysisTier('exact')">
      <div class="da-tier-name">③ 정확 — 음악과 동일</div>
      <div class="da-tier-desc">검출된 모든 타격을 그대로 반영</div>
      <div class="da-tier-stat">${result.tierCounts.exact}개 타격</div>
    </div>
  `;
}

window.applyDrumAnalysisTier = function (tierName) {
  if (!_daResult) return;
  const events = _daResult.tiers[tierName];
  if (!events) return;

  document.getElementById('bpm-inp').value  = _daResult.bpm;
  document.getElementById('meter-sel').value = String(_daResult.beatsPerBar);
  document.getElementById('bars-inp').value = _daResult.totalBars;

  timelineEvents = events.map(e => ({ ...e }));

  // 분석(오디오 분석 경로)에 쓴 오디오가 있으면 재생 트랙으로도 연결 — 재생 시 실제
  // 곡과 함께 정확도 확인 가능. MIDI 채보 경로는 오디오 파일이 없으므로 건드리지
  // 않음(이미 "🎵 음악 로드"로 불러온 배경음악이 있다면 그대로 유지됨).
  if (_daResult.audioBuffer) {
    _audioBuf = _daResult.audioBuffer;
    const audioNameEl = document.getElementById('audio-name');
    if (audioNameEl) audioNameEl.textContent = _daResult.fileName + ' (분석됨)';
  }

  closeDrumAnalysis();
  applyPattern();
  setStatus(`${_daResult.sourceLabel || '드럼 분석'} 적용 — ${tierName} 티어 · ${timelineEvents.length}개 타격 · ${_daResult.bpm}BPM`);
};

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
    _checkTemplateDirty();
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

    function beatFromEvent(e) {
      const rect    = lane.getBoundingClientRect();
      const scrollL = document.getElementById('tl-scroll')?.scrollLeft || 0;
      const rawX    = e.clientX - rect.left + scrollL;
      let beat      = rawX / PX_PER_BEAT + 1;
      if (document.getElementById('chk-snap')?.checked) {
        const snapUnit = 4 / div;
        beat = Math.round(beat / snapUnit) * snapUnit;
      }
      return parseFloat(clamp(beat, 1, totalBeats + 1).toFixed(4));
    }

    lane.addEventListener('click', e => {
      if (e.target.classList.contains('tl-hit')) return;
      if (_tlDragOccurred) { _tlDragOccurred = false; return; } // 드래그 직후의 클릭은 무시(중복 토글 방지)
      addEvent(drum.id, beatFromEvent(e));
    });

    // 드래그로 일정 간격마다 반복 채우기 — mousemove/mouseup은 document에 한 번만
    // 등록해 커서가 레인 밖으로 살짝 벗어나도 드래그가 끊기지 않게 한다.
    lane.addEventListener('mousedown', e => {
      if (e.button !== 0 || e.target.classList.contains('tl-hit')) return;
      _tlDrag = { drumId: drum.id, lane, startBeat: beatFromEvent(e), filled: new Set() };
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

// 이미 있으면 건드리지 않고 새 것만 추가 — addEvent는 같은 자리를 다시 누르면
// 토글(삭제)하므로, 드래그로 같은 위치를 여러 번 지나가도 지워지지 않게 분리.
function addEventIfMissing(drumId, beat) {
  const exists = timelineEvents.some(e => e.drumId === drumId && Math.abs(e.beat - beat) < 0.01);
  if (!exists) addEvent(drumId, beat);
}

// ── 타임라인 레인 드래그 → 지정 간격마다 반복 채우기 ─────────────────
// 하나씩 클릭하는 대신, 레인을 누른 채 드래그하면 "드래그 간격" 설정값
// (1/4~4박)마다 비트 1을 기준으로 한 전역 그리드 위치에 자동으로 타격을
// 채운다. mousemove/mouseup은 레인이 renderTimeline()마다 다시 생성되므로
// document에 한 번만 등록해 리스너가 쌓이지 않게 한다.
let _tlDrag = null;          // { drumId, lane, startBeat, filled }
let _tlDragOccurred = false; // 드래그가 실제로 일어났으면 뒤이은 click을 무시

document.addEventListener('mousemove', e => {
  if (!_tlDrag) return;
  const { startBeat, filled } = _tlDrag;
  // _commitTimeline()이 renderTimeline()으로 레인 DOM을 통째로 다시 만들기
  // 때문에, mousedown 시점의 lane 참조를 그대로 쓰면 첫 타격이 채워진 순간
  // 이후로 낡은(detached) 엘리먼트가 되어 나머지 드래그가 전부 깨진다 —
  // 매번 현재 DOM에서 다시 찾는다.
  const lane = document.querySelector(`.tl-lane[data-drum-id="${_tlDrag.drumId}"]`);
  if (!lane) { _tlDrag = null; return; }
  const rect    = lane.getBoundingClientRect();
  const scrollL = document.getElementById('tl-scroll')?.scrollLeft || 0;
  const rawX    = e.clientX - rect.left + scrollL;
  const curBeat = rawX / PX_PER_BEAT + 1;

  if (!_tlDragOccurred && Math.abs(curBeat - startBeat) < 0.05) return; // 미세한 움직임은 클릭으로 취급
  _tlDragOccurred = true;

  const interval   = parseFloat(document.getElementById('drag-interval-sel')?.value) || 1;
  const totalBeats = totalBars * beatsPerBar;
  const lo = Math.min(startBeat, curBeat);
  const hi = Math.max(startBeat, curBeat);
  // 비트 1을 기준으로 한 전역 간격 그리드(1, 1+interval, 1+2*interval, ...) 중
  // 드래그 구간에 걸치는 위치만 골라 채운다.
  const firstK = Math.ceil((lo - 1) / interval);
  const lastK  = Math.floor((hi - 1) / interval);
  let addedAny = false;
  for (let k = firstK; k <= lastK; k++) {
    const beat = parseFloat((1 + k * interval).toFixed(4));
    if (beat < 1 || beat > totalBeats + 1) continue;
    const key = beat.toFixed(4);
    if (filled.has(key)) continue;
    filled.add(key);
    const before = timelineEvents.length;
    addEventIfMissing(_tlDrag.drumId, beat);
    if (timelineEvents.length !== before) addedAny = true;
  }
  if (addedAny) _commitTimeline();
});

document.addEventListener('mouseup', () => { _tlDrag = null; });

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

// 자동 생성 복잡도 버튼 클릭 핸들러 — L(단순)·M(기본)·H(화려)
window.setComplexity = function (mode) {
  complexityMode = mode;
  ['L','M','H'].forEach(m => {
    document.getElementById(`cx-mode-${m.toLowerCase()}`)?.classList.toggle('active', m === mode);
  });
  saveSettings();
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
  // autoGen === false로 체크 해제된 드럼은 자동 생성 후보에서 제외(실물
  // 테스트 시 연결된 드럼만 쓰고 싶을 때). 한쪽 팔에 활성 드럼이 하나도
  // 없으면 아래 로직들이 전부 null/빈 배열로 자연스럽게 건너뛰어, 그 팔은
  // 이번 생성에서 전혀 등장하지 않고(초기 자세 유지) 다른 팔만 생성된다.
  const Ld = drumKit.filter(d => d.arm === 'L' && d.type !== 'kick' && d.autoGen !== false);
  const Rd = drumKit.filter(d => d.arm === 'R' && d.type !== 'kick' && d.autoGen !== false);
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

  // ── 복잡도별 추가 스타일 풀 ──────────────────────────────────────
  // L(단순): 곡 전체 1~2드럼 고정, 4분음표 위주, 필 없음 — 실제 "심플 비트" 느낌
  // H(화려): 마디마다(혹은 그 이상) 드럼 교체 + 8분/16분 혼합 + 필 2마디마다
  //
  // R팔 고정 드럼은 매번 Rd 중에서 무작위로 하나 뽑는다(생성 1회 동안은 고정
  // 유지). 항상 라이드/미들탐만 고르면 플로어탐이 L 모드에서 사실상 영영
  // 안 나오므로, 플로어탐을 포함한 모든 R팔 드럼이 골고루 뽑히게 한다.
  const simpleR = Rd.length ? Rd[Math.floor(Math.random() * Rd.length)].id : Rback;

  const SIMPLE_STYLES = [
    {
      name: '심플 그루브',
      gen(bs) {
        const mL = lcyc(0);                              // 곡 전체 고정 1드럼
        for (let b = 0; b < bpb; b++) safeAdd(mL, bs + b);
        backOff.forEach(b => safeAdd(simpleR, bs + b));
      },
    },
    {
      name: '심플 백비트',
      gen(bs) {
        for (let b = 0; b < bpb; b++) safeAdd(simpleR, bs + b);
        backOff.forEach(b => safeAdd(Lsnare ?? Lhihat ?? lcyc(0), bs + b));
      },
    },
  ];

  const COMPLEX_STYLES = [
    {
      name: '풀 드럼 쇼케이스',
      gen(bs, bar) {
        const mL  = lcyc(bar);
        const mL2 = lcyc(bar + 1);
        const mR  = rcyc(bar);
        const mR2 = rcyc(bar + 1);
        for (let b = 0; b < bpb; b++) {
          safeAdd(b % 2 === 0 ? mL : mL2, bs + b);
          safeAdd(mR, bs + b + 0.5);
          if (coin(0.4)) safeAdd(mR2, bs + b + 0.25);     // 16분 고스트
          if (coin(0.3)) safeAdd(mL2, bs + b + 0.75);
        }
        backOff.forEach(b => safeAdd(Lsnare ?? mL, bs + b));
        if (bar % 2 === 1) {                              // 필 2마디마다(기본보다 촘촘)
          safeAdd(Lcrash ?? lcyc(bar + 2), bs + bpb - 1);
          safeAdd(rcyc(bar + 2), bs + bpb - 1);
        }
      },
    },
    {
      name: '폴리 콤보',
      gen(bs, bar) {
        const mL = lcyc(bar);
        const mR = rcyc(bar + 1);                         // L/R 교차 오프셋
        for (let b = 0; b < bpb; b++) {
          safeAdd(mL, bs + b);
          if (b % 2 === 0) safeAdd(mL, bs + b + 0.5);
          safeAdd(mR, bs + b + 0.5);
          if (coin(0.35)) safeAdd(mR, bs + b + 0.25);
        }
        backOff.forEach(b => safeAdd(Lsnare ?? mL, bs + b));
        if (bar % 2 === 1) {
          safeAdd(lcyc(bar + 2), bs + bpb - 2);
          safeAdd(rcyc(bar + 3), bs + bpb - 1);
        }
      },
    },
  ];

  const pool = complexityMode === 'L' ? SIMPLE_STYLES
             : complexityMode === 'H' ? COMPLEX_STYLES
             : STYLES;
  const style = pool[Math.floor(Math.random() * pool.length)];

  // 백비트(2·4박)는 실제 드럼처럼 항상 스네어가 담당하도록 강제 보정.
  // 스타일이 그 자리에 다른 드럼(하이햇 등)을 이미 놓았어도 스네어로 교체하고,
  // 비어 있으면 새로 추가한다 — 다른 팔(예: 라이드)의 백비트 히트는 그대로 둔다.
  function forceSnareBackbeat(bs) {
    // Ld에서 찾은 Lsnare를 써야 자동 생성에서 체크 해제(autoGen:false)된 스네어를
    // 존중한다 — 예전엔 drumKit 전체에서 바로 찾아 비활성화해도 강제로 끼워
    // 넣는 버그가 있었음(실물 테스트로 일부 드럼만 쓰고 싶을 때 문제가 됨).
    if (!Lsnare) return;
    const snareDrum = drumKit.find(d => d.id === Lsnare);
    backOff.forEach(b => {
      const beat = parseFloat((bs + b).toFixed(3));
      const idx = timelineEvents.findIndex(e => {
        const d = drumKit.find(x => x.id === e.drumId);
        return d?.arm === snareDrum.arm && Math.abs(e.beat - beat) < 0.01;
      });
      if (idx >= 0) timelineEvents[idx].drumId = snareDrum.id;
      else safeAdd(snareDrum.id, beat);
    });
  }

  for (let bar = 0; bar < totalBars; bar++) {
    const bs = bar * bpb + 1;
    style.gen(bs, bar);
    if (complexityMode !== 'L') forceSnareBackbeat(bs);   // L(단순)은 고정 2드럼 유지가 목적
  }

  // 오프닝 악센트 — 크래시로 카운트인 느낌. L(단순) 모드는 드럼 수를 최소로
  // 유지하는 게 목적이라 생략(추가 드럼 1개가 곡 시작에만 몰리는 것도 방지).
  if (complexityMode !== 'L') {
    safeAdd(Lcrash ?? Ld[0]?.id, 1);
  }

  // L(단순) 모드는 여백 자체가 "단순함"의 일부이므로 아래 밀도·커버리지
  // 보정을 건너뛴다 — 안 그러면 필러가 드럼을 더 채워 넣어 단순함이 깨진다.
  if (complexityMode !== 'L') {
    // ── 밀도 보장: 팔당 공백 금지 (H는 더 촘촘하게) ──────────────
    // 크래시 계열은 강조 포인트 전용이므로 필러에서 제외, 리듬 드럼만 사용
    const FILLER_TYPES_L = ['hihat', 'tom_h', 'snare'];
    const FILLER_TYPES_R = ['ride', 'tom_m', 'tom_f'];
    const fillL = Ld.filter(d => FILLER_TYPES_L.includes(d.type));
    const fillR = Rd.filter(d => FILLER_TYPES_R.includes(d.type));

    const maxGapB = (bpm / 60) * (complexityMode === 'H' ? 0.25 : 0.5);   // beat 단위
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

    // ── 커버리지 보장: 실물 드럼 테스트 목적 — 킥을 제외한 드럼 중
    // 이번 생성에서 한 번도 안 쓰인 드럼을 찾아 빈 박자에 채워 넣는다.
    // 곡 전체에 고르게 분산 배치(각 드럼의 탐색 시작점을 순서대로 흩어
    // 놓음) — 이전엔 항상 1박부터 찾아서 누락 드럼이 전부 곡 시작에
    // 몰리는 문제가 있었다.
    const hitCount = id => timelineEvents.filter(e => e.drumId === id).length;
    const missing = [...Ld, ...Rd].filter(d => hitCount(d.id) === 0);
    missing.forEach((d, i) => {
      const startB = 1 + Math.floor(((i + 0.5) / missing.length) * Math.max(0, totalB - 1));
      let placed = false;
      for (let b = startB; b <= totalB && !placed; b += 0.5) {
        if (safeAdd(d.id, parseFloat(b.toFixed(3)))) placed = true;
      }
      for (let b = 1; b < startB && !placed; b += 0.5) {
        if (safeAdd(d.id, parseFloat(b.toFixed(3)))) placed = true;
      }
    });
  }

  _commitTimeline();
  stopAnim();
  if (timelineEvents.length) playAnim();
  setStatus(`🎲 자동 생성[${complexityMode}]: ${style.name} (${timelineEvents.length}개)`);
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
    ${isKick ? '' : `
    <label class="drum-autogen-chk" title="체크 해제 시 🎲 자동 생성에서 이 드럼을 사용하지 않음(실물 테스트로 일부 드럼만 연결했을 때 유용)">
      <input type="checkbox" ${drum.autoGen === false ? '' : 'checked'}
        onchange="updateDrumProp('${drum.id}','autoGen',this.checked)"> 자동
    </label>`}
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
  _checkTemplateDirty();
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

document.getElementById('bpm-inp').addEventListener('change', () => {
  // 박자·마디 핸들러와 동일하게 전역 bpm을 즉시 커밋 — "적용" 없이 BPM만 바꿔도
  // 재생·WAV·YAML이 올바른 템포를 쓰도록(이전엔 라벨만 바뀌고 bpm은 그대로였음)
  bpm = parseInt(document.getElementById('bpm-inp').value) || 120;
  updateTLInfo(); saveSettings();
});

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
_bindStrokePair('stick-j7-slider',  'stick-j7-val',  v => { stickJ7Offset  = v; saveSettings(); }, -0.6, 0.6);
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

// 인트로/아웃트로 체크박스·인트로 스타일 변경 → 재생 타임라인 즉시 갱신
['chk-intro', 'chk-outro', 'intro-style-sel'].forEach(id => {
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
renderPresetDropdown();
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
