const canvas = document.getElementById("viewport");
const ctx = canvas.getContext("2d");
const statusEl = document.getElementById("status");
const legendEl = document.getElementById("legend");

let width = window.innerWidth;
let height = window.innerHeight;
canvas.width = width;
canvas.height = height;

const FLOOR_SIZE = 40;
const WALL_HEIGHT = 12;
const camera = {
  yaw: -Math.PI / 4,
  pitch: -0.45,
  distance: 70,
};

let isDragging = false;
let lastMouse = { x: 0, y: 0 };

canvas.addEventListener("mousedown", (e) => {
  isDragging = true;
  lastMouse = { x: e.clientX, y: e.clientY };
});

window.addEventListener("mouseup", () => (isDragging = false));
window.addEventListener("mouseleave", () => (isDragging = false));

window.addEventListener("mousemove", (e) => {
  if (!isDragging) return;
  const dx = e.clientX - lastMouse.x;
  const dy = e.clientY - lastMouse.y;
  camera.yaw += dx * 0.003;
  camera.pitch = Math.max(-1.2, Math.min(-0.1, camera.pitch + dy * 0.003));
  lastMouse = { x: e.clientX, y: e.clientY };
});

window.addEventListener("wheel", (e) => {
  camera.distance = Math.max(25, Math.min(120, camera.distance + e.deltaY * 0.05));
});

window.addEventListener("resize", () => {
  width = window.innerWidth;
  height = window.innerHeight;
  canvas.width = width;
  canvas.height = height;
});

const entrances = [
  { x: -FLOOR_SIZE / 2 + 1, z: 0 },
  { x: FLOOR_SIZE / 2 - 1, z: 0 },
];

const exits = [
  { x: 0, z: -FLOOR_SIZE / 2 + 1 },
  { x: 0, z: FLOOR_SIZE / 2 - 1 },
];

const attractions = [
  { name: "Art Installation", x: 0, z: -10 },
  { name: "Coffee Bar", x: -10, z: 10 },
  { name: "Stage", x: 12, z: 4 },
];

const speciesConfigs = [
  {
    name: "Workers",
    color: "#60a5fa",
    spawnMeanMs: 1800,
    dwellMeanMs: 20000,
    goals: [
      { attraction: "Coffee Bar", weight: 3 },
      { attraction: "Stage", weight: 1 },
    ],
  },
  {
    name: "Visitors",
    color: "#fbbf24",
    spawnMeanMs: 2500,
    dwellMeanMs: 26000,
    goals: [
      { attraction: "Art Installation", weight: 2 },
      { attraction: "Stage", weight: 1 },
    ],
  },
  {
    name: "Security",
    color: "#ef4444",
    spawnMeanMs: 6000,
    dwellMeanMs: 30000,
    goals: [{ attraction: "Stage", weight: 2 }],
  },
];

const activeAgents = new Set();
const departedAgents = [];
const spawnAccumulators = new Map(speciesConfigs.map((s) => [s.name, 0]));

buildLegend();
renderStats();
let lastTime = performance.now();
requestAnimationFrame(loop);

function loop() {
  const now = performance.now();
  const deltaMs = now - lastTime;
  const deltaSec = deltaMs / 1000;
  lastTime = now;

  spawnAgents(deltaMs);
  for (const agent of Array.from(activeAgents)) {
    agent.update(deltaSec);
    if (agent.state === "exited") {
      activeAgents.delete(agent);
      logAgent(agent);
    }
  }

  drawScene();
  requestAnimationFrame(loop);
}

function spawnAgents(deltaMs) {
  speciesConfigs.forEach((species) => {
    const rate = 1 / species.spawnMeanMs;
    const acc = spawnAccumulators.get(species.name) + deltaMs;
    const probability = 1 - Math.exp(-rate * acc);
    if (Math.random() < probability) {
      const agent = new Agent(species);
      activeAgents.add(agent);
      spawnAccumulators.set(species.name, 0);
    } else {
      spawnAccumulators.set(species.name, acc);
    }
  });
}

function buildLegend() {
  legendEl.innerHTML = "";
  speciesConfigs.forEach((s) => {
    const item = document.createElement("div");
    item.className = "legend-item";
    const swatch = document.createElement("div");
    swatch.className = "swatch";
    swatch.style.background = s.color;
    item.appendChild(swatch);
    const text = document.createElement("span");
    text.textContent = s.name;
    item.appendChild(text);
    legendEl.appendChild(item);
  });
}

