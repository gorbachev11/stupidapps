import * as THREE from 'https://unpkg.com/three@0.161.0/build/three.module.js';

const scene = new THREE.Scene();
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1800);
const player = { pos: new THREE.Vector3(0, 25, 140), yaw: 0, pitch: 0, vy: 0, onGround: false, speed: 22 };

const ui = {
  thirstBar: byId('thirstBar'), hungerBar: byId('hungerBar'), peaceBar: byId('peaceBar'), wellBar: byId('wellBar'),
  thirstTxt: byId('thirstTxt'), hungerTxt: byId('hungerTxt'), peaceTxt: byId('peaceTxt'), wellTxt: byId('wellTxt'),
  weatherTxt: byId('weatherTxt'), hover: byId('hoverInfo'), msg: byId('message'), sack: byId('sack'),
  start: byId('startOverlay'), editorPanel: byId('editorPanel'), editorInfo: byId('editorInfo')
};

const world = { size: 540, objs: [], smallItems: [], largeItems: [], wildlife: [] };
const raycaster = new THREE.Raycaster();
const keys = new Set();
const sack = [];
let carriedLarge = null;
let hovered = null;
let dragItem = null;
let locked = false;
let holdBacktick = 0;
let editor = { active: false, type: null, proto: null };
const prefabDefs = JSON.parse(localStorage.getItem('prefabDefs') || '{}');

const simeon = {
  thirst: 16, hunger: 10, peace: 95, wellbeing: 96,
  fasting: false, fastingTimer: 0,
  quotes: [
    '“Keep your heart in heaven, and your body will endure.” — attributed in Theodoret’s Life of Simeon',
    '“Let prayer be your food before bread.” — attributed tradition of Simeon Stylites',
    '“Endure little hardships willingly; great burdens grow light.” — attributed in Syriac ascetic tradition'
  ]
};

const weatherCfg = {
  clear: { thirstMul: 1.0, fog: [120, 520], sun: 1.0, rain: false, dust: 0 },
  scorching: { thirstMul: 2.4, fog: [150, 560], sun: 1.6, rain: false, dust: 0.1 },
  rain: { thirstMul: 0.25, fog: [110, 430], sun: 0.55, rain: true, dust: 0 },
  dust: { thirstMul: 1.9, fog: [1.4, 3.3], sun: 0.75, rain: false, dust: 1.0 },
  night: { thirstMul: 0.6, fog: [70, 230], sun: 0.16, rain: false, dust: 0 }
};
const weatherState = {
  current: 'clear', target: 'clear', blend: 1, timer: 35,
  transitionDuration: 90, // intentionally slow, 50%+ slower
  dayTime: 0.2, daySpeed: 0.0045 // slow day-night transitions
};

setupScene();
spawnWorld();
updateHUD();
animate();

function byId(id) { return document.getElementById(id); }
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function rnd(a, b) { return a + Math.random() * (b - a); }
function choose(a) { return a[(Math.random() * a.length) | 0]; }

function terrainHeight(x, z) {
  const n = Math.sin(x * 0.016) * 4.5 + Math.cos(z * 0.014) * 3.9 + Math.sin((x + z) * 0.011) * 3;
  const r = Math.hypot(x, z);
  const summit = 72 * Math.exp(-(r * r) / 29000); // tower always at highest zone
  const canyon = -14 * Math.exp(-Math.pow((x + 130) / 26, 2));
  return n + summit + canyon;
}

function groundAt(v) { return terrainHeight(v.x, v.z); }

