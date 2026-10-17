/* Generated from the existing audited engine. Do not hand-edit. */
(function(g){"use strict";const modules={"standard-engine.js":function(module,exports,require){
"use strict";

const CONTRACT = require("map-contract.js");

class SeededRng {
  constructor(seed) {
    this.state = (Number(seed) >>> 0) || 1;
  }

  next() {
    this.state = (1664525 * this.state + 1013904223) >>> 0;
    return this.state / 0x100000000;
  }

  d6() {
    return 1 + Math.floor(this.next() * 6);
  }
}

function createGame(map, seed = 1) {
  CONTRACT.validateMap(map);
  const state = {
    schema: "ufs_standard_game_state_v1",
    mapId: map.id,
    seed,
    rngState: (Number(seed) >>> 0) || 1,
    round: 0,
    phase: "new_round",
    energy: map.city.startEnergy,
    damage: 0,
    researchIndex: 0,
    excavatorIndex: map.base.startExcavatorIndex,
    // The row of the mothership's drop points, initially above the first sky row.
    mothershipRow: map.sky.dropRow,
    ships: Array.from({ length: map.columns }, (_, column) => ({
      id: `purple-${column}`,
      color: "purple",
      column,
      row: map.sky.dropRow,
    })),
    waitingShips: [],
    dice: [],
    placements: [],
    robots: [],
    nextWhiteId: 1,
    nextRobotId: 1,
    history: [],
    outcome: null,
  };
  return startRound(map, state);
}

function cloneState(state) {
  return JSON.parse(JSON.stringify(state));
}

function startRound(map, input) {
  const state = cloneState(input);
  assertOngoing(state);
  const rng = rngFromState(state);
  state.round += 1;
  state.phase = "dice";
  state.dice = ["gray", "gray", "gray", "white", "white"].map((color, index) => ({
    id: `r${state.round}-${color}-${index}`,
    color,
    value: rng.d6(),
    placed: false,
  }));
  applyFirstRollAbility(map, state);
  state.placements = [];
  storeRng(state, rng);
  state.history.push({ type: "round_started", round: state.round, dice: state.dice.map(dieView) });
  return state;
}

function legalWorkerPlacements(map, state, dieId) {
  if (state.phase !== "dice") return [];
  const die = state.dice.find((candidate) => candidate.id === dieId && !candidate.placed);
  if (!die) return [];
  const usedColumns = new Set(state.placements.map((placement) => placement.column));
  const alreadyExcavating = state.placements.some((placement) => placement.excavationCandidate);
  const indexes = CONTRACT.indexMap(map);
  const options = [];
  for (const cell of map.base.cells) {
    if (usedColumns.has(cell.column)) continue;
    const room = indexes.roomById.get(cell.roomId);
    const locked = cell.unlockIndex > state.excavatorIndex;
    const distance = cell.unlockIndex - state.excavatorIndex;
    if (locked && (alreadyExcavating || distance > die.value)) continue;
    options.push({
      id: `${die.id}@${cell.id}`,
      dieId: die.id,
      dieColor: die.color,
      dieValue: die.value,
      cellId: cell.id,
      roomId: room.id,
      roomType: room.type,
      column: cell.column,
      excavationCandidate: locked,
      excavationDistance: locked ? distance : 0,
      removesRobotId: state.robots.find((robot) => robot.cellId === cell.id)?.id || null,
    });
  }
  return options;
}

function allLegalWorkerPlacements(map, state) {
  return state.dice.filter((die) => !die.placed).flatMap((die) => legalWorkerPlacements(map, state, die.id));
}

function applyWorkerPlacement(map, input, requested, options = {}) {
  const state = cloneState(input);
  assertOngoing(state);
  const legal = legalWorkerPlacements(map, state, requested.dieId).find((candidate) => candidate.id === requested.id);
  if (!legal) throw new Error(`illegal worker placement: ${requested.id}`);
  const die = state.dice.find((candidate) => candidate.id === legal.dieId);
  die.placed = true;
  if (legal.removesRobotId) state.robots = state.robots.filter((robot) => robot.id !== legal.removesRobotId);
  state.placements.push({ ...legal, resolved: false });

  const descent = Math.max(0, die.value - (legal.roomType === "aa" ? 1 : 0));
  const shipEvents = moveShipsAndResolveLanding(map, state, legal.column, descent);
  state.history.push({
    type: "worker_placed",
    round: state.round,
    die: dieView(die),
    placement: legal,
    descent,
    shipEvents,
  });
  if (state.outcome) return state;

  if (die.color === "white" && state.dice.some((candidate) => !candidate.placed)
    && options.rerollMode !== "deferred") {
    rerollUnplaced(state, options.rerollMode || "actual");
  }
  if (state.dice.every((candidate) => candidate.placed)) state.phase = "rooms";
  return state;
}

function moveShipsAndResolveLanding(map, state, column, descent) {
  if (descent <= 0) return [];
  const events = [];
  const moving = state.ships.filter((ship) => ship.column === column);
  for (const ship of moving) ship.row += descent;

  for (const ship of [...moving]) {
    if (!state.ships.some((candidate) => candidate.id === ship.id)) continue;
    if (ship.row >= map.sky.cityRow) {
      state.ships = state.ships.filter((candidate) => candidate.id !== ship.id);
      state.waitingShips.push({ id: ship.id, color: ship.color });
      damageCity(map, state, 1, "ship_hit");
      events.push({ shipId: ship.id, type: "city_hit" });
    } else {
      events.push({ shipId: ship.id, type: "descended", row: ship.row });
    }
    if (state.outcome) return events;
  }

  const indexes = CONTRACT.indexMap(map);
  const landed = state.ships
    .filter((ship) => ship.column === column && moving.some((candidate) => candidate.id === ship.id))
    .sort((a, b) => a.row - b.row || a.id.localeCompare(b.id));
  for (const ship of landed) {
    if (!state.ships.some((candidate) => candidate.id === ship.id)) continue;
    const effect = indexes.skyRowByIndex.get(ship.row)?.cells?.[ship.column]?.effect;
    if (!effect) continue;
    if (effect.type === "arrow") {
      const occupied = state.ships.some((candidate) => candidate.id !== ship.id
        && candidate.row === effect.targetRow && candidate.column === effect.targetColumn);
      if (!occupied) {
        const from = { row: ship.row, column: ship.column };
        ship.row = effect.targetRow;
        ship.column = effect.targetColumn;
        events.push({ shipId: ship.id, type: "arrow", from, to: { row: ship.row, column: ship.column } });
      } else {
        events.push({ shipId: ship.id, type: "arrow_blocked" });
      }
    } else if (effect.type === "mothership_down") {
      const amount = effect.amount || 1;
      for (let step = 0; step < amount && !state.outcome; step += 1) moveMothershipOnly(map, state, "sky_trigger");
      events.push({ shipId: ship.id, type: "mothership_down", amount });
    }
  }
  return events;
}

function legalRoomActions(map, state) {
  if (state.phase !== "rooms") return [];
  const indexes = CONTRACT.indexMap(map);
  const actions = [];
  for (const placement of state.placements.filter((candidate) => !candidate.resolved && candidate.excavationCandidate)) {
    const targetIndex = indexes.cellById.get(placement.cellId).unlockIndex;
    if (targetIndex <= state.excavatorIndex || targetIndex - state.excavatorIndex > placement.dieValue) continue;
    actions.push({
      type: "excavate",
      placementId: placement.id,
      targetIndex,
      affordable: state.energy >= 1,
    });
  }
  for (const room of map.base.rooms) {
    const sources = completeRoomSources(map, state, room);
    if (!sources) continue;
    actions.push({
      type: "resolve_room",
      roomId: room.id,
      sourceIds: sources.map((source) => source.id),
      roomType: room.type,
      value: sources.reduce((sum, source) => sum + source.value, room.modifier),
      affordable: state.energy >= room.energyCost,
    });
  }
  for (const placement of state.placements.filter((candidate) => !candidate.resolved)) {
    actions.push({ type: "skip_worker", placementId: placement.id });
  }
  for (const robot of state.robots) actions.push({ type: "remove_robot", robotId: robot.id });
  actions.push({ type: "end_rooms" });
  return actions;
}

function applyRoomAction(map, input, action) {
  const state = cloneState(input);
  if (state.phase !== "rooms") throw new Error(`cannot resolve room action during ${state.phase}`);
  if (action.type === "skip_worker") return skipWorker(state, action.placementId);
  if (action.type === "remove_robot") {
    if (!state.robots.some((robot) => robot.id === action.robotId)) throw new Error(`unknown robot ${action.robotId}`);
    state.robots = state.robots.filter((robot) => robot.id !== action.robotId);
    state.history.push({ type: "robot_removed", robotId: action.robotId });
    return state;
  }
  if (action.type === "excavate") return resolveExcavation(map, state, action);
  if (action.type === "resolve_room") return resolveRoom(map, state, action);
  if (action.type === "end_rooms") return endRooms(state);
  throw new Error(`unknown room action: ${action.type}`);
}

function resolveExcavation(map, state, action) {
  const indexes = CONTRACT.indexMap(map);
  const placement = state.placements.find((candidate) => candidate.id === action.placementId && !candidate.resolved);
  if (!placement?.excavationCandidate) throw new Error(`not an unresolved excavation placement: ${action.placementId}`);
  if (state.energy < 1) throw new Error("insufficient energy for excavation");
  const targetIndex = indexes.cellById.get(placement.cellId).unlockIndex;
  if (targetIndex <= state.excavatorIndex || targetIndex - state.excavatorIndex > placement.dieValue) {
    throw new Error("illegal excavation distance");
  }
  state.energy -= 1;
  state.excavatorIndex = targetIndex;
  placement.resolved = true;
  state.history.push({ type: "excavated", placementId: placement.id, targetIndex });
  return state;
}

function resolveRoom(map, state, action) {
  const indexes = CONTRACT.indexMap(map);
  const room = indexes.roomById.get(action.roomId);
  if (!room) throw new Error(`unknown room: ${action.roomId}`);
  const sources = completeRoomSources(map, state, room);
  if (!sources) throw new Error(`room is not complete: ${room.id}`);
  const expectedIds = sources.map((source) => source.id).sort();
  const requestedIds = [...(action.sourceIds || [])].sort();
  if (JSON.stringify(expectedIds) !== JSON.stringify(requestedIds)) throw new Error(`room source mismatch: ${room.id}`);
  if (state.energy < room.energyCost) throw new Error(`insufficient energy for room: ${room.id}`);

  const value = Math.max(0, sources.reduce((sum, source) => sum + source.value, room.modifier));
  state.energy -= room.energyCost;
  const result = { type: room.type, roomId: room.id, value, energyCost: room.energyCost };

  if (room.type === "energy") {
    const before = state.energy;
    state.energy = Math.min(map.city.maxEnergy, state.energy + value);
    result.gained = state.energy - before;
  } else if (room.type === "fighter") {
    result.destroyed = destroyShips(map, state, value);
  } else if (room.type === "research") {
    const maxSteps = maxResearchAdvance(map, state, room, value);
    const steps = action.advanceSteps == null ? maxSteps : action.advanceSteps;
    if (!Number.isInteger(steps) || steps < 0 || steps > maxSteps) throw new Error(`illegal research advance: ${steps}/${maxSteps}`);
    state.researchIndex += steps;
    result.advanced = steps;
    if (state.researchIndex >= map.research.costs.length) win(state);
  } else if (room.type === "robot") {
    result.installed = installRobot(map, state, action, value);
  } else if (room.type !== "aa" && room.type !== "tunnel") {
    throw new Error(`unsupported room type: ${room.type}`);
  }

  consumeSources(state, sources);
  state.history.push({ type: "room_resolved", ...result });
  return state;
}

function completeRoomSources(map, state, room) {
  const sources = [];
  for (const cellId of room.cellIds) {
    const placement = state.placements.find((candidate) => candidate.cellId === cellId && !candidate.resolved);
    if (placement) {
      if (placement.excavationCandidate) return null;
      sources.push({ id: placement.id, kind: "worker", cellId, value: placement.dieValue });
      continue;
    }
    const robot = state.robots.find((candidate) => candidate.cellId === cellId && !candidate.exhausted);
    if (robot) {
      sources.push({ id: robot.id, kind: "robot", cellId, value: robot.value });
      continue;
    }
    return null;
  }
  return sources;
}

function maxResearchAdvance(map, state, room, value) {
  let budget = value;
  let steps = 0;
  while (state.researchIndex + steps < map.research.costs.length) {
    const nextIndex = state.researchIndex + steps;
    const reachesTop = nextIndex === map.research.costs.length - 1;
    if (reachesTop && map.research.finalRequiresMultiSpace && room.cellIds.length < 2) break;
    const cost = map.research.costs[nextIndex];
    if (cost > budget) break;
    budget -= cost;
    steps += 1;
  }
  return steps;
}

function installRobot(map, state, action, roomValue) {
  const indexes = CONTRACT.indexMap(map);
  const target = indexes.cellById.get(action.targetCellId);
  if (!target || target.unlockIndex > state.excavatorIndex) throw new Error("robot target must be an excavated cell");
  if (state.placements.some((placement) => placement.cellId === target.id && !placement.resolved)
    || state.robots.some((robot) => robot.cellId === target.id)) throw new Error("robot target is occupied");
  if (state.robots.length >= map.city.robotLimit) {
    if (!action.removeRobotId || !state.robots.some((robot) => robot.id === action.removeRobotId)) {
      throw new Error("robot limit reached; removeRobotId required");
    }
    state.robots = state.robots.filter((robot) => robot.id !== action.removeRobotId);
  }
  const robot = {
    id: `robot-${state.nextRobotId}`,
    cellId: target.id,
    value: Math.min(6, roomValue),
    exhausted: true,
    installedRound: state.round,
  };
  state.nextRobotId += 1;
  state.robots.push(robot);
  return { ...robot };
}

function consumeSources(state, sources) {
  for (const source of sources) {
    if (source.kind === "worker") {
      const placement = state.placements.find((candidate) => candidate.id === source.id);
      placement.resolved = true;
    } else {
      const robot = state.robots.find((candidate) => candidate.id === source.id);
      if (!robot) continue;
      robot.value -= 1;
      robot.exhausted = true;
      if (robot.value <= 0) state.robots = state.robots.filter((candidate) => candidate.id !== robot.id);
    }
  }
}

function skipWorker(state, placementId) {
  const placement = state.placements.find((candidate) => candidate.id === placementId && !candidate.resolved);
  if (!placement) throw new Error(`unknown unresolved worker: ${placementId}`);
  placement.resolved = true;
  state.history.push({ type: "worker_skipped", placementId });
  return state;
}

function endRooms(state) {
  for (const placement of state.placements) placement.resolved = true;
  for (const robot of state.robots) robot.exhausted = false;
  state.phase = "mothership";
  state.history.push({ type: "rooms_ended", round: state.round });
  return state;
}

function resolveMothership(map, input, options = {}) {
  const state = cloneState(input);
  if (state.phase !== "mothership") throw new Error(`cannot resolve mothership during ${state.phase}`);
  moveMothershipOnly(map, state, "mothership_phase");
  if (state.outcome) return state;
  const indexes = CONTRACT.indexMap(map);
  const row = indexes.skyRowByIndex.get(state.mothershipRow);
  for (const action of row?.mothershipActions || []) {
    applyMothershipAction(map, state, action);
    if (state.outcome) return state;
  }
  if (options.deferSpawns === true) {
    state.phase = "spawning";
    return state;
  }
  spawnWaitingShips(map, state, options.spawnPolicy);
  state.history.push({ type: "mothership_phase_ended", round: state.round, mothershipRow: state.mothershipRow });
  if (!state.outcome && options.startNextRound !== false) return startRound(map, state);
  if (!state.outcome) state.phase = "new_round";
  return state;
}

function nextSpawnChoice(map, state) {
  if (state.phase !== "spawning" || state.outcome) return null;
  const waiting = [...state.waitingShips]
    .sort((a, b) => colorPriority(a.color) - colorPriority(b.color))[0];
  if (!waiting) return null;
  const candidates = spawnCandidates(map, state);
  return candidates.length ? { waiting: { ...waiting }, candidates } : null;
}

function spawnCandidates(map, state) {
  const dropRow = state.mothershipRow;
  const openColumns = Array.from({ length: map.columns }, (_, column) => column)
    .filter((column) => !state.ships.some((ship) => (
      ship.column === column && ship.row === dropRow
    )));
  if (!openColumns.length) return [];
  const emptyColumns = openColumns.filter((column) => (
    !state.ships.some((ship) => ship.column === column)
  ));
  let candidates = emptyColumns;
  if (!candidates.length) {
    const distances = openColumns.map((column) => ({
      column,
      distance: Math.min(...state.ships
        .filter((ship) => ship.column === column)
        .map((ship) => ship.row)) - dropRow,
    }));
    const farthest = Math.max(...distances.map((row) => row.distance));
    candidates = distances.filter((row) => row.distance === farthest).map((row) => row.column);
  }
  return candidates;
}

function applySpawnChoice(map, input, requested) {
  const state = cloneState(input);
  const next = nextSpawnChoice(map, state);
  if (!next) throw new Error("no spawn choice is pending");
  if (requested.shipId !== next.waiting.id || !next.candidates.includes(requested.column)) {
    throw new Error(`illegal spawn choice: ${requested.shipId}@${requested.column}`);
  }
  state.waitingShips = state.waitingShips.filter((ship) => ship.id !== requested.shipId);
  state.ships.push({
    id: next.waiting.id,
    color: next.waiting.color,
    column: requested.column,
    row: state.mothershipRow,
  });
  state.history.push({
    type: "ship_spawned",
    shipId: next.waiting.id,
    column: requested.column,
    row: state.mothershipRow,
  });
  return state;
}

function finishDeferredMothership(state) {
  const next = cloneState(state);
  if (next.phase !== "spawning") throw new Error(`cannot finish spawning during ${next.phase}`);
  next.phase = next.outcome ? next.phase : "new_round";
  next.history.push({
    type: "mothership_phase_ended",
    round: next.round,
    mothershipRow: next.mothershipRow,
  });
  return next;
}

function moveMothershipOnly(map, state, source) {
  const fromRow = state.mothershipRow;
  state.mothershipRow += 1;
  // Collect ships on the newly covered SKY row before carrying the ships that
  // stayed on the mothership's drop points (e.g. after placing a 1 in AA).
  const collected = state.ships.filter((ship) => ship.row === state.mothershipRow);
  if (collected.length) {
    state.ships = state.ships.filter((ship) => ship.row !== state.mothershipRow);
    state.waitingShips.push(...collected.map((ship) => ({ id: ship.id, color: ship.color })));
  }
  const carried = state.ships.filter((ship) => ship.row === fromRow);
  for (const ship of carried) ship.row = state.mothershipRow;
  state.history.push({
    type: "mothership_moved", source, row: state.mothershipRow,
    collected: collected.map((ship) => ship.id),
    carried: carried.map((ship) => ship.id),
  });
  if (state.mothershipRow >= map.sky.skullRow) lose(state, "mothership_reached_skull");
}

function applyMothershipAction(map, state, action) {
  if (action.type === "damage") {
    damageCity(map, state, action.amount, "mothership_action");
  } else if (action.type === "research_back") {
    state.researchIndex = Math.max(0, state.researchIndex - action.amount);
  } else if (action.type === "excavator_back") {
    state.excavatorIndex = Math.max(map.base.startExcavatorIndex, state.excavatorIndex - action.amount);
    const indexes = CONTRACT.indexMap(map);
    state.robots = state.robots.filter((robot) => indexes.cellById.get(robot.cellId).unlockIndex <= state.excavatorIndex);
  } else if (action.type === "spawn_white") {
    const whiteLimit = map.whiteShipPool || 4;
    const activeWhites = state.ships.filter((ship) => ship.color === "white").length
      + state.waitingShips.filter((ship) => ship.color === "white").length;
    const amount = Math.min(action.amount, Math.max(0, whiteLimit - activeWhites));
    for (let index = 0; index < amount; index += 1) {
      state.waitingShips.push({ id: `white-${state.nextWhiteId}`, color: "white" });
      state.nextWhiteId += 1;
    }
  } else {
    throw new Error(`unknown mothership action: ${action.type}`);
  }
  state.history.push({ type: "mothership_action", action: { ...action } });
}

function spawnWaitingShips(map, state, spawnPolicy = null) {
  assertOngoing(state);
  const ordered = [...state.waitingShips].sort((a, b) => colorPriority(a.color) - colorPriority(b.color));
  const remaining = [];
  state.waitingShips = [];
  for (const waiting of ordered) {
    const candidates = spawnCandidates(map, state);
    if (!candidates.length) {
      remaining.push(waiting);
      continue;
    }
    const chosen = spawnPolicy ? spawnPolicy({ waiting: { ...waiting }, candidates: [...candidates], state: cloneState(state) }) : Math.min(...candidates);
    if (!candidates.includes(chosen)) throw new Error(`spawn policy selected illegal column: ${chosen}`);
    state.ships.push({ id: waiting.id, color: waiting.color, column: chosen, row: state.mothershipRow });
  }
  state.waitingShips.push(...remaining);
}

function destroyShips(map, state, strength) {
  const indexes = CONTRACT.indexMap(map);
  const destroyed = [];
  for (const ship of [...state.ships]) {
    // The mothership covers the printed sky icons beneath its drop points.
    if (ship.row <= state.mothershipRow) continue;
    const threshold = indexes.skyRowByIndex.get(ship.row)?.cells?.[ship.column]?.explosion;
    if (threshold == null || threshold > strength) continue;
    destroyed.push({ id: ship.id, color: ship.color, threshold });
    state.ships = state.ships.filter((candidate) => candidate.id !== ship.id);
    if (ship.color === "purple") state.waitingShips.push({ id: ship.id, color: ship.color });
  }
  return destroyed;
}

function rerollUnplaced(state, mode) {
  const before = state.dice.filter((die) => !die.placed).map(dieView);
  if (mode === "expected") {
    const values = [3, 4, 3, 4, 3];
    let cursor = 0;
    for (const die of state.dice.filter((candidate) => !candidate.placed)) {
      die.value = values[cursor % values.length];
      cursor += 1;
    }
  } else {
    const rng = rngFromState(state);
    for (const die of state.dice.filter((candidate) => !candidate.placed)) die.value = rng.d6();
    storeRng(state, rng);
  }
  state.history.push({ type: "white_reroll", before, after: state.dice.filter((die) => !die.placed).map(dieView), mode });
}

function applyFirstRollAbility(map, state) {
  const ability = map.city.firstRoll;
  if (!ability || ability.type !== "set_die") return;
  const candidates = state.dice.filter((die) => ability.color === "any" || die.color === ability.color);
  const die = candidates[ability.ordinal || 0];
  if (die) die.value = ability.value;
}

function damageCity(map, state, amount, reason) {
  state.damage += amount;
  state.history.push({ type: "city_damaged", amount, reason, damage: state.damage });
  if (state.damage >= map.city.maxDamage) lose(state, "maximum_damage");
}

function win(state) {
  state.outcome = { result: "win", reason: "research_complete", round: state.round };
  state.phase = "won";
}

function lose(state, reason) {
  state.outcome = { result: "loss", reason, round: state.round };
  state.phase = "lost";
}

function assertOngoing(state) {
  if (state.outcome) throw new Error(`game already ended: ${state.outcome.result}`);
}

function rngFromState(state) {
  return new SeededRng(state.rngState);
}

function storeRng(state, rng) {
  state.rngState = rng.state;
}

function dieView(die) {
  return { id: die.id, color: die.color, value: die.value };
}

function colorPriority(color) {
  return color === "purple" ? 0 : 1;
}

module.exports = {
  SeededRng,
  allLegalWorkerPlacements,
  applyRoomAction,
  applySpawnChoice,
  applyWorkerPlacement,
  cloneState,
  createGame,
  legalRoomActions,
  legalWorkerPlacements,
  maxResearchAdvance,
  nextSpawnChoice,
  finishDeferredMothership,
  resolveMothership,
  spawnWaitingShips,
  startRound,
};


},
"map-contract.js":function(module,exports,require){
"use strict";

const ROOM_TYPES = new Set(["aa", "tunnel", "energy", "fighter", "research", "robot"]);
const SKY_EFFECT_TYPES = new Set(["arrow", "mothership_down"]);
const MOTHERSHIP_ACTION_TYPES = new Set(["excavator_back", "research_back", "spawn_white", "damage"]);

function validateMap(map) {
  const errors = [];
  if (!map || map.schema !== "ufs_standard_map_v1") errors.push("schema 必须是 ufs_standard_map_v1");
  if (map?.columns !== 5) errors.push("正式地图必须有 5 列");
  if (!map?.city?.id) errors.push("缺少 city.id");
  requirePositive(errors, map?.city?.maxDamage, "city.maxDamage");
  requirePositive(errors, map?.city?.maxEnergy, "city.maxEnergy");
  requireInteger(errors, map?.city?.startEnergy, "city.startEnergy", 0);
  requireInteger(errors, map?.city?.robotLimit, "city.robotLimit", 0);

  const costs = map?.research?.costs;
  if (!Array.isArray(costs) || costs.length < 2 || costs.some((value) => !Number.isInteger(value) || value <= 0)) {
    errors.push("research.costs 必须是至少两个正整数；每项代表前进到下一格的成本");
  }

  const skyRows = map?.sky?.rows;
  if (!Array.isArray(skyRows) || skyRows.length < 3) errors.push("sky.rows 至少需要 3 行");
  requireInteger(errors, map?.sky?.dropRow, "sky.dropRow", -1);
  if (Array.isArray(skyRows) && skyRows.length
    && map?.sky?.dropRow !== Math.min(...skyRows.map((row) => row.index)) - 1) {
    errors.push("sky.dropRow 必须是第一行天空上方一行的初始投放点；动态投放行使用 state.mothershipRow");
  }
  requirePositive(errors, map?.sky?.cityRow, "sky.cityRow");
  requirePositive(errors, map?.sky?.skullRow, "sky.skullRow");
  if (Array.isArray(skyRows)) {
    const rowIds = new Set();
    for (const row of skyRows) {
      if (!Number.isInteger(row.index)) errors.push("每个 sky row 需要整数 index");
      if (rowIds.has(row.index)) errors.push(`sky row index 重复: ${row.index}`);
      rowIds.add(row.index);
      if (!Array.isArray(row.cells) || row.cells.length !== 5) {
        errors.push(`sky row ${row.index} 必须正好有 5 个 cells`);
        continue;
      }
      row.cells.forEach((cell, column) => validateSkyCell(errors, cell, row.index, column));
      for (const action of row.mothershipActions || []) {
        if (!MOTHERSHIP_ACTION_TYPES.has(action.type)) errors.push(`未知母舰动作: ${action.type}`);
        requirePositive(errors, action.amount, `row ${row.index} action.amount`);
      }
    }
  }

  const cells = map?.base?.cells;
  const rooms = map?.base?.rooms;
  if (!Array.isArray(cells) || cells.length < 5) errors.push("base.cells 不完整");
  if (!Array.isArray(rooms) || rooms.length < 1) errors.push("base.rooms 不完整");
  const cellById = new Map();
  for (const cell of cells || []) {
    if (!cell.id) errors.push("base cell 缺少 id");
    if (cellById.has(cell.id)) errors.push(`base cell id 重复: ${cell.id}`);
    cellById.set(cell.id, cell);
    requireInteger(errors, cell.column, `${cell.id}.column`, 0);
    if (cell.column >= 5) errors.push(`${cell.id}.column 超出 0-4`);
    requireInteger(errors, cell.unlockIndex, `${cell.id}.unlockIndex`, 0);
    if (!cell.roomId) errors.push(`${cell.id} 缺少 roomId`);
  }
  const seenRoomCells = new Set();
  for (const room of rooms || []) {
    if (!room.id) errors.push("room 缺少 id");
    if (!ROOM_TYPES.has(room.type)) errors.push(`未知房间类型: ${room.type}`);
    if (!Array.isArray(room.cellIds) || room.cellIds.length < 1) errors.push(`${room.id}.cellIds 为空`);
    requireInteger(errors, room.modifier, `${room.id}.modifier`);
    requireInteger(errors, room.energyCost, `${room.id}.energyCost`, 0);
    for (const cellId of room.cellIds || []) {
      if (!cellById.has(cellId)) errors.push(`${room.id} 引用了不存在的 cell ${cellId}`);
      if (seenRoomCells.has(cellId)) errors.push(`cell ${cellId} 被多个房间引用`);
      seenRoomCells.add(cellId);
      if (cellById.get(cellId)?.roomId !== room.id) errors.push(`${cellId}.roomId 与 ${room.id} 不一致`);
    }
  }
  for (const cell of cells || []) if (!seenRoomCells.has(cell.id)) errors.push(`cell ${cell.id} 未被 room 引用`);

  const path = map?.base?.excavatorPath;
  if (!Array.isArray(path) || path.length < 1) errors.push("base.excavatorPath 为空");
  for (const cellId of path || []) if (!cellById.has(cellId)) errors.push(`挖掘路径引用不存在的 cell ${cellId}`);
  requireInteger(errors, map?.base?.startExcavatorIndex, "base.startExcavatorIndex", 0);
  if (Array.isArray(path) && map.base.startExcavatorIndex >= path.length) errors.push("startExcavatorIndex 超出路径");

  if (errors.length) {
    const error = new Error(`地图合同无效 (${errors.length}):\n- ${errors.join("\n- ")}`);
    error.details = errors;
    throw error;
  }
  return true;
}

function validateSkyCell(errors, cell, row, column) {
  if (cell.explosion != null) requirePositive(errors, cell.explosion, `sky[${row}][${column}].explosion`);
  if (!cell.effect) return;
  if (!SKY_EFFECT_TYPES.has(cell.effect.type)) errors.push(`未知天空效果: ${cell.effect.type}`);
  if (cell.effect.type === "arrow") {
    requireInteger(errors, cell.effect.targetRow, `arrow targetRow`, 0);
    requireInteger(errors, cell.effect.targetColumn, `arrow targetColumn`, 0);
    if (cell.effect.targetColumn >= 5) errors.push("arrow targetColumn 超出 0-4");
  }
  if (cell.effect.type === "mothership_down") requirePositive(errors, cell.effect.amount || 1, "mothership_down.amount");
}

function indexMap(map) {
  validateMap(map);
  return {
    cellById: new Map(map.base.cells.map((cell) => [cell.id, cell])),
    roomById: new Map(map.base.rooms.map((room) => [room.id, room])),
    skyRowByIndex: new Map(map.sky.rows.map((row) => [row.index, row])),
  };
}

function requirePositive(errors, value, path) {
  if (!Number.isInteger(value) || value <= 0) errors.push(`${path} 必须是正整数`);
}

function requireInteger(errors, value, path, minimum = null) {
  if (!Number.isInteger(value) || (minimum != null && value < minimum)) errors.push(`${path} 必须是整数${minimum == null ? "" : `且不小于 ${minimum}`}`);
}

module.exports = { indexMap, validateMap };


},
"fixtures/roswell-threat-0-map.js":function(module,exports,require){
"use strict";

const base = require("fixtures/roswell-base-ab.js");
const sky = require("fixtures/roswell-sky-threat-0.js");

module.exports = {
  schema: "ufs_standard_map_v1",
  id: "roswell-ab-threat-0",
  label: "Roswell · 基地 A+B · 威胁 0",
  columns: 5,
  threatLevel: 0,
  city: {
    id: "roswell",
    label: "Roswell（未受损面）",
    maxDamage: 7,
    startEnergy: 2,
    maxEnergy: 7,
    robotLimit: 2,
    firstRoll: null,
  },
  research: {
    // User read these from bottom to top, beginning after the marker's
    // starting space. The final 11 is the winning space.
    costs: [3, 1, 3, 1, 4, 1, 3, 2, 1, 6, 1, 3, 5, 1, 3, 11],
    finalRequiresMultiSpace: true,
  },
  sky,
  base,
};

},
"fixtures/roswell-base-ab.js":function(module,exports,require){
"use strict";

// Roswell A+B base transcription.
// Room types, modifiers, energy costs and multi-cell grouping come from the
// user's reviewed editor export. Excavation order is transcribed separately
// from the yellow tunnel shown on the physical A+B setup.

const cells = [];
const rooms = [];
const pathEntries = [];

function cellId(tile, row, column) {
  return `${tile}-r${row + 1}-c${column + 1}`;
}

function room(id, type, specs, modifier = 0, energyCost = 0) {
  const cellIds = specs.map(({ tile, row, column, unlockIndex = 0, pathOrder = null }) => {
    const idForCell = cellId(tile, row, column);
    cells.push({
      id: idForCell,
      tile,
      row,
      column,
      unlockIndex,
      roomId: id,
    });
    if (pathOrder != null) pathEntries.push({ order: pathOrder, cellId: idForCell });
    return idForCell;
  });
  rooms.push({ id, type, cellIds, modifier, energyCost });
}

function at(tile, row, column, pathOrder = null) {
  return {
    tile,
    row,
    column,
    unlockIndex: pathOrder == null ? 0 : pathOrder,
    pathOrder,
  };
}

// A row 1: five anti-air rooms. Their -1 ship descent is an AA rule, not a
// normal room modifier, so modifier remains 0.
for (let column = 0; column < 5; column += 1) {
  room(`A-aa-c${column + 1}`, "aa", [at("A", 0, column)]);
}

// A row 2: already excavated at game start.
room("A-upper-fighter", "fighter", [at("A", 1, 0)], -1, 1);
room("A-upper-research", "research", [at("A", 1, 1)], 0, 2);
room("A-upper-tunnel", "tunnel", [at("A", 1, 2)]);
room("A-upper-energy", "energy", [at("A", 1, 3), at("A", 1, 4)], -3, 0);

// The excavator starts at A row 3 column 5, then continues left.
room("A-path-energy", "energy", [at("A", 2, 0, 4)]);
room("A-path-fighter", "fighter", [at("A", 2, 1, 3), at("A", 2, 2, 2)], 0, 2);
room("A-path-research", "research", [at("A", 2, 3, 1)], -1, 1);
room("A-start-tunnel", "tunnel", [at("A", 2, 4, 0)]);

// B row 1: path enters at column 1 and travels left to right.
room("B-upper-research-left", "research", [at("B", 0, 0, 5)], -1, 0);
room("B-upper-tunnel", "tunnel", [at("B", 0, 1, 6)]);
room("B-upper-research-multi", "research", [at("B", 0, 2, 7), at("B", 0, 3, 8)], 0, 2);
room("B-upper-fighter", "fighter", [at("B", 0, 4, 9)], 0, 2);

// B row 2: path turns and travels right to left.
room("B-middle-fighter-left", "fighter", [at("B", 1, 0, 14)], 1, 2);
room("B-middle-energy", "energy", [at("B", 1, 1, 13)], 1, 0);
room("B-middle-fighter", "fighter", [at("B", 1, 2, 12)], 0, 1);
room("B-middle-tunnel", "tunnel", [at("B", 1, 3, 11)]);
room("B-middle-research", "research", [at("B", 1, 4, 10)], 0, 1);

// B row 3: final turn, left to right, ending at the lower-right corner.
room("B-bottom-tunnel-left", "tunnel", [at("B", 2, 0, 15)]);
room("B-bottom-research-multi", "research", [at("B", 2, 1, 16), at("B", 2, 2, 17), at("B", 2, 3, 18)], 0, 2);
room("B-bottom-tunnel-right", "tunnel", [at("B", 2, 4, 19)]);

cells.sort((a, b) => a.tile.localeCompare(b.tile) || a.row - b.row || a.column - b.column);
pathEntries.sort((a, b) => a.order - b.order);

const fullRoute = [
  ...Array.from({ length: 5 }, (_, offset) => cellId("A", 0, 4 - offset)),
  ...Array.from({ length: 5 }, (_, column) => cellId("A", 1, column)),
  ...Array.from({ length: 5 }, (_, offset) => cellId("A", 2, 4 - offset)),
  ...Array.from({ length: 5 }, (_, column) => cellId("B", 0, column)),
  ...Array.from({ length: 5 }, (_, offset) => cellId("B", 1, 4 - offset)),
  ...Array.from({ length: 5 }, (_, column) => cellId("B", 2, column)),
];

module.exports = {
  source: "user-reviewed-room-entry-plus-physical-yellow-tunnel",
  cells,
  rooms,
  fullRoute,
  excavatorPath: pathEntries.map((entry) => entry.cellId),
  startExcavatorIndex: 0,
};

},
"fixtures/roswell-sky-threat-0.js":function(module,exports,require){
"use strict";

// User-transcribed easy sides for all four sky tiles, ordered top to bottom.
// Compact cell legend: . empty, E# explosion, L/R horizontal arrow,
// M mothership descends one row. Rail legend: W white ship, X excavator back,
// Q research back, D city damage.

const ACTION_TYPES = {
  W: "spawn_white",
  X: "excavator_back",
  Q: "research_back",
  D: "damage",
};

const tileSpecs = [
  {
    id: "sky-1", label: "天空板 1", side: "easy", rows: [
      { cells: [".", ".", ".", "R", "."], actions: [["W", 1]] },
      { cells: [".", "L", "R", ".", "."], actions: [["X", 2]] },
      { cells: ["M", ".", "E1", ".", "."], actions: [["W", 1]] },
      { cells: ["E2", ".", "L", ".", "E4"] },
    ],
  },
  {
    id: "sky-2", label: "天空板 2", side: "easy", rows: [
      { cells: ["M", "R", ".", "E4", "."], actions: [["W", 1]] },
      { cells: [".", "M", ".", ".", "."], actions: [["X", 1]] },
      { cells: ["E4", "E3", ".", "L", "E2"], actions: [["Q", 1]] },
      { cells: ["R", ".", "E8", ".", "L"] },
    ],
  },
  {
    id: "sky-3", label: "天空板 3", side: "easy", rows: [
      { cells: [".", ".", "E4", "R", "."], actions: [["Q", 1]] },
      { cells: ["E5", ".", "L", ".", "."], actions: [["W", 1]] },
      { cells: [".", "M", "R", ".", "E6"] },
      { cells: ["M", "E3", ".", "E4", "M"], skull: true },
    ],
  },
  {
    id: "sky-4", label: "天空板 4", side: "easy", rows: [
      { cells: ["E3", "R", ".", "M", "."] },
      { cells: [".", "E6", ".", "L", "E4"] },
      { cells: ["R", ".", "E3", ".", "L"] },
      { cells: [".", "E5", "M", "E4", "."] },
    ],
  },
];

function compileCell(token, row, column) {
  if (token === ".") return {};
  if (token === "M") return { effect: { type: "mothership_down", amount: 1 } };
  if (token === "L" || token === "R") {
    const targetColumn = column + (token === "L" ? -1 : 1);
    if (targetColumn < 0 || targetColumn >= 5) throw new Error(`arrow leaves sky at row ${row}, column ${column}`);
    return { effect: { type: "arrow", targetRow: row, targetColumn } };
  }
  const explosion = /^E(\d+)$/.exec(token);
  if (explosion) return { explosion: Number(explosion[1]) };
  throw new Error(`unknown sky cell token: ${token}`);
}

const rows = [];
const rowSources = [];
let globalRow = 0;
for (const [tileOrder, tile] of tileSpecs.entries()) {
  if (tile.rows.length !== 4) throw new Error(`${tile.id} must contain 4 rows`);
  for (const [localRow, row] of tile.rows.entries()) {
    if (row.cells.length !== 5) throw new Error(`${tile.id} row ${localRow + 1} must contain 5 cells`);
    rows.push({
      index: globalRow,
      cells: row.cells.map((token, column) => compileCell(token, globalRow, column)),
      mothershipActions: (row.actions || []).map(([code, amount]) => ({ type: ACTION_TYPES[code], amount })),
    });
    rowSources.push({ tileId: tile.id, tileOrder, localRow, globalRow, skull: Boolean(row.skull) });
    globalRow += 1;
  }
}

const skullRows = rowSources.filter((row) => row.skull).map((row) => row.globalRow);
if (skullRows.length !== 1) throw new Error(`expected exactly one skull row, found ${skullRows.length}`);

module.exports = {
  source: "user-export-2026-08-11",
  threatLevel: 0,
  tileOrder: tileSpecs.map((tile) => tile.id),
  tiles: tileSpecs.map(({ id, label, side }) => ({ id, label, side })),
  dropRow: -1,
  cityRow: rows.length,
  skullRow: skullRows[0],
  rows,
};

}};const cache={};function require(id){if(cache[id])return cache[id].exports;const m={exports:{}};cache[id]=m;modules[id](m,m.exports,require);return m.exports;}const core={engine:require("standard-engine.js"),map:require("fixtures/roswell-threat-0-map.js"),fingerprint:"82c9cb2227dfd5a76ebd127c70d9f2be44b3006f46a74ee90aade92664628ee2"};if(typeof module==='object'&&module.exports)module.exports=core;else g.UFSCore=core;})(globalThis);
