const express = require("express");
const http = require("http");
const os = require("os");
const path = require("path");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;

app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "online.html"));
});
app.get("/network-info", (req, res) => {
  const ip = getLocalIPv4();
  const protocol = req.headers["x-forwarded-proto"] || req.protocol || "http";
  const port = process.env.PORT ? "" : `:${PORT}`;
  res.json({
    host: req.headers.host,
    localUrl: `${protocol}://${req.headers.host}`,
    lanUrl: ip ? `http://${ip}${port}` : null
  });
});
app.use(express.static(__dirname));

const suits = ["clubs", "diamonds", "hearts", "spades"];
const ranks = [
  ["2", 2, "2"], ["3", 3, "3"], ["4", 4, "4"], ["5", 5, "5"],
  ["6", 6, "6"], ["7", 7, "7"], ["8", 8, "8"], ["9", 9, "9"],
  ["10", 10, "10"], ["jack", 11, "J"], ["queen", 12, "Q"],
  ["king", 13, "K"], ["ace", 14, "A"]
];

const rooms = new Map();

function getLocalIPv4() {
  const nets = os.networkInterfaces();
  for (const entries of Object.values(nets)) {
    for (const entry of entries || []) {
      if (entry.family === "IPv4" && !entry.internal && !entry.address.startsWith("169.254.")) {
        return entry.address;
      }
    }
  }
  return null;
}

function makeDeck() {
  return ranks.flatMap(([rank, value, label]) => suits.map(suit => ({
    id: `${rank}_of_${suit}`,
    rank,
    value,
    label,
    suit,
    img: `cards/${rank}_of_${suit}.png`
  })));
}

function shuffle(cards) {
  const deck = [...cards];
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function sortCards(cards) {
  return [...cards].sort((a, b) => a.value - b.value || a.suit.localeCompare(b.suit));
}

function roomCode() {
  let code;
  do code = String(Math.floor(1000 + Math.random() * 9000));
  while (rooms.has(code));
  return code;
}

function publicCard(card) {
  return card ? { ...card } : null;
}

function maskCards(count) {
  return Array.from({ length: count }, () => ({ hidden: true }));
}

function activeZone(player) {
  if (player.hand.length) return "hand";
  if (player.faceUp.length) return "faceUp";
  return "faceDown";
}

function topCard(room) {
  return room.pile[room.pile.length - 1] || null;
}

function canPlayCard(room, card) {
  const top = topCard(room);
  if (!top) return true;
  if (card.rank === "2" || card.rank === "10") return true;
  if (top.rank === "2") return true;
  return card.value >= top.value;
}

function legalCards(room, player) {
  const zone = activeZone(player);
  if (zone === "faceDown") return player.faceDown.map((card, index) => ({ card, zone, index }));
  return player[zone].map((card, index) => ({ card, zone, index })).filter(item => canPlayCard(room, item.card));
}

function drawUp(room, player) {
  while (player.hand.length < 3 && room.draw.length) player.hand.push(room.draw.shift());
  player.hand = sortCards(player.hand);
}

function topFourMatch(room) {
  if (room.pile.length < 4) return false;
  const top = room.pile.slice(-4);
  return top.every(card => card.rank === top[0].rank);
}

function nextPlayer(room, from) {
  let index = from;
  do index = (index + 1) % room.players.length;
  while (room.players[index].finished);
  return index;
}

function startingCards(player) {
  return sortCards(player.hand).map(card => card.rank === "2" ? 99 : card.value).sort((a, b) => a - b);
}

function compareStartingHands(a, b) {
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i++) {
    const left = a[i] ?? 99;
    const right = b[i] ?? 99;
    if (left !== right) return left - right;
  }
  return 0;
}

function findStartingPlayer(room) {
  let bestIndex = 0;
  let bestCards = startingCards(room.players[0]);
  for (let i = 1; i < room.players.length; i++) {
    const cards = startingCards(room.players[i]);
    if (compareStartingHands(cards, bestCards) < 0) {
      bestIndex = i;
      bestCards = cards;
    }
  }
  return bestIndex;
}

function checkFinished(room, player) {
  if (!player.finished && !player.hand.length && !player.faceUp.length && !player.faceDown.length) {
    player.finished = true;
    room.message = `${player.name} is out.`;
  }
  const active = room.players.filter(player => !player.finished);
  if (active.length === 1) {
    room.phase = "gameOver";
    room.message = `${active[0].name} is the shithead. Game over.`;
  }
}

function makeRoom(hostSocket, name) {
  const code = roomCode();
  const room = {
    code,
    hostId: hostSocket.id,
    phase: "lobby",
    players: [{ id: hostSocket.id, name: cleanName(name, "Player 1"), bot: false, connected: true, hand: [], faceUp: [], faceDown: [], finished: false }],
    draw: [],
    pile: [],
    current: 0,
    setupIndex: -1,
    message: "Waiting for players."
  };
  rooms.set(code, room);
  hostSocket.join(code);
  hostSocket.data.roomCode = code;
  return room;
}