function setupScene() {
  scene.fog = new THREE.Fog(0xb9a280, 110, 520);
  scene.background = new THREE.Color(0xb8a67f);

  const hemi = new THREE.HemisphereLight(0xe9deca, 0x6e5a46, 1.25); scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff1cf, 1.1); sun.position.set(100, 220, 30); scene.add(sun);
  scene.userData.sun = sun;

  const terrain = new THREE.PlaneGeometry(world.size, world.size, 180, 180);
  terrain.rotateX(-Math.PI / 2);
  const pos = terrain.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    pos.setY(i, terrainHeight(x, z));
  }
  terrain.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ color: 0xc7aa73, flatShading: true });
  const mesh = new THREE.Mesh(terrain, mat); scene.add(mesh);

  buildTower();
  buildCreekCanyon();
  buildCave();

  document.body.addEventListener('click', () => { renderer.domElement.requestPointerLock(); });
  document.addEventListener('pointerlockchange', () => {
    locked = document.pointerLockElement === renderer.domElement;
    ui.start.style.display = locked ? 'none' : 'grid';
  });
  document.addEventListener('mousemove', (e) => {
    if (!locked || editor.active) return;
    player.yaw -= e.movementX * 0.002;
    player.pitch = clamp(player.pitch - e.movementY * 0.002, -1.4, 1.4);
  });

  addEventListener('keydown', (e) => {
    keys.add(e.key.toLowerCase());
    if (e.key === ' ') e.preventDefault();
  });
  addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight);
  });

  addEventListener('mousedown', (e) => {
    if (e.button !== 0 || !hovered?.userData.pickupSmall) return;
    dragItem = hovered;
    tell(`Dragging ${hovered.userData.label}. Drop into sack panel.`);
  });
  byId('sack').addEventListener('mouseup', () => {
    if (!dragItem) return;
    sack.push(dragItem.userData.itemType);
    removeFromWorld(dragItem, true);
    dragItem = null;
    renderSack();
  });

  byId('dumpBtn').onclick = dumpSack;
  byId('deliverBtn').onclick = tryDeliver;
}

function buildTower() {
  const summitY = terrainHeight(0, 0);
  const base = new THREE.Mesh(new THREE.CylinderGeometry(12, 13, 8, 8), new THREE.MeshStandardMaterial({ color: 0x9a8b7f, flatShading: true }));
  base.position.set(0, summitY + 4, 0); base.userData = { label: 'Raised Tower Base', tower: true, interact: true }; scene.add(base); world.objs.push(base);

  const tower = new THREE.Mesh(new THREE.CylinderGeometry(5.5, 6.2, 36, 8), new THREE.MeshStandardMaterial({ color: 0xc9b8a2, flatShading: true }));
  tower.position.set(0, summitY + 22, 0); tower.userData = { label: 'Tower of Simeon', tower: true, interact: true }; scene.add(tower); world.objs.push(tower);

  const bucket = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.1, 1.8, 6), new THREE.MeshStandardMaterial({ color: 0x6d4f2d, flatShading: true }));
  bucket.position.set(0, summitY + 1.2, 10); bucket.userData = { label: 'Bucket & Rope', bucket: true, interact: true }; scene.add(bucket); world.objs.push(bucket);

  const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 8.0, 6), new THREE.MeshStandardMaterial({ color: 0xb2936a }));
  rope.position.set(0, summitY + 5.4, 8.5); scene.add(rope);
}

function buildCreekCanyon() {
  const g = new THREE.PlaneGeometry(240, 14, 100, 4);
  g.rotateX(-Math.PI / 2);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i) - 130;
    const z = p.getZ(i) - 120;
    p.setX(i, x); p.setZ(i, z);
    p.setY(i, terrainHeight(x, z) + 0.5);
  }
  const water = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0x4f98af, transparent: true, opacity: 0.78, flatShading: true }));
  water.userData = { water: true, label: 'Creek Water', interact: true };
  scene.add(water);
  world.water = water;
}

function buildCave() {
  const x = 180, z = -150, y = terrainHeight(x, z) + 6;
  const shell = new THREE.Mesh(new THREE.ConeGeometry(24, 18, 8), new THREE.MeshStandardMaterial({ color: 0x7c6a58, flatShading: true }));
  shell.position.set(x, y, z); shell.rotation.y = 1.2; scene.add(shell);
  const mouth = new THREE.Mesh(new THREE.BoxGeometry(10, 6, 12), new THREE.MeshStandardMaterial({ color: 0x221d18, flatShading: true }));
  mouth.position.set(x + 2, y - 3, z + 4); mouth.userData = { label: 'Cave Entrance', interact: true };
  scene.add(mouth); world.objs.push(mouth);
}