function renderStats() {
  const lines = [];
  lines.push(`<strong>Active agents:</strong> ${activeAgents.size}`);
  lines.push(`<strong>Departed agents:</strong> ${departedAgents.length}`);

  const perSpecies = speciesConfigs
    .map((s) => {
      const active = Array.from(activeAgents).filter((a) => a.species.name === s.name).length;
      const left = departedAgents.filter((a) => a.species === s.name).length;
      return `${s.name}: ${active} active, ${left} departed`;
    })
    .join("<br/>");

  const recent = departedAgents.slice(-5).map((d) => {
    const stay = ((d.exitTime - d.spawnTime) / 1000).toFixed(1);
    const reachGoal = d.goalReachedTime ? ((d.goalReachedTime - d.spawnTime) / 1000).toFixed(1) : "-";
    return `${d.species} → ${d.goal}, stay ${stay}s, reached goal at ${reachGoal}s`;
  });

  lines.push(`<div style="margin-top:6px">${perSpecies}</div>`);
  if (recent.length) {
    lines.push("<div style=\"margin-top:6px\"><strong>Recent exits</strong><ul>" + recent.map((r) => `<li>${r}</li>`).join("") + "</ul></div>");
  }

  statusEl.innerHTML = lines.join("<br/>");
}

function logAgent(agent) {
  departedAgents.push({
    species: agent.species.name,
    spawnTime: agent.spawnTime,
    goal: agent.targetAttraction,
    goalReachedTime: agent.goalReachedTime,
    exitTime: agent.exitTime,
  });
  renderStats();
}

class Agent {
  constructor(species) {
    this.species = species;
    this.speed = 2 + Math.random() * 1.2;
    this.spawnTime = performance.now();
    this.goalReachedTime = null;
    this.exitTime = null;

    this.targetAttraction = chooseGoal(species.goals);
    this.dwellDuration = sampleExponential(species.dwellMeanMs);
    this.state = "toGoal";
    this.position = randomEntrance();
    this.velocity = { x: 0, z: 0 };
  }

  update(delta) {
    const now = performance.now();
    let target;

    if (this.state === "toGoal") {
      target = getAttractionPosition(this.targetAttraction);
      if (!this.goalReachedTime && distance(this.position, target) < 1.2) {
        this.goalReachedTime = now;
        this.state = "dwelling";
        this.dwellUntil = now + this.dwellDuration;
      }
    }

    if (this.state === "dwelling" && now >= this.dwellUntil) {
      this.state = "toExit";
    }

    if (this.state === "toExit") {
      target = randomExit();
      if (distance(this.position, target) < 1.2) {
        this.exitTime = now;
        this.state = "exited";
        return;
      }
    }

    if (this.state === "dwelling") {
      const wander = { x: (Math.random() - 0.5) * 0.5, z: (Math.random() - 0.5) * 0.5 };
      target = { x: this.position.x + wander.x, z: this.position.z + wander.z };
    }

    if (target) {
      const dirX = target.x - this.position.x;
      const dirZ = target.z - this.position.z;
      const len = Math.hypot(dirX, dirZ);
      if (len > 0.0001) {
        const nx = dirX / len;
        const nz = dirZ / len;
        this.position.x += nx * this.speed * delta;
        this.position.z += nz * this.speed * delta;
        this.position.x = clamp(this.position.x, -FLOOR_SIZE / 2 + 0.5, FLOOR_SIZE / 2 - 0.5);
        this.position.z = clamp(this.position.z, -FLOOR_SIZE / 2 + 0.5, FLOOR_SIZE / 2 - 0.5);
      }
    }
  }
}

function sampleExponential(meanMs) {
  const lambda = 1 / meanMs;
  return -Math.log(1 - Math.random()) / lambda;
}

function chooseGoal(goals) {
  const total = goals.reduce((sum, g) => sum + g.weight, 0);
  const pick = Math.random() * total;
  let acc = 0;
  for (const goal of goals) {
    acc += goal.weight;
    if (pick <= acc) return goal.attraction;
  }
  return goals[0].attraction;
}

function getAttractionPosition(name) {
  const found = attractions.find((a) => a.name === name);
  return found ? { x: found.x, z: found.z } : { x: 0, z: 0 };
}

function randomEntrance() {
  const base = entrances[Math.floor(Math.random() * entrances.length)];
  return { x: base.x + (Math.random() - 0.5) * 1.2, z: base.z + (Math.random() - 0.5) * 1.2 };
}

