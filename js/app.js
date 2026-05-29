import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';

const PI = Math.PI;

// ═══════════════════════════════════════════════════════════════
//  드럼 타입 DB
// ═══════════════════════════════════════════════════════════════
const DRUM_TYPES = {
  hihat:  { name:'하이햇',       color:'#00ddff', preDur:0.06, rebDur:0.08, style:'wrist' }, // 시안
  snare:  { name:'스네어',       color:'#ffffff', preDur:0.08, rebDur:0.10, style:'full'  }, // 흰색
  tom_h:  { name:'하이 탐',      color:'#ff3366', preDur:0.09, rebDur:0.11, style:'full'  }, // 핑크레드
  tom_m:  { name:'미드 탐',      color:'#ff8800', preDur:0.09, rebDur:0.11, style:'full'  }, // 주황
  tom_f:  { name:'플로어 탐',    color:'#bb44ff', preDur:0.10, rebDur:0.13, style:'full'  }, // 보라
  crash:  { name:'크래시 심벌',  color:'#ffdd00', preDur:0.10, rebDur:0.16, style:'big'   }, // 골드
  ride:   { name:'라이드 심벌',  color:'#44ff99', preDur:0.09, rebDur:0.13, style:'full'  }, // 민트
  kick:   { name:'킥 (확장용)',  color:'#884422', preDur:0,    rebDur:0,    style:'none'  }, // 브라운
};

// ═══════════════════════════════════════════════════════════════
//  드럼 키트 상태
// ═══════════════════════════════════════════════════════════════
// 어깨 높이 0.698m 기준
// 어깨 높이 0.698m 기준 실제 타격 가능 위치
// 탐/스네어: 어깨와 비슷하거나 약간 위, 심벌: 어깨보다 0.10~0.15m 위
let drumKit = [
  { id:'d0', name:'크래시 L',  type:'crash',  arm:'L', pos:{x:0.19, y: 0.47, z:0.57} },
  { id:'d1', name:'하이햇',    type:'hihat',  arm:'L', pos:{x:0.38, y: 0.34, z:0.51} },
  { id:'d2', name:'하이 탐',   type:'tom_h',  arm:'L', pos:{x:0.55, y: 0.18, z:0.50} },
  { id:'d3', name:'미드 탐',   type:'tom_m',  arm:'L', pos:{x:0.42, y: 0.04, z:0.46} },
  { id:'d4', name:'스네어',    type:'snare',  arm:'R', pos:{x:0.42, y:-0.15, z:0.46} },
  { id:'d5', name:'플로어 탐', type:'tom_f',  arm:'R', pos:{x:0.60, y:-0.29, z:0.53} },
  { id:'d6', name:'라이드',    type:'ride',   arm:'R', pos:{x:0.37, y:-0.52, z:0.50} },
  { id:'d7', name:'크래시 R',  type:'crash',  arm:'R', pos:{x:0.12, y:-0.53, z:0.63} },
];
let nextDrumId = 8;

// 기본값 스냅샷 (초기화 버튼용)
const DEFAULT_DRUM_KIT = drumKit.map(d => ({...d, pos: {...d.pos}}));
const _DK_STORE = 'openarmx_drum_kit_v2';

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
  _playKFs = buildKeyframes(); _playDur = _playKFs.totalTime;
  setStatus('드럼 키트 기본값으로 초기화됨');
};

// ═══════════════════════════════════════════════════════════════
//  타임라인 상태
// ═══════════════════════════════════════════════════════════════
let timelineEvents = [];
let bpm = 120;
let beatsPerBar = 4;
let totalBars = 8;
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
  const root = ARM_ROOT[drum.arm];
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