function spawnWorld() {
  for (let i = 0; i < 260; i++) spawnFlora(i);
  for (let i = 0; i < 40; i++) spawnSmall('food');
  for (let i = 0; i < 30; i++) spawnSmall('water');
  for (let i = 0; i < 42; i++) spawnLarge('slab');
  for (let i = 0; i < 24; i++) spawnLarge('log');
  for (let i = 0; i < 20; i++) spawnLarge('cactus');
  for (let i = 0; i < 18; i++) spawnLarge('pampas');
  for (let i = 0; i < 14; i++) spawnWildlife();
}

function randomGround(nearWater = false) {
  let x, z;
  for (let tries = 0; tries < 50; tries++) {
    x = rnd(-world.size * .45, world.size * .45);
    z = rnd(-world.size * .45, world.size * .45);
    if (Math.hypot(x, z) < 26) continue;
    if (nearWater && Math.abs(x + 130) > 34) continue;
    break;
  }
  const y = terrainHeight(x, z);
  return new THREE.Vector3(x, y, z);
}

function spawnFlora(i) {
  const nearWater = Math.random() < 0.16;
  const p = randomGround(nearWater);
  let m;
  if (nearWater && Math.random() < 0.22) m = makePalm(p);
  else if (nearWater && Math.random() < 0.38) m = makeGrass(p, true);
  else if (Math.random() < 0.3) m = makeBush(p);
  else m = makeGrass(p, false);
  scene.add(m); world.objs.push(m);
}

function makeBush(p) {
  const m = new THREE.Mesh(new THREE.DodecahedronGeometry(rnd(0.6, 1.3), 0), new THREE.MeshStandardMaterial({ color: 0x778747, flatShading: true }));
  m.position.copy(p).add(new THREE.Vector3(0, m.geometry.parameters.radius, 0));
  m.userData = { label: 'Desert Bush', interact: true };
  return m;
}
function makeGrass(p, tall) {
  const h = tall ? rnd(1.4, 2.8) : rnd(0.3, 1.1);
  const g = new THREE.ConeGeometry(tall ? 0.5 : 0.2, h, 5);
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: tall ? 0x95b86e : 0x8da75b, flatShading: true }));
  m.position.copy(p).add(new THREE.Vector3(0, h * 0.5, 0));
  m.rotation.z = tall ? rnd(0.1, 0.36) : rnd(-0.05, 0.05);
  m.userData = { label: tall ? 'Pampas Grass Patch' : 'Grass Filament', interact: true };
  return m;
}
function makePalm(p) {
  const grp = new THREE.Group();
  const def = prefabDefs.palm || { trunkScale: 1, leafScale: 1, leafCount: 5 };
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.52, 4.5 * def.trunkScale, 6), new THREE.MeshStandardMaterial({ color: 0x8f6c43, flatShading: true }));
  trunk.position.y = trunk.geometry.parameters.height / 2; trunk.rotation.z = 0.24;
  grp.add(trunk);
  for (let i = 0; i < def.leafCount; i++) {
    const leaf = new THREE.Mesh(new THREE.BoxGeometry(2.0 * def.leafScale, 0.14, 0.34), new THREE.MeshStandardMaterial({ color: 0x5ea04f, flatShading: true }));
    leaf.position.y = trunk.geometry.parameters.height * 0.96;
    leaf.rotation.y = i * (Math.PI * 2 / def.leafCount); leaf.rotation.z = -0.45;
    grp.add(leaf);
  }
  grp.position.copy(p);
  grp.userData = { label: 'Palm Tree', interact: true, editable: 'palm' };
  return grp;
}

function spawnSmall(type) {
  const p = randomGround(type === 'water');
  const geo = type === 'food' ? new THREE.IcosahedronGeometry(0.42, 0) : new THREE.CylinderGeometry(0.26, 0.26, 0.7, 6);
  const col = type === 'food' ? 0xb7804e : 0x64aac8;
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: col, flatShading: true }));
  m.position.copy(p).add(new THREE.Vector3(0, 0.45, 0));
  m.userData = { label: type === 'food' ? 'Dry Food Bundle' : 'Water Vessel', interact: true, pickupSmall: true, itemType: type };
  scene.add(m); world.smallItems.push(m);
}

