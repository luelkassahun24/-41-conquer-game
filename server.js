const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');

app.use(express.json());

// 🌟 ይህ ነው የ public ፎልደርን (index.html እና admin.html) ለተጠቃሚው የሚያሳየው 🌟
app.use(express.static(path.join(__dirname, 'public')));

// የዳታቤዝ ማስመሰያ (In-memory Storage)
let users = {};
let deposits = [];
let withdrawals = [];

// 1. መመዝገቢያ (Register - 3 Day Free Trial)
app.post('/api/register', (req, res) => {
    const { name, phone, password } = req.body;
    if (users[phone]) return res.json({ error: 'ይህ ስልክ ቁጥር ከዚህ በፊት ተመዝግቧል!' });

    const trialEndDate = new Date();
    trialEndDate.setDate(trialEndDate.getDate() + 3);

    users[phone] = {
        name,
        phone,
        password,
        balance: 0,
        trialEnd: trialEndDate,
        status: 'ACTIVE',
        warnings: 0
    };
    res.json({ success: true, user: { name, phone, balance: 0 } });
});

// 2. መግቢያ (Login)
app.post('/api/login', (req, res) => {
    const { phone, password } = req.body;
    const user = users[phone];
    if (!user || user.password !== password) return res.json({ error: 'የተሳሳተ ስልክ ወይም የይለፍ ቃል!' });
    if (user.status === 'BANNED') return res.json({ error: 'አካውንትዎ ታግዷል! አድሚን ያነጋግሩ።' });

    res.json({ success: true, user: { name: user.name, phone: user.phone, balance: user.balance } });
});

// ==========================================
// የአድሚን REST APIs (Admin Panel)
// ==========================================
app.get('/admin/deposits', (req, res) => res.json(deposits));
app.get('/admin/withdrawals', (req, res) => res.json(withdrawals));

app.post('/admin/approve-deposit', (req, res) => {
    const { id } = req.body;
    const dep = deposits.find(d => d.id === id);
    if (dep && dep.status === 'PENDING') {
        dep.status = 'APPROVED';
        if (users[dep.phone]) users[dep.phone].balance += parseFloat(dep.amount);
    }
    res.json({ success: true });
});

app.post('/admin/approve-withdraw', (req, res) => {
    const { id } = req.body;
    const withReq = withdrawals.find(w => w.id === id);
    if (withReq && withReq.status === 'PENDING') {
        withReq.status = 'APPROVED';
    }
    res.json({ success: true });
});

app.post('/admin/user-action', (req, res) => {
    const { phone, action, amount } = req.body;
    const user = users[phone];
    if (!user) return res.json({ error: 'ተጫዋቹ አልተገኘም!' });

    if (action === 'WARN') {
        user.warnings += 1;
        io.emit('errorMsg', `⚠️ ማሳሰቢያ ለ ${user.name}: ህገወጥ አሰራር ተስተውሏል!`);
    } else if (action === 'DEDUCT') {
        user.balance = Math.max(0, user.balance - (amount || 200));
    } else if (action === 'BAN') {
        user.status = 'BANNED';
    }
    res.json({ success: true, message: 'እርምጃው ተወስዷል!' });
});


// ==========================================
// Socket.io የጨዋታ ሎጂክ (Game Engine)
// ==========================================
io.on('connection', (socket) => {
    
    // የካርታ መደብ (Deck) መፍጠሪያ
    const generateDeck = () => {
        const suits = ['♠', '♥', '♣', '♦'];
        const values = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
        let deck = [];
        suits.forEach(s => values.forEach(v => deck.push({ suit: s, value: v })));
        return deck.sort(() => Math.random() - 0.5);
    };

    // አድሚን ጨዋታ (Admin Game)
    socket.on('startAdminGame', (data) => {
        const user = users[data.phone];
        if (!user) return socket.emit('errorMsg', 'እባክዎ መጀመሪያ ይግቡ!');
        if (user.balance < data.stake) return socket.emit('errorMsg', 'በቂ ቀሪ ሂሳብ የለዎትም!');

        // ብር መቀነስ
        user.balance -= data.stake;

        let deck = generateDeck();
        let playerHand = deck.splice(0, 14);

        socket.emit('adminGameStarted', { playerHand });
    });

    socket.on('claimAdminWin', (data) => {
        const user = users[data.phone];
        if(!user) return;

        // የድል ዕድል ካልኩሌሽን (Win Probability)
        let isTrial = new Date() < new Date(user.trialEnd);
        let winChance = isTrial ? 0.50 : 0.125; // 50% for Trial, 12.5% for Paid

        // ተጫዋቹ እውነተኛ አሸናፊ ከሆነ (True Show)
        if (Math.random() < winChance) {
            user.balance += (data.stake * 2);
            socket.emit('adminGameWon', { newBalance: user.balance });
        } else {
            socket.emit('errorMsg', 'ካርታዎ ሙሉ በሙሉ አልተደራጀም!');
        }
    });

    // ብር ማስገባት (Deposit)
    socket.on('submitDeposit', (data) => {
        deposits.push({
            id: Date.now().toString(),
            phone: data.phone,
            amount: data.amount,
            status: 'PENDING'
        });
        socket.emit('depositSubmitted', 'የብር ማስገቢያ ጥያቄዎ በተሳካ ሁኔታ ተልኳል! በአጭር ጊዜ ውስጥ ይፀድቃል።');
    });

    // ብር ማውጣት (Withdraw)
    socket.on('submitWithdraw', (data) => {
        const user = users[data.phone];
        if (user && user.balance >= data.amount && data.amount >= 500) {
            user.balance -= data.amount;
            withdrawals.push({
                id: Date.now().toString(),
                phone: data.phone,
                amount: data.amount,
                accountDetails: data.accountDetails,
                status: 'PENDING'
            });
            socket.emit('withdrawSubmitted', 'የብር ማውጫ ጥያቄዎ ተልኳል!');
        } else {
            socket.emit('errorMsg', 'በቂ ቀሪ ሂሳብ የለዎትም ወይም መጠኑ ከ 500 ETB በታች ነው!');
        }
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
