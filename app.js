let DATA = {};

const state = { screen: 'home', name: '', code: '', season: null, search: '', solo: false, daily: false, botGame: false, botCount: 0, roster: {}, managers: [], draftPick: 0, opponent: {}, weekScores: [], playoffGames: [], bestPossible: 0, network: false, isHost: false, managerIndex: 0 };
const app = document.querySelector('#app');
let peer = null;
let hostConnection = null;
const peerConnections = new Map();
const positions = ['QB', 'RB1', 'RB2', 'WR1', 'WR2', 'TE', 'FLEX', 'K'];
const seasons = Array.from({ length: 26 }, (_, index) => 2000 + index);
const playersForSeason = () => state.season ? DATA[state.season] || [] : [];
const allDraftRosters = () => state.solo ? [state.roster] : state.managers.map(manager => manager.roster);
const availablePlayers = () => {
  const query = state.search.trim().toLowerCase();
  const positionAliases = { qb: 'QB', quarterback: 'QB', rb: 'RB', runningback: 'RB', 'running back': 'RB', wr: 'WR', receiver: 'WR', 'wide receiver': 'WR', te: 'TE', tightend: 'TE', 'tight end': 'TE', k: 'K', kicker: 'K', kickers: 'K' };
  const positionQuery = positionAliases[query] || null;
  const draftedNames = new Set(allDraftRosters().flatMap(roster => Object.values(roster).filter(Boolean).map(player => player[1])));
  const players = playersForSeason().filter(player => !draftedNames.has(player[1])).filter(player => !query || (positionQuery ? player[0] === positionQuery : `${player[1]} ${player[2]} ${player[0]}`.toLowerCase().includes(query)));
  return query ? players : players.slice(0, 10);
};
const WEEKLY_DATA_URL = year => `/api/nflverse?year=${year}`;

