const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));
app.use(express.json());

// Telegram Bot Credentials (በኋላ እውነተኛ Token አስገባበት)
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || 'YOUR_TELEGRAM_BOT_TOKEN';
const TELEGRAM_ADMIN_CHAT_ID = process.env.TELEGRAM_ADMIN_CHAT_ID || 'YOUR_ADMIN_CHAT_ID';

function sendTelegramNotification(message) {
  if (TELEGRAM_BOT_TOKEN === 'YOUR_TELEGRAM_BOT_TOKEN') return;
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: TELEGRAM_ADMIN_CHAT_ID, text: message })
  }).catch(err => console.error('Telegram Bot Error:', err));
}

// System Database State
const users = {}; // { phone: { name, phone, password, balance, regDate, falseShowCount, isBanned } }
const pendingDeposits = []; // [{ id, phone, amount, proofUrl, status }]
const pendingWithdrawals = []; // [{ id, phone, amount, accountDetails, status }]
const rooms = {};

// Deck Creation
function createDeck() {
  const suits = ['♠', '♥', '♦', '♣'];
  const values = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
  let deck = [];

  for (let suit of suits) {
    for (let value of values) {
      let points = 0;
      if (value === 'A') points = 11;
      else if (['10', 'J', 'Q', 'K'].includes(value)) points = 10;
      else points = parseInt(value);

      deck.push({ suit, value, points });
    }
  }
  // Add Joker
  deck.push({ suit: '🃏', value: 'JOKER', points: 0, isJoker: true });
  return deck.sort(() => Math.random() - 0.5);
}

// Trial Check: 3 Days
function isTrialActive(user) {
  const now = new Date();
  const regDate = new Date(user.regDate);
  const diffTime = Math.abs(now - regDate);
  const diffDays = diffTime / (1000 * 60 * 60 * 24);
  return diffDays <= 3;
}

// REST API for Authentication
app.post('/api/register', (req, res) => {
  const { name, phone, password } = req.body;
  if (!name || !phone || !password) return res.status(400).json({ error: 'ሁሉም መረጃዎች ያስፈልጋሉ!' });

  if (users[phone]) return res.status(400).json({ error: 'ይህ የስልክ ቁጥር ተመዝግቧል!' });

  users[phone] = {
    name,
    phone,
    password,
    balance: 0,
    regDate: new Date().toISOString(),
    falseShowCount: 0,
    isBanned: false,
    hasDeposited: false
  };

  res.json({ message: 'ምዝገባው ተሳክቷል!', user: users[phone] });
});

app.post('/api/login', (req, res) => {
  const { phone, password } = req.body;
  const user = users[phone];

  if (!user || user.password !== password) {
    return res.status(400).json({ error: 'የተሳሳተ የስልክ ቁጥር ወይም የይለፍ ቃል!' });
  }

  if (user.isBanned) {
    return res.status(403).json({ error: 'መለያዎ የታገደ ነው!' });
  }

  res.json({ user, isTrial: isTrialActive(user) });
});

// Admin REST APIs
app.get('/admin/deposits', (req, res) => res.json(pendingDeposits));
app.get('/admin/withdrawals', (req, res) => res.json(pendingWithdrawals));

app.post('/admin/approve-deposit', (req, res) => {
  const { id } = req.body;
  const reqItem = pendingDeposits.find(d => d.id === id);
  if (reqItem && reqItem.status === 'PENDING') {
    reqItem.status = 'APPROVED';
    users[reqItem.phone].balance += reqItem.amount;
    users[reqItem.phone].hasDeposited = true;
    res.json({ message: 'Deposit ተፈቅዷል' });
  } else {
    res.status(400).json({ error: 'ጥያቄው አልተገኘም' });
  }
});

app.post('/admin/approve-withdraw', (req, res) => {
  const { id } = req.body;
  const reqItem = pendingWithdrawals.find(w => w.id === id);
  if (reqItem && reqItem.status === 'PENDING') {
    reqItem.status = 'APPROVED';
    res.json({ message: 'Withdrawal ተፈቅዷል' });
  } else {
    res.status(400).json({ error: 'ጥያቄው አልተገኘም' });
  }
});

app.post('/admin/user-action', (req, res) => {
  const { phone, action, amount } = req.body;
  const user = users[phone];
  if (!user) return res.status(404).json({ error: 'ተጫዋች አልተገኘም' });

  if (action === 'WARN') {
    res.json({ message: 'ማስጠንቀቂያ ተልኳል' });
  } else if (action === 'DEDUCT') {
    const deductAmt = amount || 200;
    user.balance = Math.max(0, user.balance - deductAmt);
    res.json({ message: `${deductAmt} ETB ተቀንሷል` });
  } else if (action === 'BAN') {
    user.isBanned = true;
    res.json({ message: 'አካውንቱ ታግዷል' });
  }
});