function cleanName(name, fallback) {
  const text = String(name || "").trim().slice(0, 18);
  return text || fallback;
}

function addBot(room) {
  if (room.players.length >= 4 || room.phase !== "lobby") return false;
  const n = room.players.filter(player => player.bot).length + 1;
  room.players.push({ id: `bot-${Date.now()}-${n}`, name: `Computer ${n}`, bot: true, connected: true, hand: [], faceUp: [], faceDown: [], finished: false });
  return true;
}

function startGame(room) {
  if (room.players.length < 2) {
    room.message = "Need at least two players.";
    return;
  }
  const deck = shuffle(makeDeck());
  for (const player of room.players) {
    player.hand = sortCards(deck.splice(0, 3));
    player.faceUp = deck.splice(0, 3);
    player.faceDown = deck.splice(0, 3);
    player.finished = false;
  }
  room.draw = deck;
  room.pile = [];
  room.current = 0;
  room.phase = "setup";
  room.setupIndex = -1;
  room.message = "Setup: swap hand cards with face-up cards.";
  advanceSetup(room);
}

function advanceSetup(room) {
  const next = room.players.findIndex((player, index) => !player.bot && index > room.setupIndex);
  if (next !== -1) {
    room.setupIndex = next;
    room.message = `${room.players[next].name}, set your face-up cards.`;
    return;
  }
  room.phase = "play";
  room.setupIndex = -1;
  room.current = findStartingPlayer(room);
  room.message = `${room.players[room.current].name} starts with the lowest hand.`;
  maybeBotTurn(room);
}

function removeSelected(player, zone, indexes) {
  const removed = [];
  for (const index of [...indexes].sort((a, b) => b - a)) {
    if (!player[zone][index]) return null;
    removed.unshift(player[zone].splice(index, 1)[0]);
  }
  return removed;
}

function playCards(room, playerIndex, zone, indexes) {
  const player = room.players[playerIndex];
  if (room.phase !== "play" || room.current !== playerIndex || player.finished) return "Not your turn.";
  if (zone !== activeZone(player)) return "You must play from your active row.";
  if (!Array.isArray(indexes) || !indexes.length) return "Choose a card.";
  if (zone === "faceDown" && indexes.length !== 1) return "Choose one face-down card.";
  const chosen = indexes.map(index => player[zone][index]);
  if (chosen.some(card => !card)) return "Invalid card.";
  if (zone !== "faceDown" && !chosen.every(card => card.rank === chosen[0].rank)) return "Selected cards must match.";
  if (zone !== "faceDown" && !canPlayCard(room, chosen[0])) return "That card cannot be played.";

  const wasLegal = canPlayCard(room, chosen[0]);
  const cards = removeSelected(player, zone, indexes);
  room.pile.push(...cards);
  const first = cards[0];

  if (zone === "faceDown" && !wasLegal) {
    player.hand.push(...room.pile.splice(0));
    player.hand = sortCards(player.hand);
    room.message = `${player.name} flipped ${first.label} and picked up the pile.`;
    room.current = nextPlayer(room, playerIndex);
    return null;
  }

  if (first.rank === "10" || topFourMatch(room)) {
    const reason = first.rank === "10" ? "10 clears the pile" : `four ${first.label}s clear the pile`;
    room.pile = [];
    drawUp(room, player);
    checkFinished(room, player);
    if (room.phase !== "gameOver") {
      if (player.finished) room.current = nextPlayer(room, playerIndex);
      room.message = `${player.name} played ${cardsText(cards)}. ${reason}; ${player.name} goes again.`;
    }
    return null;
  }

  drawUp(room, player);
  checkFinished(room, player);
  if (room.phase !== "gameOver") {
    room.current = nextPlayer(room, playerIndex);
    room.message = `${player.name} played ${cardsText(cards)}.`;
  }
  return null;
}

function pickUp(room, playerIndex) {
  const player = room.players[playerIndex];
  if (room.phase !== "play" || room.current !== playerIndex) return "Not your turn.";
  if (!room.pile.length) return "The pile is empty.";
  if (legalCards(room, player).length) return "You have a playable card, so you must play.";
  player.hand.push(...room.pile.splice(0));
  player.hand = sortCards(player.hand);
  room.current = nextPlayer(room, playerIndex);
  room.message = `${player.name} picked up the pile.`;
  return null;
}

function cardsText(cards) {
  return cards.map(card => `${card.label}${{ clubs: "C", diamonds: "D", hearts: "H", spades: "S" }[card.suit]}`).join(", ");
}

function botMove(room) {
  if (room.phase !== "play") return;
  const player = room.players[room.current];
  if (!player?.bot || player.finished) return;
  const legal = legalCards(room, player);
  if (!legal.length) {
    pickUp(room, room.current);
    return;
  }
  const zone = activeZone(player);
  if (zone === "faceDown") {
    playCards(room, room.current, zone, [0]);
    return;
  }
  const best = legal.sort((a, b) => scoreBotCard(a.card) - scoreBotCard(b.card))[0];
  const indexes = player[zone].map((card, index) => ({ card, index })).filter(item => item.card.rank === best.card.rank && canPlayCard(room, item.card)).map(item => item.index);
  playCards(room, room.current, zone, indexes);
}