function spawnLarge(type) {
  const p = randomGround(type === 'pampas');
  let m;
  if (type === 'slab') {
    m = new THREE.Mesh(new THREE.BoxGeometry(rnd(2.3, 4.4), rnd(0.5, 1.1), rnd(1.0, 1.9)), mat(0x998b7f));
    m.userData = { label: 'Stone Slab', interact: true, carryLarge: true, kind: 'slab' };
  } else if (type === 'log') {
    m = new THREE.Mesh(new THREE.CylinderGeometry(0.44, 0.44, rnd(3.5, 6.6), 8), mat(0x7f5e3d));
    m.rotation.z = Math.PI / 2;
    m.userData = { label: 'Tree Trunk', interact: true, carryLarge: true, kind: 'log' };
  } else if (type === 'cactus') {
    m = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.5, rnd(2.2, 3.2), 6), mat(0x6fa550));
    m.userData = { label: 'Carryable Cactus', interact: true, carryLarge: true, kind: 'cactus', editable: 'cactus' };
  } else {
    const grp = new THREE.Group();
    const def = prefabDefs.pampas || { h: 2.2, curve: 0.32, count: 8 };
    for (let i = 0; i < def.count; i++) {
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.09, def.h * rnd(.55, 1.0), 0.09), mat(0x9ebf71));
      blade.position.y = blade.geometry.parameters.height / 2;
      blade.rotation.z = rnd(0.05, def.curve);
      blade.rotation.y = i * (Math.PI * 2 / def.count);
      grp.add(blade);
    }
    m = grp;
    m.userData = { label: 'Carryable Pampas', interact: true, carryLarge: true, kind: 'pampas', editable: 'pampas' };
  }
  m.position.copy(p).add(new THREE.Vector3(0, 0.5, 0));
  scene.add(m); world.largeItems.push(m);
}

function spawnWildlife() {
  const bird = new THREE.Mesh(new THREE.ConeGeometry(0.32, 1.0, 3), mat(0x2a2a2a));
  bird.rotation.z = Math.PI / 2;
  bird.userData = { wildlife: true, t: Math.random() * Math.PI * 2, radius: rnd(24, 120), speed: rnd(.08, .2), y: rnd(28, 70) };
  scene.add(bird); world.wildlife.push(bird);
}

function mat(c) { return new THREE.MeshStandardMaterial({ color: c, flatShading: true }); }

function animate() {
  requestAnimationFrame(animate);
  const dt = 0.016;
  updatePlayer(dt);
  updateRaycast();
  updateMeters(dt);
  updateWeather(dt);
  updateWildlife(dt);
  updateCarry(dt);
  updateEditor(dt);
  updateWaterAnim();
  renderer.render(scene, camera);
}

function updatePlayer(dt) {
  if (!locked || editor.active) return;
  const carryingSlow = carriedLarge ? 0.3 : 1.0;
  const speed = player.speed * carryingSlow;
  const dir = new THREE.Vector3();
  if (keys.has('w')) dir.z -= 1;
  if (keys.has('s')) dir.z += 1;
  if (keys.has('a')) dir.x -= 1;
  if (keys.has('d')) dir.x += 1;
  if (dir.lengthSq() > 0) dir.normalize();
  const fwd = new THREE.Vector3(Math.sin(player.yaw), 0, Math.cos(player.yaw));
  const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0));
  player.pos.add(fwd.multiplyScalar(-dir.z * speed * dt));
  player.pos.add(right.multiplyScalar(dir.x * speed * dt));

  if (keys.has(' ') && player.onGround) { player.vy = 8.5; player.onGround = false; }
  player.vy -= 20 * dt;
  player.pos.y += player.vy * dt;
  const g = groundAt(player.pos) + 1.8;
  if (player.pos.y <= g) { player.pos.y = g; player.vy = 0; player.onGround = true; }

  camera.position.copy(player.pos);
  camera.rotation.set(player.pitch, player.yaw, 0, 'YXZ');

  if (keys.has('e')) { interactPress(); keys.delete('e'); }
}

function updateRaycast() {
  raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
  const arr = world.objs.concat(world.smallItems, world.largeItems, [world.water]).filter(Boolean);
  const hits = raycaster.intersectObjects(arr, true);
  hovered = hits.length ? ascendTagged(hits[0].object) : null;
  if (hovered) {
    const d = hovered.position.distanceTo(player.pos);
    ui.hover.textContent = d < 7 ? `${hovered.userData.label} — press E` : `${hovered.userData.label} (too far)`;
  } else ui.hover.textContent = 'Wander and observe the desert.';
}
function ascendTagged(o) {
  let n = o;
  while (n && !n.userData?.interact && n.parent) n = n.parent;
  return n || o;
}