function _solveIK(arm, targetUrdf, initAngles, j7) {
  const JK  = [1,2,3,4,5,6].map(i => `${arm}${i}`);
  const a   = { [`${arm}7`]: j7 };
  JK.forEach(k => {
    const [lo, hi] = _IK_LIMITS[k] ?? [-PI, PI];
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
      const [lo, hi] = _IK_LIMITS[JK[i]] ?? [-PI, PI];
      a[JK[i]] = clamp(a[JK[i]] + grads[i] * stepMag, lo, hi);
    }
  }
  a[`${arm}7`] = j7;
  return a;
}

// ── 해석적 초기 추정치 (수렴 속도용) ───────────────────────────
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
  const j4 = clamp(j4Hold + j4Delta * j4Scale, 0.10, 1.65);
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

// ── 드럼 위치 → 타격 포즈 (수치 IK 기반) ───────────────────────
// phase: 'raise' | 'strike' | 'rebound'
// strike: TCP가 드럼 위치에 정확히 도달
// raise:  드럼 위치보다 약간 위·뒤 (코일업)
// rebound: 타격 직후 위로 튀어오름
function computeStrikePose(drum, phase) {
  const s     = drum.arm;
  const style = DRUM_TYPES[drum.type]?.style || 'full';

  // 손목 스냅 J7 (위상별 고정 — IK와 별개)
  const j7Raw = ({ raise:-0.86, strike:+0.18, rebound:-0.54 }[phase] || 0) *
                ({ big:1.05, wrist:1.00, full:0.88, none:0 }[style] ?? 1.0);
  const j7    = s === 'L' ? j7Raw : -j7Raw;

  // TCP 목표 위치 (URDF 좌표)
  const off = { raise:{x:-0.03,z:+0.10}, strike:{x:0,z:0}, rebound:{x:0,z:+0.08} }[phase] || {x:0,z:0};
  const target = { x: drum.pos.x + off.x, y: drum.pos.y, z: drum.pos.z + off.z };

  // 해석적 초기 추정 → 수치 IK로 정밀화
  const guess = _analyticGuess(drum, phase);
  const init  = {};
  [1,2,3,4,5,6].forEach(i => { init[`${s}${i}`] = guess[`${s}${i}`]; });

  const solved = _solveIK(s, target, init, j7);

  // 포즈 조립 (해당 팔만 — buildKeyframes에서 L/R 트랙 분리)
  const pose = { ...NEUTRAL };
  [1,2,3,4,5,6,7].forEach(i => { pose[`${s}${i}`] = solved[`${s}${i}`]; });
  return pose;
}

// ═══════════════════════════════════════════════════════════════
//  타임라인 → 키프레임 빌드 (L·R 팔 완전 분리 트랙)
// ═══════════════════════════════════════════════════════════════
function buildKeyframes() {
  const beatDur    = 60 / bpm;
  const totalBeats = totalBars * beatsPerBar;
  const totalTime  = parseFloat((totalBeats * beatDur).toFixed(3));
  const preDur     = parseFloat(Math.max(0.12, Math.min(0.32, beatDur * 0.38)).toFixed(3));

  const L_KEYS    = ['L1','L2','L3','L4','L5','L6','L7'];
  const R_KEYS    = ['R1','R2','R3','R4','R5','R6','R7'];
  const NEUTRAL_L = { L1:0, L2:0, L3:0, L4:0, L5:0, L6:0, L7:0 };
  const NEUTRAL_R = { R1:0, R2:0, R3:0, R4:0, R5:0, R6:0, R7:0 };

  // 왼팔·오른팔 키프레임 트랙 완전 분리 — 서로의 값을 NEUTRAL로 강제하지 않음
  const L_poseMap = new Map();
  const R_poseMap = new Map();

  L_poseMap.set('0.000', { ...NEUTRAL_L });
  R_poseMap.set('0.000', { ...NEUTRAL_R });

  timelineEvents.forEach(evt => {
    const drum = drumKit.find(d => d.id === evt.drumId);
    if (!drum || drum.type === 'kick') return;

    const t        = parseFloat(((evt.beat - 1) * beatDur).toFixed(3));
    const typeInfo = DRUM_TYPES[drum.type];
    const raiseT   = parseFloat(Math.max(0.001, t - preDur).toFixed(3));
    const reboundT = parseFloat((t + typeInfo.rebDur).toFixed(3));

    const poseMap  = drum.arm === 'L' ? L_poseMap : R_poseMap;
    const sideKeys = drum.arm === 'L' ? L_KEYS    : R_KEYS;

    [
      { time: raiseT,   phase: 'raise'   },
      { time: t,        phase: 'strike'  },
      { time: reboundT, phase: 'rebound' },
    ].forEach(({ time, phase }) => {
      const pose = computeStrikePose(drum, phase);
      const key  = time.toFixed(3);
      if (!poseMap.has(key)) poseMap.set(key, {});
      const cur  = poseMap.get(key);
      sideKeys.forEach(k => { cur[k] = pose[k]; });
    });
  });

  L_poseMap.set(totalTime.toFixed(3), { ...NEUTRAL_L });
  R_poseMap.set(totalTime.toFixed(3), { ...NEUTRAL_R });

  const toArray = (map) =>
    Array.from(map.entries())
      .map(([t, angles]) => ({ time: parseFloat(t), angles }))
      .sort((a, b) => a.time - b.time);

  return { L: toArray(L_poseMap), R: toArray(R_poseMap), totalTime };
}