function randomRoomCode() { return crypto.randomUUID().replaceAll('-', '').slice(0, 8).toUpperCase(); }
function sendNetworkState() {
  if (!state.isHost) return;
  const message = { type: 'state', season: state.season, managers: state.managers, draftPick: state.draftPick, status: state.screen };
  peerConnections.forEach(connection => connection.send(message));
}
function closeNetwork() {
  peerConnections.forEach(connection => connection.close());
  peerConnections.clear();
  hostConnection?.close();
  hostConnection = null;
  peer?.destroy();
  peer = null;
}
function showNetworkError(message) {
  document.querySelector('.network-error')?.remove();
  document.querySelector('.panel')?.insertAdjacentHTML('beforeend', `<p class="network-error" role="alert">${esc(message)}</p>`);
}
function handleHostConnection(connection) {
  connection.on('open', () => connection.send({ type: 'hello', name: connection.metadata?.name || 'User1' }));
  connection.on('data', async message => {
    if (message.type === 'join') {
      if (state.screen !== 'room') { connection.send({ type: 'error', message: 'This draft has already started.' }); return; }
      if (state.managers.length >= 8) { connection.send({ type: 'error', message: 'This league is full.' }); return; }
      const managerIndex = state.managers.length;
      state.managers.push({ name: cleanName(message.name), roster: {} });
      peerConnections.set(connection, { connection, managerIndex });
      connection.send({ type: 'assigned', managerIndex });
      sendNetworkState();
      room();
      return;
    }
    const client = peerConnections.get(connection);
    if (message.type === 'pick' && client) handleNetworkPick(client.managerIndex, Number(message.playerIndex));
  });
  connection.on('close', () => {
    const client = peerConnections.get(connection);
    if (!client) return;
    state.managers.splice(client.managerIndex, 1);
    peerConnections.delete(connection);
    state.managers.forEach((manager, index) => { manager.managerIndex = index; });
    sendNetworkState();
    room();
  });
}
function handleNetworkPick(managerIndex, playerIndex) {
  if (!state.isHost || state.screen !== 'draft' || draftManagerAtPick(state.draftPick) !== managerIndex) return;
  const player = availablePlayers()[playerIndex];
  if (!player || !assignPlayer(state.managers[managerIndex].roster, player)) return;
  state.draftPick += 1;
  if (state.draftPick >= totalDraftPicks()) { sendNetworkState(); runSimulation(); return; }
  draft();
  sendNetworkState();
}
function syncNetworkView() {
  if (!state.network || state.isHost || state.screen !== 'draft') return;
  const roster = state.managers[state.managerIndex]?.roster || {};
  const rosterElement = document.querySelector('.roster');
  if (rosterElement) rosterElement.innerHTML = `<div class="section-title">Your roster · ${Object.keys(roster).length} / 8</div>${rosterSlots(roster)}`;
  const activeManager = draftManagerAtPick(state.draftPick);
  document.querySelectorAll('[data-pick]').forEach(button => { button.disabled = activeManager !== state.managerIndex; });
}
function startPeerHost() {
  if (typeof Peer !== 'function') { showNetworkError('Multiplayer is unavailable because PeerJS could not load.'); return; }
  closeNetwork();
  state.network = true; state.isHost = true; state.managerIndex = 0; state.solo = false; state.daily = false; state.botGame = false;
  state.code = randomRoomCode(); state.managers = [{ name: state.name, roster: {} }]; state.screen = 'room'; room();
  peer = new Peer(state.code);
  peer.on('open', () => room());
  peer.on('connection', handleHostConnection);
  peer.on('error', error => showNetworkError(error.type === 'unavailable-id' ? 'That room code is already in use. Please create the league again.' : 'Peer connection failed. Please try again.'));
}
function startPeerJoin() {
  if (typeof Peer !== 'function') { showNetworkError('Multiplayer is unavailable because PeerJS could not load.'); return; }
  closeNetwork();
  state.network = true; state.isHost = false; state.solo = false; state.daily = false; state.botGame = false;
  state.code = document.querySelector('#room-code').value.trim().toUpperCase();
  if (!state.code) { showNetworkError('Enter a room code.'); return; }
  state.screen = 'room'; room();
  peer = new Peer();
  peer.on('open', () => {
    hostConnection = peer.connect(state.code, { reliable: true, metadata: { name: state.name } });
    hostConnection.on('open', () => hostConnection.send({ type: 'join', name: state.name }));
    hostConnection.on('data', async message => {
      if (message.type === 'assigned') { state.managerIndex = message.managerIndex; return; }
      if (message.type === 'error') { showNetworkError(message.message); return; }
      if (message.type !== 'state') return;
      state.season = message.season; state.managers = message.managers; state.draftPick = message.draftPick;
      if (message.status === 'draft') { await loadSeason(state.season); state.screen = 'draft'; draft(); syncNetworkView(); }
      else { state.screen = 'room'; room(); }
    });
    hostConnection.on('close', () => showNetworkError('The host disconnected. Create a new league to play again.'));
  });
  peer.on('error', () => showNetworkError('Could not connect to that room. Check the code and try again.'));
}
async function startNetworkDraft() {
  state.season = seasons[Math.floor(Math.random() * seasons.length)];
  state.search = ''; state.roster = {}; state.draftPick = 0; state.screen = 'loading'; loading();
  try {
    await loadSeason(state.season);
    state.screen = 'draft'; draft(); sendNetworkState();
  } catch (error) {
    state.screen = 'room'; room(); showNetworkError(`${error.message} Please try again with an internet connection.`);
  }
}
document.addEventListener('click', event => {
  if (!state.network || state.isHost) return;
  const button = event.target.closest('[data-pick]');
  if (!button) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  hostConnection?.send({ type: 'pick', playerIndex: Number(button.dataset.pick) });
}, true);
document.addEventListener('click', async event => {
  const action = event.target.closest('[data-action]')?.dataset.action;
  if ((action === 'home' || action === 'daily') && state.network) {
    closeNetwork(); state.network = false; state.isHost = false; state.managerIndex = 0;
  }
  if (action === 'submit-create') {
    event.preventDefault(); event.stopImmediatePropagation();
    state.name = cleanName(document.querySelector('#manager-name').value);
    startPeerHost();
  }
  if (action === 'submit-join') {
    event.preventDefault(); event.stopImmediatePropagation();
    state.name = cleanName(document.querySelector('#manager-name').value);
    startPeerJoin();
  }
  if (action === 'start' && state.network && state.isHost) {
    event.preventDefault(); event.stopImmediatePropagation();
    startNetworkDraft();
  }
}, true);

