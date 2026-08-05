const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

function createDeck() {
    const suits = ['♠', '♥', '♦', '♣'];
    const values = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
    let deck = [];

    for (let suit of suits) {
        for (let val of values) {
            let pts = 10;
            if (val === 'A') pts = 1;
            else if (!isNaN(val)) pts = parseInt(val);
            deck.push({ id: `${val}-${suit}-${Math.random()}`, suit, value: val, points: pts });
        }
    }

    for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
}

let gameState = {
    deck: [],
    discardPile: [],
    playerHand: [],
    opponentHandCount: 13,
    isPlayerTurn: true,
    timeLeft: 15
};

let timerInterval = null;

function startTimer() {
    clearInterval(timerInterval);
    gameState.timeLeft = 15;
    io.emit('timerUpdate', gameState.timeLeft);

    timerInterval = setInterval(() => {
        gameState.timeLeft--;
        io.emit('timerUpdate', gameState.timeLeft);
        if (gameState.timeLeft <= 0) {
            gameState.isPlayerTurn = !gameState.isPlayerTurn;
            startTimer();
        }
    }, 1000);
}

io.on('connection', (socket) => {
    socket.on('initGame', () => {
        const deck = createDeck();
        // 13 Cards Hand distribution
        gameState.playerHand = deck.splice(0, 13);
        gameState.deck = deck;
        gameState.discardPile = [gameState.deck.pop()];
        gameState.isPlayerTurn = true;

        socket.emit('gameStarted', {
            playerHand: gameState.playerHand,
            topDiscard: gameState.discardPile[gameState.discardPile.length - 1],
            deckCount: gameState.deck.length
        });

        startTimer();
    });

    socket.on('drawCard', (source) => {
        if (!gameState.isPlayerTurn || gameState.playerHand.length >= 14) return;

        let drawnCard = null;
        if (source === 'deck' && gameState.deck.length > 0) {
            drawnCard = gameState.deck.pop();
        } else if (source === 'discard' && gameState.discardPile.length > 0) {
            drawnCard = gameState.discardPile.pop();
        }

        if (drawnCard) {
            gameState.playerHand.push(drawnCard);
            socket.emit('cardDrawn', {
                playerHand: gameState.playerHand,
                deckCount: gameState.deck.length,
                topDiscard: gameState.discardPile[gameState.discardPile.length - 1] || null
            });
        }
    });

    socket.on('discardCard', (cardId) => {
        if (!gameState.isPlayerTurn || gameState.playerHand.length !== 14) return;

        const cardIndex = gameState.playerHand.findIndex(c => c.id === cardId);
        if (cardIndex !== -1) {
            const discarded = gameState.playerHand.splice(cardIndex, 1)[0];
            gameState.discardPile.push(discarded);
            gameState.isPlayerTurn = false;

            socket.emit('cardDiscarded', {
                playerHand: gameState.playerHand,
                topDiscard: discarded
            });

            startTimer();
        }
    });

    socket.on('reorderHand', (newHand) => {
        gameState.playerHand = newHand;
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