// Socket.io Game Architecture
io.on('connection', (socket) => {
  
  // Deposit Request
  socket.on('submitDeposit', ({ phone, amount, proofUrl }) => {
    const depId = Date.now().toString();
    pendingDeposits.push({ id: depId, phone, amount: parseFloat(amount), proofUrl, status: 'PENDING' });
    sendTelegramNotification(`💰 አዲስ የብር ማስገቢያ ጥያቄ!\nስልክ: ${phone}\nመጠን: ${amount} ETB`);
    socket.emit('depositSubmitted', 'የገንዘብ ማስገቢያ ጥያቄዎ ለአድሚን ተልኳል!');
  });

  // Withdraw Request
  socket.on('submitWithdraw', ({ phone, amount, accountDetails }) => {
    const user = users[phone];
    if (!user) return;
    if (amount < 500) return socket.emit('errorMsg', 'አነስተኛው የማውጫ ገደብ 500 ETB ነው!');
    if (user.balance < amount) return socket.emit('errorMsg', 'በቂ ባላንስ የለዎትም!');

    user.balance -= amount; // Hold balance
    const withdrawId = Date.now().toString();
    pendingWithdrawals.push({ id: withdrawId, phone, amount, accountDetails, status: 'PENDING' });

    sendTelegramNotification(`💸 አዲስ የብር ማውጫ ጥያቄ!\nስልክ: ${phone}\nመጠን: ${amount} ETB\nመረጃ: ${accountDetails}`);
    socket.emit('withdrawSubmitted', 'የብር ማውጣት ጥያቄዎ ተልኳል!');
  });

  // Single Player vs Admin (Bot) Mode
  socket.on('startAdminGame', ({ phone, stake }) => {
    const user = users[phone];
    if (!user) return;
    if (stake < 10) return socket.emit('errorMsg', 'ከአድሚን ጋር ለመጫወት አነስተኛው መደብ 10 ETB ነው!');

    const isTrial = isTrialActive(user) && !user.hasDeposited;
    if (!isTrial && user.balance < stake) {
      return socket.emit('errorMsg', 'የነፃ ሙከራ ጊዜዎ አልቋል! እባክዎን ብር ማስገባት (Deposit) ያድርጉ።');
    }

    if (!isTrial) {
      user.balance -= stake;
    }

    const deck = createDeck();
    const playerHand = deck.splice(0, 13);
    const adminHand = deck.splice(0, 13);

    // Dynamic Win Probability Logic
    const winProbability = isTrial ? 0.50 : 0.125; // 50% for Trial, 12.5% for Paid Real Mode

    socket.emit('adminGameStarted', {
      playerHand,
      stake,
      winProbability,
      isTrial
    });
  });

  // Admin Game Claim Victory
  socket.on('claimAdminWin', ({ phone, stake, isFalseShow }) => {
    const user = users[phone];
    if (!user) return;

    if (isFalseShow) {
      user.falseShowCount += 1;
      if (user.falseShowCount <= 2) {
        socket.emit('errorMsg', `ማስጠንቀቂያ፦ ሳይጨርሱ ጨረስኩ ብለዋል። (ጥሰት ${user.falseShowCount}/3)`);
      } else {
        user.falseShowCount = 0;
        socket.emit('errorMsg', '3 ጊዜ የተሳሳተ ጥሰት በመፈጸምዎ የመደብ ብርዎ ተበልቷል!');
      }
      return;
    }

    // Payout Logic: 5x Stake
    const winAmount = stake * 5;
    user.balance += winAmount;
    socket.emit('adminGameWon', { winAmount, newBalance: user.balance });
  });

  // Multiplayer Group Logic
  socket.on('createGroupRoom', ({ phone, stake }) => {
    const user = users[phone];
    if (!user) return;
    if (stake < 50) return socket.emit('errorMsg', 'የግሩፕ ጨዋታ አነስተኛ መግቢያ 50 ETB ነው!');

    const roomId = Math.floor(1000 + Math.random() * 9000).toString();
    rooms[roomId] = {
      id: roomId,
      creator: phone,
      stake: parseFloat(stake),
      players: [],
      deck: [],
      discardPile: [],
      status: 'WAITING',
      currentTurn: 0
    };

    socket.emit('roomCreated', { roomId, stake });
  });

  socket.on('joinGroupRoom', ({ roomId, phone }) => {
    const room = rooms[roomId];
    const user = users[phone];
    if (!room || !user) return socket.emit('errorMsg', 'ክፍሉ አልተገኘም!');

    const isTrial = isTrialActive(user) && !user.hasDeposited;
    if (!isTrial && user.balance < room.stake) {
      return socket.emit('errorMsg', 'የነፃ ሙከራ ጊዜዎ አልቋል! በቂ ባላንስ የለዎትም።');
    }

    socket.join(roomId);
    room.players.push({ id: socket.id, phone, name: user.name, hand: [] });

    io.to(roomId).emit('playerJoined', { playersCount: room.players.length });

    if (room.players.length >= 4 && room.status === 'WAITING') {
      // Start Game Flow
      room.status = 'SORTING_PHASE';
      room.deck = createDeck();

      // Card Distribution
      room.players.forEach((p, idx) => {
        const count = (idx === 0) ? 14 : 13;
        p.hand = room.deck.splice(0, count);
      });

      // Deduction
      room.players.forEach(p => {
        if (!isTrialActive(users[p.phone])) {
          users[p.phone].balance -= room.stake;
        }
      });

      // 20 Seconds Card Sorting Phase Announcement
      io.to(roomId).emit('startSortingPhase', {
        duration: 20,
        msg: '🧩 ካርታዎን ያደራጁ (20 ሰከንድ)'
      });

      setTimeout(() => {
        room.status = 'PLAYING';
        io.to(roomId).emit('startPlayPhase', {
          players: room.players,
          turn: room.currentTurn
        });
      }, 20000);
    }
  });

});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Werq 41 Master Plan Server running on port ${PORT}`);
});
