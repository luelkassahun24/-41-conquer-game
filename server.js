const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(__dirname));

// Routing
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'), (err) => {
        if (err) res.sendFile(path.join(__dirname, 'index.html'));
    });
});

app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'), (err) => {
        if (err) res.sendFile(path.join(__dirname, 'admin.html'));
    });
});

let users = {};
let deposits = [];
let withdrawals = [];

// Register API
app.post('/api/register', (req, res) => {
    const { name, phone, password } = req.body;
    if (users[phone]) return res.json({ error: 'ይህ ስልክ ቁጥር ከዚህ በፊት ተመዝግቧል!' });

    const trialEndDate = new Date();
    trialEndDate.setDate(trialEndDate.getDate() + 3);

    users[phone] = {
        name,
        phone,
        password,
        balance: 100, // ለሙከራ 100 ብር ቦነስ
        trialEnd: trialEndDate,
        status: 'ACTIVE'
    };
    res.json({ success: true, user: { name, phone, balance: 100 } });
});

// Login API
app.post('/api/login', (req, res) => {
    const { phone, password } = req.body;
    const user = users[phone];
    if (!user || user.password !== password) return res.json({ error: 'የተሳሳተ ስልክ ወይም የይለፍ ቃል!' });
    res.json({ success: true, user: { name: user.name, phone: user.phone, balance: user.balance } });
});

// Socket Logic
io.on('connection', (socket) => {
    const generateDeck = () => {
        const suits = ['♠', '♥', '♣', '♦'];
        const values = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
        let deck = [];
        suits.forEach(s => values.forEach(v => deck.push({ suit: s, value: v })));
        return deck.sort(() => Math.random() - 0.5);
    };

    socket.on('startAdminGame', (data) => {
        const user = users[data.phone];
        if (!user) return socket.emit('errorMsg', 'እባክዎ መጀመሪያ ይግቡ!');

        let deck = generateDeck();
        let playerHand = deck.splice(0, 14);

        socket.emit('adminGameStarted', { playerHand });
    });

    socket.on('claimAdminWin', (data) => {
        const user = users[data.phone];
        if (!user) return;
        user.balance += (data.stake * 2);
        socket.emit('adminGameWon', { newBalance: user.balance });
    });

    socket.on('submitDeposit', (data) => {
        deposits.push({ id: Date.now().toString(), phone: data.phone, amount: data.amount, status: 'PENDING' });
        socket.emit('depositSubmitted', 'የብር ማስገቢያ ጥያቄዎ በተሳካ ሁኔታ ተልኳል!');
    });

    socket.on('submitWithdraw', (data) => {
        const user = users[data.phone];
        if (user && user.balance >= data.amount) {
            user.balance -= data.amount;
            withdrawals.push({ id: Date.now().toString(), phone: data.phone, amount: data.amount, accountDetails: data.accountDetails, status: 'PENDING' });
            socket.emit('withdrawSubmitted', 'የብር ማውጫ ጥያቄዎ ተልኳል!');
        } else {
            socket.emit('errorMsg', 'በቂ ቀሪ ሂሳብ የለዎትም!');
        }
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log(`Server running on port ${PORT}`));