function interactPress() {
  if (!hovered || hovered.position.distanceTo(player.pos) > 7) return;
  if (carriedLarge) return dropCarried();
  if (hovered.userData.carryLarge) return pickupLarge(hovered);
  if (hovered.userData.pickupSmall) {
    sack.push(hovered.userData.itemType);
    removeFromWorld(hovered, true);
    renderSack();
    return tell(`${hovered.userData.label} packed into sack.`);
  }
  if (hovered.userData.water) {
    sack.push('water'); renderSack(); tell('Filled a water vessel from creek.');
    return;
  }
  if (hovered.userData.bucket || hovered.userData.tower) return tryDeliver();
}

function pickupLarge(o) {
  carriedLarge = o;
  o.userData.wasCarry = true;
  tell(`Carrying ${o.userData.label}. Movement reduced by 70%. Press E to drop.`);
}
function dropCarried() {
  const forward = new THREE.Vector3(Math.sin(player.yaw), 0, Math.cos(player.yaw)).multiplyScalar(2.5);
  carriedLarge.position.copy(player.pos).add(forward);
  carriedLarge.position.y = terrainHeight(carriedLarge.position.x, carriedLarge.position.z) + 0.6;

  // primitive support & balance rule (outer 20% causes tipping)
  const below = world.largeItems.filter(o => o !== carriedLarge && o.position.distanceTo(carriedLarge.position) < 2.8);
  if (below.length) {
    const s = below[0];
    const dx = Math.abs(carriedLarge.position.x - s.position.x);
    const dz = Math.abs(carriedLarge.position.z - s.position.z);
    if (dx > 0.8 || dz > 0.8) {
      carriedLarge.rotation.x += rnd(0.6, 1.3);
      carriedLarge.position.y -= 0.7;
      tell('Unbalanced placement: it slips off the edge.');
    }
  }
  carriedLarge = null;
  recheckSupport();
}

function updateCarry() {
  if (!carriedLarge) return;
  const f = new THREE.Vector3(Math.sin(player.yaw), 0, Math.cos(player.yaw)).multiplyScalar(2.3);
  carriedLarge.position.copy(player.pos).add(f).add(new THREE.Vector3(0, -0.2, 0));
  carriedLarge.rotation.y += 0.01;
}

function recheckSupport() {
  world.largeItems.forEach(o => {
    const near = world.largeItems.some(other => other !== o && other.position.distanceTo(o.position) < 2.0 && other.position.y < o.position.y - 0.2);
    if (!near && o.position.y > terrainHeight(o.position.x, o.position.z) + 1.0) {
      o.position.y = terrainHeight(o.position.x, o.position.z) + 0.6;
      o.rotation.x *= 0.7;
    }
  });
}

function dumpSack() {
  const p = player.pos.clone().add(new THREE.Vector3(Math.sin(player.yaw) * 2.5, 0, Math.cos(player.yaw) * 2.5));
  for (const item of sack.splice(0)) {
    const geo = item === 'food' ? new THREE.IcosahedronGeometry(0.42, 0) : new THREE.CylinderGeometry(0.26, 0.26, 0.7, 6);
    const col = item === 'food' ? 0xb7804e : 0x64aac8;
    const m = new THREE.Mesh(geo, mat(col));
    m.position.copy(p).add(new THREE.Vector3(rnd(-.7, .7), 0.45, rnd(-.7, .7)));
    m.userData = { label: item === 'food' ? 'Dry Food Bundle' : 'Water Vessel', interact: true, pickupSmall: true, itemType: item };
    scene.add(m); world.smallItems.push(m);
  }
  renderSack();
  tell('Sack contents dumped nearby for pre-staging.');
}