function randomExit() {
  return exits[Math.floor(Math.random() * exits.length)];
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function distance(a, b) {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return Math.hypot(dx, dz);
}

function worldToScreen(x, y, z) {
  const cosY = Math.cos(camera.yaw);
  const sinY = Math.sin(camera.yaw);
  const cosP = Math.cos(camera.pitch);
  const sinP = Math.sin(camera.pitch);

  const dx = x;
  const dy = y;
  const dz = z;

  const vx = cosY * dx - sinY * dz;
  const vz = sinY * dx + cosY * dz;
  const vy = dy;

  const vy2 = cosP * vy - sinP * vz;
  const vz2 = sinP * vy + cosP * vz + camera.distance;

  const fov = 90;
  const scale = (height / 2) / Math.tan((fov / 2) * (Math.PI / 180));
  const sx = width / 2 + (vx * scale) / vz2;
  const sy = height / 2 + (vy2 * scale) / vz2;
  const depth = vz2;
  return { x: sx, y: sy, depth };
}

function drawScene() {
  ctx.clearRect(0, 0, width, height);

  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, "#0b1221");
  gradient.addColorStop(1, "#05080f");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  drawFloor();
  drawDoors();
  drawAttractions();
  drawAgents();
}

function drawFloor() {
  const corners = [
    { x: -FLOOR_SIZE / 2, z: -FLOOR_SIZE / 2 },
    { x: FLOOR_SIZE / 2, z: -FLOOR_SIZE / 2 },
    { x: FLOOR_SIZE / 2, z: FLOOR_SIZE / 2 },
    { x: -FLOOR_SIZE / 2, z: FLOOR_SIZE / 2 },
  ];

  ctx.beginPath();
  corners.forEach((c, i) => {
    const p = worldToScreen(c.x, 0, c.z);
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  });
  ctx.closePath();
  ctx.fillStyle = "rgba(30,41,59,0.9)";
  ctx.fill();
  ctx.strokeStyle = "rgba(148,163,184,0.4)";
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

function drawDoors() {
  entrances.forEach((d) => drawDoor(d, "#22c55e", "Entrance"));
  exits.forEach((d) => drawDoor(d, "#ef4444", "Exit"));
}

function drawDoor(pos, color, label) {
  const base = worldToScreen(pos.x, 0, pos.z);
  const top = worldToScreen(pos.x, WALL_HEIGHT / 3, pos.z);
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(base.x, base.y);
  ctx.lineTo(top.x, top.y);
  ctx.stroke();

  ctx.fillStyle = color;
  ctx.font = "12px Inter, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(label, top.x, top.y - 6);
}

function drawAttractions() {
  attractions.forEach((a) => {
    const top = worldToScreen(a.x, 0.5, a.z);
    const size = 16 * (60 / top.depth);
    ctx.fillStyle = "rgba(129,140,248,0.8)";
    ctx.beginPath();
    ctx.ellipse(top.x, top.y, size, size * 0.4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#c7d2fe";
    ctx.font = "12px Inter, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(a.name, top.x, top.y - size * 0.8);
  });
}

function drawAgents() {
  const sorted = Array.from(activeAgents).sort((a, b) => a.position.z - b.position.z);
  sorted.forEach((agent) => {
    const body = worldToScreen(agent.position.x, 1, agent.position.z);
    const head = worldToScreen(agent.position.x, 2, agent.position.z);
    const scale = Math.max(0.6, Math.min(1.4, 80 / body.depth));

    ctx.strokeStyle = "rgba(15,23,42,0.6)";
    ctx.lineWidth = 4 * scale;
    ctx.beginPath();
    ctx.moveTo(body.x, body.y);
    ctx.lineTo(head.x, head.y);
    ctx.stroke();

    ctx.strokeStyle = "rgba(255,255,255,0.18)";
    ctx.lineWidth = 2 * scale;
    ctx.beginPath();
    ctx.moveTo(body.x, body.y);
    ctx.lineTo(head.x, head.y);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(head.x, head.y, 5 * scale, 0, Math.PI * 2);
    ctx.fillStyle = "#f8fafc";
    ctx.fill();

    ctx.beginPath();
    ctx.arc(body.x, body.y + 2 * scale, 6 * scale, 0, Math.PI * 2);
    ctx.fillStyle = agent.species.color;
    ctx.fill();
  });
}