function scoreBotCard(card) {
  if (card.rank === "10") return 100;
  if (card.rank === "2") return 90;
  return card.value;
}

function maybeBotTurn(room) {
  if (room.phase !== "play") return;
  const player = room.players[room.current];
  if (!player?.bot) return;
  setTimeout(() => {
    botMove(room);
    emitRoom(room);
    maybeBotTurn(room);
  }, 700);
}

function roomView(room, socketId) {
  const viewerIndex = room.players.findIndex(player => player.id === socketId);
  return {
    code: room.code,
    hostId: room.hostId,
    viewerId: socketId,
    viewerIndex,
    phase: room.phase,
    drawCount: room.draw.length,
    pileCount: room.pile.length,
    topCard: publicCard(topCard(room)),
    current: room.current,
    setupIndex: room.setupIndex,
    message: room.message,
    players: room.players.map((player, index) => {
      const canSee = index === viewerIndex && !player.bot;
      return {
        id: player.id,
        name: player.name,
        bot: player.bot,
        connected: player.connected,
        finished: player.finished,
        hand: canSee ? player.hand.map(publicCard) : maskCards(player.hand.length),
        faceUp: player.faceUp.map(publicCard),
        faceDown: maskCards(player.faceDown.length),
        activeZone: activeZone(player)
      };
    })
  };
}

function emitRoom(room) {
  for (const socket of io.sockets.adapter.rooms.get(room.code) || []) {
    io.to(socket).emit("state", roomView(room, socket));
  }
}

function currentRoom(socket) {
  const code = socket.data.roomCode;
  return code ? rooms.get(code) : null;
}

io.on("connection", socket => {
  socket.on("createRoom", ({ name } = {}) => {
    const room = makeRoom(socket, name);
    emitRoom(room);
  });

  socket.on("joinRoom", ({ code, name } = {}) => {
    const room = rooms.get(String(code || "").trim());
    if (!room || room.phase !== "lobby" || room.players.length >= 4) {
      socket.emit("errorMessage", "Room not found, already started, or full.");
      return;
    }
    room.players.push({ id: socket.id, name: cleanName(name, `Player ${room.players.length + 1}`), bot: false, connected: true, hand: [], faceUp: [], faceDown: [], finished: false });
    socket.join(room.code);
    socket.data.roomCode = room.code;
    emitRoom(room);
  });

  socket.on("addBot", () => {
    const room = currentRoom(socket);
    if (!room || room.hostId !== socket.id) return;
    addBot(room);
    emitRoom(room);
  });

  socket.on("startGame", () => {
    const room = currentRoom(socket);
    if (!room || room.hostId !== socket.id) return;
    startGame(room);
    emitRoom(room);
  });

  socket.on("swapSetup", ({ first, second } = {}) => {
    const room = currentRoom(socket);
    if (!room || room.phase !== "setup") return;
    const playerIndex = room.players.findIndex(player => player.id === socket.id);
    if (playerIndex !== room.setupIndex) return;
    const player = room.players[playerIndex];
    if (!["hand", "faceUp"].includes(first?.zone) || !["hand", "faceUp"].includes(second?.zone) || first.zone === second.zone) return;
    if (!player[first.zone][first.index] || !player[second.zone][second.index]) return;
    [player[first.zone][first.index], player[second.zone][second.index]] = [player[second.zone][second.index], player[first.zone][first.index]];
    player.hand = sortCards(player.hand);
    room.message = "Swapped. Keep swapping, or press Done Setup.";
    emitRoom(room);
  });

  socket.on("doneSetup", () => {
    const room = currentRoom(socket);
    if (!room || room.phase !== "setup") return;
    const playerIndex = room.players.findIndex(player => player.id === socket.id);
    if (playerIndex !== room.setupIndex) return;
    advanceSetup(room);
    emitRoom(room);
  });

  socket.on("play", ({ zone, indexes } = {}) => {
    const room = currentRoom(socket);
    if (!room) return;
    const playerIndex = room.players.findIndex(player => player.id === socket.id);
    const error = playCards(room, playerIndex, zone, indexes);
    if (error) socket.emit("errorMessage", error);
    emitRoom(room);
    maybeBotTurn(room);
  });

  socket.on("pickup", () => {
    const room = currentRoom(socket);
    if (!room) return;
    const playerIndex = room.players.findIndex(player => player.id === socket.id);
    const error = pickUp(room, playerIndex);
    if (error) socket.emit("errorMessage", error);
    emitRoom(room);
    maybeBotTurn(room);
  });

  socket.on("disconnect", () => {
    const room = currentRoom(socket);
    if (!room) return;
    const player = room.players.find(player => player.id === socket.id);
    if (player) player.connected = false;
    emitRoom(room);
  });
});

server.listen(PORT, () => {
  console.log(`Shithead multiplayer server listening on ${PORT}`);
});