function tryDeliver() {
  const needWater = weatherState.current !== 'rain' && simeon.thirst > 58;
  const needFood = simeon.hunger > 56;
  const interruptPenalty = (!needWater && !needFood) ? 9 : 2;
  simeon.peace = clamp(simeon.peace - interruptPenalty, 0, 100);

  let used = false;
  if (needWater && sack.includes('water')) { removeOne('water'); simeon.thirst -= 40; used = true; }
  if (needFood && sack.includes('food')) { removeOne('food'); simeon.hunger -= 34; used = true; }
  if (used) {
    simeon.thirst = clamp(simeon.thirst, 0, 100); simeon.hunger = clamp(simeon.hunger, 0, 100);
    const q = choose(simeon.quotes);
    tell(`Bucket raised 8m. Simeon says: ${q}${weatherState.current === 'dust' ? ' “The storm blinds the eyes; keep watch within.”' : ''}`);
  } else {
    tell('No needed supplies delivered. Spiritual peace disturbed.');
  }
  renderSack();
}

function removeOne(type) {
  const i = sack.indexOf(type);
  if (i >= 0) sack.splice(i, 1);
}

function updateMeters(dt) {
  const w = weatherCfg[weatherState.current];
  simeon.thirst = clamp(simeon.thirst + dt * 1.55 * w.thirstMul, 0, 100);
  simeon.hunger = clamp(simeon.hunger + dt * 0.58, 0, 100); // slower than thirst
  simeon.fastingTimer -= dt;
  if (simeon.fastingTimer < 0) {
    simeon.fasting = Math.random() < 0.2;
    simeon.fastingTimer = rnd(35, 65);
  }
  if (simeon.fasting) simeon.hunger = Math.max(0, simeon.hunger - 0.1 * dt);

  const deficit = (simeon.thirst * 0.44 + simeon.hunger * 0.28 + (100 - simeon.peace) * 0.2);
  simeon.wellbeing = clamp(100 - deficit, 0, 100);
  if (simeon.thirst > 85 && simeon.hunger > 75) simeon.wellbeing = clamp(simeon.wellbeing - dt * 1.4, 0, 100);

  ui.thirstBar.style.width = `${simeon.thirst}%`; ui.thirstTxt.textContent = `${simeon.thirst.toFixed(0)}%`;
  ui.hungerBar.style.width = `${simeon.hunger}%`; ui.hungerTxt.textContent = `${simeon.hunger.toFixed(0)}%`;
  ui.peaceBar.style.width = `${simeon.peace}%`; ui.peaceTxt.textContent = `${simeon.peace.toFixed(0)}%`;
  ui.wellBar.style.width = `${simeon.wellbeing}%`; ui.wellTxt.textContent = `${simeon.wellbeing.toFixed(0)}%`;
}

function updateWeather(dt) {
  weatherState.timer -= dt;
  if (weatherState.timer <= 0) {
    weatherState.target = choose(['clear', 'scorching', 'rain', 'dust', 'night']);
    weatherState.timer = rnd(48, 90);
    weatherState.blend = 0;
  }
  weatherState.blend = clamp(weatherState.blend + dt / weatherState.transitionDuration, 0, 1);
  weatherState.current = weatherState.blend < 1 ? weatherState.current : weatherState.target;

  const c = weatherCfg[weatherState.current];
  scene.fog.near += (c.fog[0] - scene.fog.near) * 0.02;
  scene.fog.far += (c.fog[1] - scene.fog.far) * 0.02;
  scene.userData.sun.intensity += (c.sun - scene.userData.sun.intensity) * 0.01;
  ui.weatherTxt.textContent = `Weather: ${weatherState.current}${simeon.fasting ? ' (Simeon fasting: explore quietly)' : ''}`;

  weatherState.dayTime = (weatherState.dayTime + dt * weatherState.daySpeed) % 1;
  const dayL = 0.23 + Math.sin(weatherState.dayTime * Math.PI * 2) * 0.18;
  renderer.toneMappingExposure = clamp(0.8 + dayL, 0.5, 1.2);
}

function updateWildlife(dt) {
  world.wildlife.forEach((b, i) => {
    const d = b.userData;
    d.t += dt * d.speed;
    b.position.set(Math.cos(d.t + i) * d.radius, d.y + Math.sin(d.t * 2) * 1.6, Math.sin(d.t) * d.radius);
    b.lookAt(b.position.x + 1, b.position.y, b.position.z);
  });
}