// ═══════════════════════════════════════════════════════════════
//  YAML 내보내기
// ═══════════════════════════════════════════════════════════════
window.exportYAML = function () {
  const kfs = buildMergedKeyframes();
  if (kfs.length <= 1) { alert('타임라인에 드럼 이벤트를 추가하세요.'); return; }

  const jointNames = [
    'openarmx_left_joint1','openarmx_left_joint2','openarmx_left_joint3','openarmx_left_joint4',
    'openarmx_left_joint5','openarmx_left_joint6','openarmx_left_joint7',
    'openarmx_right_joint1','openarmx_right_joint2','openarmx_right_joint3','openarmx_right_joint4',
    'openarmx_right_joint5','openarmx_right_joint6','openarmx_right_joint7',
  ];
  const shortKeys = ['L1','L2','L3','L4','L5','L6','L7','R1','R2','R3','R4','R5','R6','R7'];

  let yaml = 'joint_names:\n';
  jointNames.forEach(n => { yaml += `- ${n}\n`; });
  yaml += 'points:\n';

  kfs.forEach(kf => {
    yaml += '- positions:\n';
    shortKeys.forEach(k => {
      const v = kf.angles[k] !== undefined ? kf.angles[k] : 0;
      yaml += `  - ${parseFloat(v.toFixed(4))}\n`;
    });
    yaml += `  time_from_start: ${kf.time.toFixed(3)}\n`;
  });

  const ts = new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 15);
  const a  = document.createElement('a');
  a.href     = 'data:text/yaml;charset=utf-8,' + encodeURIComponent(yaml);
  a.download = `drum_${ts}.yaml`;
  a.click();
  setStatus(`YAML 저장 완료 — ${kfs.length}개 키프레임`);
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
    if      (dist > MAX_REACH)        results.push({ lv:'err',  msg:`[${d.name}] 도달 불가 (${dist.toFixed(2)}m > ${MAX_REACH}m)` });
    else if (dist > MAX_REACH * 0.88) results.push({ lv:'warn', msg:`[${d.name}] 한계 근접 (${dist.toFixed(2)}m)` });
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
        const canAlt   = distAlt <= MAX_REACH;
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

  const kfs       = buildMergedKeyframes();
  const shortKeys = ['L1','L2','L3','L4','L5','L6','L7','R1','R2','R3','R4','R5','R6','R7'];
  let yamlOk = true;
  kfs.forEach(kf => { shortKeys.forEach(k => { if (!isFinite(kf.angles[k])) yamlOk = false; }); });
  results.push(yamlOk
    ? { lv:'ok',  msg:`최종 YAML: ${kfs.length}개 포인트 — 기존 포맷과 동일 ✓` }
    : { lv:'err', msg:'YAML에 유효하지 않은 값이 있습니다.' }
  );

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
    const tcp = groups[`${s}_tcp`];
    if (!tcp) return;
    const wp = new THREE.Vector3();
    tcp.getWorldPosition(wp);
    const el = document.getElementById(`tcp-${s.toLowerCase()}`);
    if (el) el.textContent = `X${wp.x.toFixed(2)} Y${(-wp.z).toFixed(2)} Z${wp.y.toFixed(2)}`;
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
    if (drum.type === 'kick') return;
    const typeInfo = DRUM_TYPES[drum.type];
    const col      = new THREE.Color(typeInfo.color);
    const isCymbal = ['crash', 'ride', 'hihat'].includes(drum.type);

    // 드럼별 그룹 (URDF 좌표에 배치)
    const grp = new THREE.Group();
    grp.position.set(drum.pos.x, drum.pos.y, drum.pos.z);
    drumSphereGroup.add(grp);
    drumGroups[drum.id] = grp;

    // 드럼 헤드 크기
    const sizes = {
      crash: [0.17, 0.008], ride: [0.16, 0.008], hihat: [0.13, 0.010],
      snare: [0.11, 0.060], tom_h: [0.09, 0.060], tom_m: [0.10, 0.060], tom_f: [0.13, 0.060],
    };
    const [r, h] = sizes[drum.type] || [0.10, 0.050];

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
    headMesh.rotation.x = Math.PI / 2;
    // 심벌은 살짝 기울임 (자연스러운 모습)
    if (isCymbal) headMesh.rotation.z = 0.15;
    headMesh.castShadow = true;
    grp.add(headMesh);
    drumMeshes[drum.id] = headMesh;

    // ── 헤드 윗면 링 (타격 위치 표시) ────────────────────────
    const ringGeo = new THREE.RingGeometry(r * 0.35, r * 0.92, 32);
    const ringMat = new THREE.MeshBasicMaterial({
      color: col, side: THREE.DoubleSide, transparent: true, opacity: 0.30,
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    // RingGeometry는 기본으로 XY 평면(URDF 수평면)에 있어서 회전 불필요
    ring.position.z = h / 2 + 0.001;
    grp.add(ring);

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

function interpolateArm(t, kfs, keys) {
  const neutral = {};
  keys.forEach(k => { neutral[k] = 0; });
  if (!kfs.length) return neutral;
  if (kfs.length === 1) { const o = {}; keys.forEach(k => { o[k] = kfs[0].angles[k] ?? 0; }); return o; }

  let before = kfs[0], after = kfs[kfs.length - 1];
  for (let i = 0; i < kfs.length - 1; i++) {
    if (kfs[i].time <= t && kfs[i+1].time >= t) { before = kfs[i]; after = kfs[i+1]; break; }
  }
  if (before.time === after.time) { const o = {}; keys.forEach(k => { o[k] = before.angles[k] ?? 0; }); return o; }

  const s = smoothStep(clamp((t - before.time) / (after.time - before.time), 0, 1));
  const out = {};
  keys.forEach(k => {
    out[k] = (before.angles[k] ?? 0) + ((after.angles[k] ?? 0) - (before.angles[k] ?? 0)) * s;
  });
  return out;
}

function interpolateAngles(t, kfs) {
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

window.playAnim = function () {
  _playKFs = buildKeyframes();
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
  if (!_playKFs.L?.length) {
    _playKFs = buildKeyframes();
    _playDur = _playKFs.totalTime;
    this.max = _playDur;
  }
  updateFK(interpolateAngles(t, _playKFs));
  updateTimeLbl(t);
  _updatePlayhead(t);
  // 오디오 위치 동기화
  if (isPlaying) _playAudio(t);
  else _audioPlayOff = t;
});

function _updatePlayhead(t) {
  const ph = document.getElementById('tl-playhead');
  if (!ph || !_playDur) return;
  const totalW = totalBars * beatsPerBar * PX_PER_BEAT;
  ph.style.left = Math.min(totalW, (t / _playDur) * totalW).toFixed(1) + 'px';
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

    const beatDur = 60 / bpm;
    timelineEvents.forEach(evt => {
      const drum = drumKit.find(d => d.id === evt.drumId);
      if (!drum) return;
      const hitT    = (evt.beat - 1) * beatDur;
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

function _playAudio(offset) {
  if (!_audioCtx || !_audioBuf) return;
  _stopAudio();
  if (_audioCtx.state === 'suspended') _audioCtx.resume();
  _audioSrc = _audioCtx.createBufferSource();
  _audioSrc.buffer = _audioBuf;
  _audioSrc.connect(_audioCtx.destination);
  _audioPlayOff   = clamp(offset, 0, _audioBuf.duration);
  _audioStartCtxT = _audioCtx.currentTime;
  _audioSrc.start(0, _audioPlayOff);
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
    _playKFs = buildKeyframes();
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
      const x   = (evt.beat - 1) * PX_PER_BEAT;
      const hit = document.createElement('div');
      hit.className      = 'tl-hit';
      hit.style.left     = x + 'px';
      hit.style.background  = typeInfo.color;
      hit.style.boxShadow   = `0 0 6px ${typeInfo.color}66`;
      hit.title          = `${drum.name} — beat ${evt.beat.toFixed(2)}`;
      const key = `${drum.id}_${evt.beat}`;
      hit.dataset.key    = key;
      hit.addEventListener('click', e => { e.stopPropagation(); removeEvent(drum.id, evt.beat); });
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
    renderTimeline();
    _playKFs = buildKeyframes();
    _playDur = _playKFs.totalTime;
    return;
  }

  const drum = drumKit.find(d => d.id === drumId);

  // 킥은 팔 충돌 없음
  if (!drum || drum.type === 'kick') {
    timelineEvents.push({ drumId, beat });
    renderTimeline();
    _playKFs = buildKeyframes();
    _playDur = _playKFs.totalTime;
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
    const hint = distOther <= MAX_REACH
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

  timelineEvents.push({ drumId, beat });
  renderTimeline();
  _playKFs = buildKeyframes();
  _playDur = _playKFs.totalTime;
}

function removeEvent(drumId, beat) {
  const idx = timelineEvents.findIndex(e => e.drumId === drumId && Math.abs(e.beat - beat) < 0.01);
  if (idx >= 0) {
    timelineEvents.splice(idx, 1);
    renderTimeline();
    _playKFs = buildKeyframes();
    _playDur = _playKFs.totalTime;
  }
}

// ═══════════════════════════════════════════════════════════════
//  드럼 타격 자세 실시간 미리보기
//  클릭 시: 중립 → raise → strike → rebound → 중립 애니메이션
//  setInterval 기반 — RAF 경쟁 타이밍 문제 없음
// ═══════════════════════════════════════════════════════════════
window._drumPreviewActive = false;
let _previewTimer = null;

window.previewDrumHit = function (drumId) {
  // 기존 미리보기 중단
  if (_previewTimer) { clearInterval(_previewTimer); _previewTimer = null; }
  window._drumPreviewActive = false;

  const drum = drumKit.find(d => d.id === drumId);
  if (!drum || drum.type === 'kick') {
    setStatus(`[${drum?.name || drumId}] 킥 드럼은 팔 동작이 없습니다`);
    return;
  }

  // 패널 선택 하이라이트
  document.querySelectorAll('.drum-item').forEach(el => el.classList.remove('drum-selected'));
  document.querySelector(`.drum-item[data-id="${drumId}"]`)?.classList.add('drum-selected');

  // 드럼 구체 플래시
  const mesh = drumMeshes[drumId];
  if (mesh) {
    mesh.material.emissiveIntensity = 2.0;
    mesh.scale.setScalar(1.3);
    setTimeout(() => { mesh.material.emissiveIntensity = 0.20; mesh.scale.setScalar(1.0); }, 180);
  }

  const dist = reachDist(drum);
  setStatus(`[${drum.name}] ${drum.arm === 'L' ? '왼팔' : '오른팔'} 타격 미리보기 — 거리 ${dist.toFixed(2)}m`);

  // 페이즈 정의: 중립 → raise(코일업) → strike(타격) → rebound(반동) → 중립
  const phases = [
    { from: { ...NEUTRAL },                       to: computeStrikePose(drum, 'raise'),   dur: 0.14 },
    { from: computeStrikePose(drum, 'raise'),      to: computeStrikePose(drum, 'strike'),  dur: 0.09 },
    { from: computeStrikePose(drum, 'strike'),     to: computeStrikePose(drum, 'rebound'), dur: 0.09 },
    { from: computeStrikePose(drum, 'rebound'),    to: { ...NEUTRAL },                     dur: 0.22 },
  ];

  let phaseIdx = 0;
  let phaseT0  = performance.now();
  window._drumPreviewActive = true;

  // setInterval(~16ms) — animate() 루프와 독립적으로 실행, 덮어쓰기 없음
  _previewTimer = setInterval(() => {
    if (phaseIdx >= phases.length) {
      clearInterval(_previewTimer);
      _previewTimer = null;
      window._drumPreviewActive = false;
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
    timelineEvents.push({ drumId, beat: bk });
    return true;
  }

  const coin = p => Math.random() < (p ?? 0.5);

  const D = {
    snare:    drumKit.find(d => d.type === 'snare')?.id,
    hihat:    drumKit.find(d => d.type === 'hihat')?.id,
    midTom:   drumKit.find(d => d.type === 'tom_m')?.id,
    hiTom:    drumKit.find(d => d.type === 'tom_h')?.id,
    floorTom: drumKit.find(d => d.type === 'tom_f')?.id,
    ride:     drumKit.find(d => d.type === 'ride')?.id,
    crashL:   drumKit.find(d => d.type === 'crash' && d.arm === 'L')?.id,
    crashR:   drumKit.find(d => d.type === 'crash' && d.arm === 'R')?.id,
  };

  const snareOff = bpb >= 4 ? [1, bpb - 1] : [Math.floor(bpb / 2)];
  const isFill   = bar => (bar + 1) % 4 === 0; // 4마디마다 필

  // ── 스타일 5종 (8분음표 이하, 로봇 친화적) ───────────────────────

  const STYLES = [
    {
      name: '락 비트',
      gen(bs, bar) {
        snareOff.forEach(b => safeAdd(D.snare, bs + b));
        // 짝수 마디: 4분 하이햇 / 홀수 마디: 8분 하이햇
        for (let b = 0; b < bpb; b++) {
          safeAdd(D.hihat, bs + b);
          if (bar % 2 === 1) safeAdd(D.hihat, bs + b + 0.5);
        }
        // 필: 3박에 미드탐, 4박에 플로어탐
        if (isFill(bar)) {
          safeAdd(D.midTom,   bs + bpb - 2);
          safeAdd(D.floorTom, bs + bpb - 1);
        }
      },
    },

    {
      name: '미드탐 그루브',
      gen(bs, bar) {
        snareOff.forEach(b => safeAdd(D.snare, bs + b));
        [0, 2].forEach(b => b < bpb && safeAdd(D.midTom, bs + b));
        // 가끔 하이햇 오프비트 (2박뒤, 4박뒤)
        if (coin(0.6)) safeAdd(D.hihat, bs + 1.5);
        if (coin(0.6)) safeAdd(D.hihat, bs + 3.5);
        // 필: 마지막 2박 하이탐→미드탐
        if (isFill(bar)) {
          safeAdd(D.hiTom,  bs + bpb - 2);
          safeAdd(D.midTom, bs + bpb - 1);
        }
      },
    },

    {
      name: '8비트 그루브',
      gen(bs, bar) {
        snareOff.forEach(b => safeAdd(D.snare, bs + b));
        for (let b = 0; b < bpb; b++) {
          safeAdd(D.hihat, bs + b);
          safeAdd(D.hihat, bs + b + 0.5);
        }
        // 2마디마다 1박 미드탐 악센트
        if (bar % 2 === 0) safeAdd(D.midTom, bs);
        // 필: 크래시 + 플로어
        if (isFill(bar)) {
          safeAdd(D.floorTom, bs + bpb - 1);
          safeAdd(D.crashL,   bs + bpb - 1);
        }
      },
    },

    {
      name: '탐 순환',
      gen(bs, bar) {
        snareOff.forEach(b => safeAdd(D.snare, bs + b));
        // 4마디 주기로 탐 조합 순환
        const tomCycle = [
          [D.midTom, 0], [D.hiTom,  2],   // 마디 0: 미드1·하이3
          [D.hiTom,  0], [D.midTom, 2],   // 마디 1: 하이1·미드3
          [D.midTom, 0], [D.midTom, 2],   // 마디 2: 미드1·미드3
          [D.hiTom,  0], [D.hiTom,  2],   // 마디 3: 하이1·하이3
        ][bar % 4];
        // tomCycle는 2개씩 묶음이므로 bar%4 * 2 으로 접근
        const idx = (bar % 4) * 2;
        const allCycles = [
          [D.midTom,0],[D.hiTom,2],
          [D.hiTom,0],[D.midTom,2],
          [D.midTom,0],[D.midTom,2],
          [D.hiTom,0],[D.hiTom,2],
        ];
        safeAdd(allCycles[idx][0], bs + allCycles[idx][1]);
        safeAdd(allCycles[idx+1][0], bs + allCycles[idx+1][1]);
        // 필: 플로어탐 + 크래시
        if (isFill(bar)) {
          safeAdd(D.floorTom, bs + bpb - 1);
          safeAdd(D.crashL,   bs);
        }
      },
    },

    {
      name: '라이드 그루브',
      gen(bs, bar) {
        snareOff.forEach(b => safeAdd(D.snare, bs + b));
        for (let b = 0; b < bpb; b++) safeAdd(D.ride, bs + b);
        // 2마디 주기로 미드탐 악센트 위치 변화
        safeAdd(D.midTom, bs + (bar % 2 === 0 ? 0 : 2));
        // 필: 미드탐→플로어탐
        if (isFill(bar)) {
          safeAdd(D.midTom,   bs + bpb - 2);
          safeAdd(D.floorTom, bs + bpb - 1);
        }
      },
    },
  ];

  const style = STYLES[Math.floor(Math.random() * STYLES.length)];

  for (let bar = 0; bar < totalBars; bar++) {
    style.gen(bar * bpb + 1, bar);
  }

  // 오프닝 크래시
  safeAdd(D.crashL, 1);

  renderTimeline();
  _playKFs = buildKeyframes();
  _playDur  = _playKFs.totalTime;
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
    const dist      = reachDist(drum);
    const reachCls  = dist > MAX_REACH ? 'reach-err' : dist > MAX_REACH * 0.88 ? 'reach-warn' : 'reach-ok';
    const reachTxt  = dist > MAX_REACH ? `도달 불가 (${dist.toFixed(2)}m)` : `${dist.toFixed(2)}m`;

    return `
<div class="drum-item" data-id="${drum.id}">
  <div class="drum-item-header">
    <div class="drum-color-dot" style="background:${typeInfo.color};color:${typeInfo.color}"></div>
    <input class="drum-name-inp" value="${drum.name}"
      onchange="updateDrumProp('${drum.id}','name',this.value)">
    <button class="drum-preview-btn" onclick="previewDrumHit('${drum.id}')" title="타격 자세 미리보기 (팔 동작 확인)">🥁</button>
    <button class="drum-del-btn" onclick="deleteDrum('${drum.id}')" title="삭제">✕</button>
  </div>
  <div class="drum-type-row">
    <select class="drum-type-sel" onchange="updateDrumProp('${drum.id}','type',this.value)">
      ${typeOpts.replace(`value="${drum.type}"`, `value="${drum.type}" selected`)}
    </select>
    <select class="drum-arm-sel" onchange="updateDrumProp('${drum.id}','arm',this.value)">
      <option value="L" ${drum.arm==='L'?'selected':''}>왼팔 L</option>
      <option value="R" ${drum.arm==='R'?'selected':''}>오른팔 R</option>
    </select>
  </div>
  <div class="drum-pos-row">
    <div class="drum-pos-group">
      <label>X (앞)</label>
      <input class="drum-pos-inp" type="number" step="0.01" value="${drum.pos.x.toFixed(2)}"
        oninput="updateDrumPos('${drum.id}','x',+this.value)">
      <input class="drum-pos-slider" type="range" min="0.20" max="0.90" step="0.01"
        value="${drum.pos.x.toFixed(2)}"
        oninput="updateDrumPos('${drum.id}','x',+this.value);syncSlider(this,'x')">
    </div>
    <div class="drum-pos-group">
      <label>Y (좌우)</label>
      <input class="drum-pos-inp" type="number" step="0.01" value="${drum.pos.y.toFixed(2)}"
        oninput="updateDrumPos('${drum.id}','y',+this.value)">
      <input class="drum-pos-slider" type="range" min="-0.90" max="0.90" step="0.01"
        value="${drum.pos.y.toFixed(2)}"
        oninput="updateDrumPos('${drum.id}','y',+this.value);syncSlider(this,'y')">
    </div>
    <div class="drum-pos-group">
      <label>Z (높이)</label>
      <input class="drum-pos-inp" type="number" step="0.01" value="${drum.pos.z.toFixed(2)}"
        oninput="updateDrumPos('${drum.id}','z',+this.value)">
      <input class="drum-pos-slider" type="range" min="0.25" max="1.00" step="0.01"
        value="${drum.pos.z.toFixed(2)}"
        oninput="updateDrumPos('${drum.id}','z',+this.value);syncSlider(this,'z')">
    </div>
  </div>
  <span class="drum-reach-badge ${reachCls}">${reachTxt} ${drum.type==='kick'?'(확장)':''}</span>
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
    const dist     = reachDist(drum);
    const badge    = item.querySelector('.drum-reach-badge');
    if (badge) {
      badge.className = 'drum-reach-badge ' + (dist > MAX_REACH ? 'reach-err' : dist > MAX_REACH * 0.88 ? 'reach-warn' : 'reach-ok');
      badge.textContent = (dist > MAX_REACH ? `도달 불가 (${dist.toFixed(2)}m)` : `${dist.toFixed(2)}m`) + (drum.type==='kick'?' (확장)':'');
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

  _playKFs = buildKeyframes();
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
document.getElementById('meter-sel').addEventListener('change', () => {
  beatsPerBar = parseInt(document.getElementById('meter-sel').value) || 4;
  renderTimeline(); updateTLInfo();
});
document.getElementById('bars-inp').addEventListener('change', () => {
  totalBars = parseInt(document.getElementById('bars-inp').value) || 4;
  renderTimeline(); updateTLInfo();
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
updateFK({ ...NEUTRAL });
renderDrumList();
renderSkinPresets();
rebuildDrumSpheres();
renderTimeline();
updateTLInfo();
setStatus('드럼 키트 로드됨 — 타임라인 클릭으로 배치 · 뷰포트 드래그로 위치 이동');