function parseCsv(text) {
  const rows = [];
  let row = [], value = '', quoted = false;
  for (const character of text) {
    if (character === '"') quoted = !quoted;
    else if (character === ',' && !quoted) { row.push(value); value = ''; }
    else if ((character === '\n' || character === '\r') && !quoted) { if (value || row.length) { row.push(value); rows.push(row); } row = []; value = ''; }
    else value += character;
  }
  if (value || row.length) { row.push(value); rows.push(row); }
  return rows;
}

async function loadSeason(year) {
  if (DATA[year]) return;
  const response = await fetch(WEEKLY_DATA_URL(year));
  if (!response.ok) throw new Error(`Could not load the ${year} archive.`);
  const rows = parseCsv(await response.text());
  const headers = rows.shift();
  const column = name => headers.indexOf(name);
  const seasonIndex = column('season');
  const weekIndex = column('week');
  const nameIndex = column('player_display_name');
  const idIndex = column('player_id');
  const positionIndex = column('position');
  const teamIndex = column('team');
  const pointsIndex = column('fantasy_points_ppr');
  const fieldGoalsIndex = column('fg_made');
  const extraPointsIndex = column('pat_made');
  const grouped = new Map();
  rows.forEach(row => {
    const position = row[positionIndex] === 'K' ? 'K' : row[positionIndex];
    const week = Number(row[weekIndex]);
    if (Number(row[seasonIndex]) !== year || !['QB', 'RB', 'WR', 'TE', 'K'].includes(position) || week < 1 || week > 18 || !row[nameIndex]) return;
    const key = `${row[idIndex]}-${position}`;
    if (!grouped.has(key)) grouped.set(key, { position, name: row[nameIndex], team: row[teamIndex], weeks: Array(18).fill(0) });
    const points = position === 'K' ? ((Number(row[fieldGoalsIndex]) || 0) * 3) + (Number(row[extraPointsIndex]) || 0) : Number(row[pointsIndex]) || 0;
    grouped.get(key).weeks[week - 1] += points;
  });
  const normalized = Array.from(grouped.values()).filter(player => player.weeks.some(score => score > 0)).map(player => [esc(player.position), esc(player.name), esc(player.team), player.weeks.map(score => Math.round(score * 10) / 10)]).sort((a, b) => b[3].reduce((sum, score) => sum + score, 0) - a[3].reduce((sum, score) => sum + score, 0));
  DATA[year] = normalized;
}
const cleanName = value => String(value || 'User1').replace(/[^\p{L}\p{N} _-]/gu, '').trim().slice(0, 18) || 'User1';
const initials = name => name.split(' ').map(word => word[0]).slice(0, 2).join('');
const esc = value => String(value).replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
const getNextDailyResetMs = () => {
  const nextDay = new Date();
  nextDay.setHours(24, 0, 0, 0);
  return Math.max(0, nextDay.getTime() - Date.now());
};
const formatCountdown = ms => {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${hours.toString().padStart(2, '0')}h ${minutes.toString().padStart(2, '0')}m ${seconds.toString().padStart(2, '0')}s`;
};
function startCountdownTimer() {
  const timers = document.querySelectorAll('[data-countdown]');
  if (!timers.length) return;
  const update = () => {
    const countdown = formatCountdown(getNextDailyResetMs());
    timers.forEach(timer => { timer.textContent = countdown; });
  };
  update();
  window.clearInterval(window.dailyCountdownTimer);
  window.dailyCountdownTimer = window.setInterval(update, 1000);
}
function showHowToPlayModal() {
  const existing = document.querySelector('.modal-backdrop');
  if (existing) existing.remove();
  app.insertAdjacentHTML('beforeend', `<div class="modal-backdrop"><div class="modal-panel"><button class="modal-close" aria-label="Close instructions">×</button><div class="eyebrow">How to play</div><h2>Build the best team.</h2><div class="tutorial-grid"><div class="tutorial-copy"><ol><li>Draft a roster from the selected season.</li><li>Compare your roster to the best possible team.</li><li>Chase the highest score across all 18 weeks.</li></ol></div><div class="timer-card"><strong data-countdown>${formatCountdown(getNextDailyResetMs())}</strong></div></div><div class="modal-actions"><button class="btn" data-action="close-tutorial">Start challenge</button></div></div></div>`);
  const closeButton = document.querySelector('.modal-close');
  const startButton = document.querySelector('[data-action="close-tutorial"]');
  const dismiss = () => document.querySelector('.modal-backdrop')?.remove();
  closeButton?.addEventListener('click', dismiss);
  startButton?.addEventListener('click', dismiss);
  startCountdownTimer();
}

function layout(content) { app.innerHTML = `<div class="shell"><header class="mode-header"><button class="mode-brand" data-action="daily">Retro Draftle</button><nav><button class="mode-link active" data-action="daily">Daily</button><button class="mode-link" data-action="bots">Play against bots</button><details class="multi-menu"><summary>Multiplayer</summary><div class="multi-options"><button data-action="create">Create a league</button><button data-action="join">Join with a code</button></div></details></nav></header>${content}</div>`; bind(); if (state.screen === 'simulation' && !state.solo && state.managers.length > 2) document.querySelector('.week-table')?.replaceWith((() => { const wrapper = document.createElement('div'); wrapper.innerHTML = multiScoreboardMarkup(); return wrapper.firstElementChild.nextElementSibling; })()); }
function home() { startDaily(); }
function botSetup() { layout(`<section class="panel"><div class="eyebrow">Bot league</div><h2>Choose your opponents.</h2><label class="field-label" for="bot-name">Your manager name</label><input id="bot-name" maxlength="18" placeholder="e.g. User1" required /><label class="field-label" for="bot-count">Number of bots</label><select id="bot-count"><option value="1">1 bot</option><option value="2">2 bots</option><option value="3">3 bots</option><option value="4">4 bots</option><option value="5">5 bots</option><option value="6">6 bots</option><option value="7">7 bots</option></select><div class="actions"><button class="btn" data-action="start-bots">Start bot league</button><button class="btn secondary" data-action="home">Back</button></div></section>`); }
function loading() { layout(`<section class="panel"><div class="eyebrow">Loading the archive</div><h2>${state.season} is coming up.</h2><p>Fetching every player’s weekly PPR scores from the nflverse historical dataset. The draft opens when the archive is ready.</p></section>`); }
function form(mode) { const create = mode === 'create'; layout(`<section class="panel"><div class="eyebrow">${create ? 'Start a new room' : 'Enter an active room'}</div><h2>${create ? 'Host' : 'Join'}</h2><p>${create ? '' : 'Ask the room host for their eight-character code. You will join as a new manager.'}</p><label class="field-label" for="manager-name">Your manager name</label><input id="manager-name" maxlength="18" placeholder="e.g. User1" value="${esc(state.name)}" />${create ? '' : '<label class="field-label" for="room-code">Room code</label><input id="room-code" class="code-input" maxlength="8" placeholder="A1B2C3D4" />'}<div class="actions"><button class="btn" data-action="submit-${mode}">${create ? 'Create room' : 'Join room'}</button><button class="btn secondary" data-action="home">Back</button></div></section>`); }
function room() { const managerRows = state.managers.map((manager, index) => `<div class="player-row"><span><span class="avatar">${esc(initials(manager.name))}</span><span class="player-name">${esc(manager.name)}<span class="player-meta">${index === 0 ? 'commissioner · host' : 'guest manager'}</span></span></span><span class="tag">connected</span></div>`).join(''); const controls = state.isHost ? '<button class="btn full-width" data-action="start">Start the draft <span aria-hidden="true">→</span></button>' : '<p class="lede">Waiting for the host to start the draft.</p>'; layout(`<section><div class="room-head"><div class="room-code"><span class="section-title">Share this code</span><strong>${esc(state.code)}</strong></div><div class="eyebrow">${state.isHost ? 'Commissioner’s room' : 'League room'}</div></div><div class="room-lobby"><div class="section-title">Managers · ${state.managers.length} / 8</div><div class="player-list">${managerRows}</div>${controls}</div></section>`); }
function draftManagerAtPick(pick) { return state.managers.length ? pick % state.managers.length : 0; }
function totalDraftPicks() { return state.managers.length * 8; }
function assignPlayer(roster, player) { const target = player[0] === 'RB' ? (!roster.RB1 ? 'RB1' : !roster.RB2 ? 'RB2' : 'FLEX') : player[0] === 'WR' ? (!roster.WR1 ? 'WR1' : !roster.WR2 ? 'WR2' : 'FLEX') : player[0]; if (!roster[target] && positions.includes(target)) { roster[target] = player; return true; } return false; }
function rosterSlots(roster) { return positions.map(pos => `<div class="slot ${roster[pos] ? '' : 'empty'}"><b>${pos.replace(/[12]$/, '')}${pos.match(/[12]$/) ? ` ${pos.slice(-1)}` : ''}</b><span>${roster[pos] ? esc(roster[pos][1]) : 'Open slot'}</span></div>`).join(''); }
function draft() { const players = availablePlayers(); const userRoster = state.solo ? state.roster : state.managers[0].roster; const filled = Object.keys(userRoster).length; const query = state.search.trim(); const resultLabel = query ? `${players.length} matches` : `10 recommendations`; const activeManager = state.solo ? 0 : draftManagerAtPick(state.draftPick); const activeName = state.solo ? 'Your turn' : `${state.managers[activeManager].name}'s turn`; const rosters = state.solo ? `<aside class="roster"><div class="section-title">Your roster · ${filled} / 8</div>${rosterSlots(userRoster)}</aside>` : `<aside class="roster"><div class="section-title">Draft · Pick ${state.draftPick + 1} / ${totalDraftPicks()}</div><div class="tag">${esc(activeName)}</div>${state.managers.map(manager => `<div class="section-title">${esc(manager.name)} · ${Object.keys(manager.roster).length} / 8</div>${rosterSlots(manager.roster)}`).join('')}</aside>`; const dailyTimer = state.daily ? `<div class="daily-timer"><strong data-countdown>${formatCountdown(getNextDailyResetMs())}</strong></div>` : ''; layout(`<section><div class="draft-head"><span class="season-pill">Year · ${state.season}</span>${dailyTimer}</div><div class="draft-layout"><div><p class="lede draft-instruction">Draft the best possible team for this year.</p><label class="field-label" for="player-search">Search ${state.season} players</label><input id="player-search" type="search" autocomplete="off" placeholder="Name, team, or position" value="${esc(state.search)}" /><div class="section-title">${state.season} player pool · ${resultLabel}</div><div class="board">${players.map((p, i) => `<article class="draft-card"><div><small>${p[0]} · ${p[2]} · ${state.season}</small><strong>${p[1]}</strong></div><button class="pick" data-pick="${i}" ${!state.solo && activeManager !== 0 ? 'disabled' : ''}>Draft</button></article>`).join('') || '<p class="lede">No players match that search in the selected year.</p>'}</div></div>${rosters}</div></section>`); startCountdownTimer(); }
function simulation() { const rows = state.weekScores; const userTotal = rows.reduce((a, r) => a + r.you, 0); const rivalTotal = rows.reduce((a, r) => a + r.rival, 0); const rivalLabel = state.solo ? 'Best possible roster' : 'Mia’s Calculator'; const winner = state.playoffWinner; const soloMessage = winner === state.name ? '◆ Incredible draft. You beat the best possible roster in the playoff.' : `◆ ${rivalTotal - userTotal} points short of the best possible roster overall.`; const userRecord = state.solo ? '' : `<span class="player-meta">Record ${state.records.you}</span>`; const rivalRecord = state.solo ? '' : `<span class="player-meta">Record ${state.records.rival}</span>`; const playoffYouName = state.name; const playoffRivalName = rivalLabel; const playoffYouTotal = rows.slice(18).reduce((sum, row) => sum + row.you, 0); const playoffRivalTotal = rows.slice(18).reduce((sum, row) => sum + row.rival, 0); const playoffBracket = `<div class="bracket-game"><strong>Championship matchup</strong><div class="bracket-score ${playoffYouTotal >= playoffRivalTotal ? 'winner-score' : ''}"><span>${esc(playoffYouName)}</span><b>${playoffYouTotal}</b></div><div class="bracket-score ${playoffRivalTotal > playoffYouTotal ? 'winner-score' : ''}"><span>${playoffRivalName}</span><b>${playoffRivalTotal}</b></div></div>`; const message = state.solo && !state.daily ? `<div class="confetti">${soloMessage}</div>` : ''; const bracket = state.daily ? '' : `<div class="playoff-bracket"><div class="bracket-label">Playoff bracket · championship round</div><div class="bracket-games">${playoffBracket}</div></div>`; layout(`<section><div class="sim-top"><div><div class="eyebrow">${state.daily ? 'Daily challenge' : state.solo ? 'Solo benchmark' : 'Final result'} · ${state.season} season</div><div class="sim-title">${state.daily ? '' : state.solo ? 'How did you <em>draft?</em>' : 'Final result.'}</div></div><div class="winner">${state.daily ? 'Daily score' : `Playoff champion · ${winner}`}</div></div>${message}${bracket}<div class="scoreboard"><div class="team-score"><small>${esc(state.name)}</small>${userRecord}<strong>${userTotal}</strong></div><div class="versus">TOTAL<br />PTS</div><div class="team-score"><small>${rivalLabel}</small>${rivalRecord}<strong>${rivalTotal}</strong></div></div><div class="section-title">Week-by-week scoreboard</div><table class="week-table"><thead><tr><th>Week</th><th>${esc(state.name)}</th><th>${rivalLabel}</th></tr></thead><tbody>${rows.map(row => `<tr><td>${row.label}</td><td>${row.you}</td><td>${row.rival}</td></tr>`).join('')}<tr><td>${state.solo ? 'Your total vs best possible' : 'Season record · total points'}</td><td>${state.solo ? userTotal : `${state.records.you} · ${userTotal}`}</td><td>${state.solo ? rivalTotal : `${state.records.rival} · ${rivalTotal}`}</td></tr></tbody></table><div class="actions"><button class="btn" data-action="home">Play another room</button></div></section>`); }

function createOpponent() { const pool = playersForSeason(); const picks = {}; picks.QB = pool.filter(p => p[0] === 'QB').at(-1); picks.RB1 = pool.filter(p => p[0] === 'RB').at(-1); picks.RB2 = pool.filter(p => p[0] === 'RB').at(-2); picks.WR1 = pool.filter(p => p[0] === 'WR').at(-1); picks.WR2 = pool.filter(p => p[0] === 'WR').at(-2); picks.TE = pool.filter(p => p[0] === 'TE').at(-1); picks.K = pool.filter(p => p[0] === 'K').at(-1); picks.FLEX = pool.filter(p => p[0] === 'WR').at(-3) || picks.WR2; return picks; }
function bestPossibleRoster() { const pool = playersForSeason(); const ranked = position => pool.filter(player => player[0] === position).sort((a, b) => b[3].reduce((sum, score) => sum + score, 0) - a[3].reduce((sum, score) => sum + score, 0)); const roster = { QB: ranked('QB')[0], RB1: ranked('RB')[0], RB2: ranked('RB')[1], WR1: ranked('WR')[0], WR2: ranked('WR')[1], TE: ranked('TE')[0], K: ranked('K')[0] }; const used = new Set(Object.values(roster).map(player => player && player[1])); roster.FLEX = [...ranked('RB'), ...ranked('WR')].find(player => !used.has(player[1])); return roster; }
function buildPlayoffBracket() { const teamScore = manager => positions.reduce((total, position) => total + (manager.roster[position] ? manager.roster[position][3].reduce((sum, score) => sum + score, 0) : 0), 0); let teams = state.managers.map((manager, index) => ({ name: manager.name, roster: manager.roster, seed: index + 1, score: teamScore(manager) })).sort((a, b) => b.score - a.score); const bracketSize = 2 ** Math.ceil(Math.log2(teams.length)); const rounds = Math.log2(bracketSize); teams = [...teams, ...Array.from({ length: bracketSize - teams.length }, () => null)]; state.playoffGames = []; for (let round = 0; round < rounds; round += 1) { const nextRound = []; for (let index = 0; index < teams.length; index += 2) { const home = teams[index]; const away = teams[index + 1]; if (!home && !away) continue; if (!away) { nextRound.push(home); continue; } if (!home) { nextRound.push(away); continue; } const week = (18 + round) % 18; const homeScore = Math.round(home.roster && positions.reduce((sum, position) => sum + (home.roster[position] ? home.roster[position][3][week] * 1.08 : 0), 0)); const awayScore = Math.round(away.roster && positions.reduce((sum, position) => sum + (away.roster[position] ? away.roster[position][3][week] * 1.08 : 0), 0)); const winner = homeScore >= awayScore ? home : away; state.playoffGames.push({ round: round + 1, home: home.name, away: away.name, homeScore, awayScore }); nextRound.push({ ...winner, score: Math.max(homeScore, awayScore) }); } teams = nextRound; } state.playoffWinner = teams[0]?.name || state.managers[0].name; }
function multiPlayoffMarkup() { const rounds = [...new Set(state.playoffGames.map(game => game.round))]; return rounds.map(round => `<div class="bracket-round"><div class="bracket-round-label">${round === rounds.length ? 'Championship' : `Round ${round}`}</div>${state.playoffGames.filter(game => game.round === round).map(game => `<div class="bracket-game"><strong>Round ${game.round}</strong><div class="bracket-score ${game.homeScore >= game.awayScore ? 'winner-score' : ''}"><span>${esc(game.home)}</span><b>${game.homeScore}</b></div><div class="bracket-score ${game.awayScore > game.homeScore ? 'winner-score' : ''}"><span>${esc(game.away)}</span><b>${game.awayScore}</b></div></div>`).join('')}</div>`).join(''); }
function managerWeekScore(manager, week, multiplier = 1) { return Math.round(positions.reduce((sum, position) => sum + (manager.roster[position] ? manager.roster[position][3][week] * multiplier : 0), 0)); }
function multiScoreboardMarkup() { const managers = state.managers; const weeks = Array.from({ length: 18 }, (_, week) => `<tr><td>Week ${week + 1}</td>${managers.map(manager => `<td>${managerWeekScore(manager, week)}</td>`).join('')}</tr>`).join(''); const playoffGames = state.playoffGames.map(game => `<tr><td>Round ${game.round}: ${esc(game.home)} vs ${esc(game.away)}</td>${managers.map(manager => `<td>${manager.name === game.home ? game.homeScore : manager.name === game.away ? game.awayScore : '-'}</td>`).join('')}</tr>`).join(''); return `<div class="section-title">Every manager · week by week</div><table class="week-table league-scoreboard"><thead><tr><th>Week / playoff game</th>${managers.map(manager => `<th>${esc(manager.name)}</th>`).join('')}</tr></thead><tbody>${weeks}${playoffGames}</tbody></table>`; }
function runSimulation() { state.opponent = state.solo ? bestPossibleRoster() : state.managers[1].roster; const userPlayers = positions.map(pos => state.solo ? state.roster[pos] : state.managers[0].roster[pos]); const rivalPlayers = positions.map(pos => state.opponent[pos]); state.weekScores = Array.from({ length: 19 }, (_, i) => ({ week: i + 1, label: i < 18 ? `Week ${i + 1}` : 'Playoff', you: Math.round(userPlayers.reduce((sum, p) => sum + (p[3][i % 18] * (i > 17 ? 1.08 : 1)), 0)), rival: Math.round(rivalPlayers.reduce((sum, p) => sum + (p[3][i % 18] * (i > 17 ? 1.08 : 1)), 0)) })); const regularSeason = state.weekScores.slice(0, 18); const wins = regularSeason.filter(row => row.you > row.rival).length; const losses = regularSeason.filter(row => row.you < row.rival).length; const ties = regularSeason.length - wins - losses; const rivalWins = losses; const rivalLosses = wins; const playoffs = state.weekScores.slice(18); const playoffYou = playoffs.reduce((sum, row) => sum + row.you, 0); const playoffRival = playoffs.reduce((sum, row) => sum + row.rival, 0); state.records = { you: `${wins}-${losses}-${ties}`, rival: `${rivalWins}-${rivalLosses}-${ties}` }; state.playoffRecords = { you: playoffs.filter(row => row.you > row.rival).length, rival: playoffs.filter(row => row.rival > row.you).length, ties: playoffs.filter(row => row.you === row.rival).length }; state.playoffWinner = playoffYou >= playoffRival ? (state.solo ? state.name : state.managers[0].name) : (state.solo ? 'Best possible roster' : state.managers[1].name); if (!state.solo && state.managers.length > 2) buildPlayoffBracket(); state.bestPossible = state.weekScores.reduce((sum, row) => sum + row.rival, 0); state.screen = 'simulation'; simulation(); if (state.playoffGames.length > 0) document.querySelector('.bracket-games').innerHTML = multiPlayoffMarkup(); }
async function startDaily() { const daySlot = Math.floor(Date.now() / 86400000); state.name = 'Daily manager'; state.code = 'DAILY'; state.solo = true; state.daily = true; state.season = seasons[daySlot % seasons.length]; state.search = ''; state.roster = {}; state.screen = 'loading'; loading(); try { await loadSeason(state.season); state.screen = 'draft'; draft(); showHowToPlayModal(); } catch (error) { document.querySelector('.modal-backdrop')?.remove(); state.screen = 'loading'; loading(); } }
function autoAdvanceSnake() { while (state.draftPick < totalDraftPicks() && draftManagerAtPick(state.draftPick) !== 0) { const draftedNames = new Set(allDraftRosters().flatMap(roster => Object.values(roster).filter(Boolean).map(player => player[1]))); const manager = state.managers[draftManagerAtPick(state.draftPick)]; const player = playersForSeason().filter(candidate => !draftedNames.has(candidate[1])).sort((a, b) => b[3].reduce((sum, score) => sum + score, 0) - a[3].reduce((sum, score) => sum + score, 0)).find(candidate => assignPlayer(manager.roster, candidate)); if (!player) break; state.draftPick += 1; } }
document.addEventListener('click', event => { if (!state.botGame) return; const button = event.target.closest('[data-pick]'); if (!button) return; event.stopImmediatePropagation(); const player = availablePlayers()[Number(button.dataset.pick)]; if (!player || draftManagerAtPick(state.draftPick) !== 0) return; if (assignPlayer(state.managers[0].roster, player)) { state.draftPick += 1; autoAdvanceSnake(); if (state.draftPick >= totalDraftPicks()) runSimulation(); else draft(); } }, true);
document.addEventListener('click', async event => { const action = event.target.closest('[data-action]')?.dataset.action; if (action === 'bots') botSetup(); if (action === 'start-bots') { state.name = document.querySelector('#bot-name').value.trim() || 'User1'; state.solo = false; state.daily = false; state.botGame = true; state.botCount = Math.max(1, Math.min(7, Number(document.querySelector('#bot-count').value))); state.season = seasons[Math.floor(Math.random() * seasons.length)]; state.search = ''; state.roster = {}; state.managers = [{ name: state.name, roster: {} }, ...Array.from({ length: state.botCount }, (_, index) => ({ name: `Bot ${index + 1}`, roster: {} }))]; state.draftPick = 0; state.screen = 'loading'; loading(); try { await loadSeason(state.season); state.screen = 'draft'; draft(); } catch (error) { state.screen = 'home'; home(); window.alert(`${error.message} Please try again with an internet connection.`); } } });
function bind() { document.querySelectorAll('[data-action]').forEach(button => button.addEventListener('click', async () => { const action = button.dataset.action; if (action === 'create') form('create'); if (action === 'join') form('join'); if (action === 'solo' || action === 'daily') { state.screen = 'loading'; startDaily(); } if (action === 'home' || action === 'daily-home') { state.screen = 'home'; state.solo = false; state.daily = false; home(); } if (action === 'submit-create') { state.name = document.querySelector('#manager-name').value.trim() || 'User1'; state.solo = false; state.daily = false; state.code = Math.random().toString(36).slice(2, 6).toUpperCase(); state.screen = 'room'; room(); } if (action === 'submit-join') { state.name = document.querySelector('#manager-name').value.trim() || 'User1'; state.solo = false; state.daily = false; state.code = (document.querySelector('#room-code').value.trim() || 'HAIL').toUpperCase(); state.screen = 'room'; room(); } if (action === 'start') { state.season = seasons[Math.floor(Math.random() * seasons.length)]; state.search = ''; state.roster = {}; state.managers = [{ name: state.name, roster: {} }, { name: 'Mia’s Calculator', roster: {} }]; state.draftPick = 0; state.screen = 'loading'; loading(); try { await loadSeason(state.season); state.screen = 'draft'; draft(); } catch (error) { state.screen = 'room'; room(); window.alert(`${error.message} Please try again with an internet connection.`); } } })); document.querySelectorAll('[data-pick]').forEach(button => button.addEventListener('click', () => { const player = availablePlayers()[Number(button.dataset.pick)]; if (!player || (!state.solo && draftManagerAtPick(state.draftPick) !== 0)) return; const roster = state.solo ? state.roster : state.managers[0].roster; if (assignPlayer(roster, player)) { if (state.solo) { if (Object.keys(state.roster).length === 8) runSimulation(); else draft(); } else { state.draftPick += 1; autoAdvanceSnake(); if (state.draftPick >= 16) runSimulation(); else draft(); } } })); const search = document.querySelector('#player-search'); if (search) search.addEventListener('input', event => { state.search = event.target.value; draft(); const nextSearch = document.querySelector('#player-search'); nextSearch.focus(); nextSearch.setSelectionRange(state.search.length, state.search.length); }); }
startDaily();