function updateWaterAnim() {
  if (!world.water) return;
  const p = world.water.geometry.attributes.position;
  const t = performance.now() * 0.001;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i);
    p.setY(i, terrainHeight(x, z) + 0.5 + Math.sin(x * 0.08 + t * 2 + z * 0.04) * 0.08);
  }
  p.needsUpdate = true;
}

function updateEditor(dt) {
  const nearEditable = hovered && hovered.userData.editable && hovered.position.distanceTo(player.pos) < 6;
  if (keys.has('`') && nearEditable && !editor.active) {
    holdBacktick += dt;
    if (holdBacktick > 1) {
      editor.active = true;
      editor.type = hovered.userData.editable;
      editor.proto = prefabDefs[editor.type] || defaultPrefab(editor.type);
      ui.editorPanel.classList.remove('hidden');
      ui.editorInfo.textContent = `Editing ${editor.type}`;
      tell(`Editor opened for ${editor.type}.`);
    }
  } else if (!keys.has('`')) {
    holdBacktick = 0;
  }
  if (!editor.active) return;

  const step = 0.01;
  if (keys.has('i')) editor.proto.h = (editor.proto.h || 2.2) + step;
  if (keys.has('k')) editor.proto.h = Math.max(0.4, (editor.proto.h || 2.2) - step);
  if (keys.has('j')) editor.proto.curve = Math.max(0, (editor.proto.curve || 0.3) - step * 0.4);
  if (keys.has('l')) editor.proto.curve = (editor.proto.curve || 0.3) + step * 0.4;
  if (keys.has('+') || keys.has('=')) editor.proto.leafScale = (editor.proto.leafScale || 1) + step;
  if (keys.has('-')) editor.proto.leafScale = Math.max(0.3, (editor.proto.leafScale || 1) - step);
  if (keys.has('n')) { editor.proto.leafCount = (editor.proto.leafCount || 5) + 1; keys.delete('n'); }
  if (keys.has('s')) {
    prefabDefs[editor.type] = editor.proto;
    localStorage.setItem('prefabDefs', JSON.stringify(prefabDefs));
    applyPrefabUpdate(editor.type);
    tell(`${editor.type} prefab saved and all instances updated.`);
    keys.delete('s');
  }
  if (keys.has('`')) {
    // keep open until key released then pressed again
  }
  if (keys.has('escape')) closeEditor();
  if (!keys.has('`') && holdBacktick === 0 && editor.active && nearEditable === false) closeEditor();
}
function closeEditor() { editor.active = false; ui.editorPanel.classList.add('hidden'); }
function defaultPrefab(type) {
  if (type === 'palm') return { trunkScale: 1, leafScale: 1, leafCount: 5 };
  if (type === 'pampas') return { h: 2.2, curve: 0.32, count: 8 };
  return { h: 2.6, curve: 0.1, count: 6 };
}
function applyPrefabUpdate(type) {
  const items = world.objs.concat(world.largeItems).filter(o => o.userData?.editable === type);
  for (const old of items) {
    const p = old.position.clone();
    removeFromWorld(old, false);
    const n = type === 'palm' ? makePalm(p) : (() => { spawnLarge(type); return world.largeItems.at(-1); })();
    if (type === 'palm') { scene.add(n); world.objs.push(n); }
  }
}

function removeFromWorld(obj, respawn) {
  scene.remove(obj);
  world.smallItems = world.smallItems.filter(o => o !== obj);
  world.largeItems = world.largeItems.filter(o => o !== obj);
  world.objs = world.objs.filter(o => o !== obj);
  if (respawn) {
    const type = obj.userData.itemType || obj.userData.kind;
    setTimeout(() => {
      if (type === 'food' || type === 'water') spawnSmall(type);
      else if (type) spawnLarge(type);
    }, 9000 + Math.random() * 7000);
  }
}

function renderSack() {
  ui.sack.innerHTML = '';
  sack.forEach((it) => {
    const e = document.createElement('div'); e.className = 'sackItem'; e.textContent = it;
    ui.sack.appendChild(e);
  });
}

let msgTimer = 0;
function tell(t) { ui.msg.textContent = t; msgTimer = 5.5; }
setInterval(() => {
  if (msgTimer > 0) msgTimer -= 0.25;
  else ui.msg.textContent = '';
}, 250);

function updateHUD() { renderSack(); tell('Find food and water. Disturb Simeon only when his needs are truly low.'); }
