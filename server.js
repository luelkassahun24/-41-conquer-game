const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// Standard 52-card deck for Gin Rummy
function createDeck() {
    const suits = ['♠', '♥', '♦', '♣'];
    const values = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
    let deck = [];

    for (let suit of suits) {
        for (let val of values) {
            let pts = 10;
            if (val === 'A') pts = 1;
            else if (!isNaN(val)) pts = parseInt(val);
            deck.push({ suit, value: val, points: pts });
        }
    }

    // Shuffle
    for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
}

let activeGames = {};

io.on('connection', (socket) => {
    socket.on('startGinRummy', () => {
        const deck = createDeck();
        const playerHand = deck.splice(0, 10);
        const opponentHand = deck.splice(0, 10);
        const topDiscard = deck.pop();

        activeGames[socket.id] = {
            deck,
            discardPile: [topDiscard],
            playerHand,
            opponentHand,
            isPlayerTurn: true
        };

        socket.emit('gameInit', {
            playerHand,
            topDiscard,
            deckCount: deck.length
        });
    });

    socket.on('drawCard', (source) => {
        const game = activeGames[socket.id];
        if (!game || !game.isPlayerTurn) return;

        let card;
        if (source === 'deck' && game.deck.length > 0) {
            card = game.deck.pop();
        } else if (source === 'discard' && game.discardPile.length > 0) {
            card = game.discardPile.pop();
        }

        if (card) {
            game.playerHand.push(card);
            socket.emit('cardDrawn', {
                card,
                deckCount: game.deck.length,
                topDiscard: game.discardPile[game.discardPile.length - 1] || null
            });
        }
    });

    socket.on('discardCard', (cardIndex) => {
        const game = activeGames[socket.id];
        if (!game || !game.isPlayerTurn) return;

        if (cardIndex >= 0 && cardIndex < game.playerHand.length) {
            const discarded = game.playerHand.splice(cardIndex, 1)[0];
            game.discardPile.push(discarded);

            socket.emit('cardDiscarded', {
                playerHand: game.playerHand,
                topDiscard: discarded
            });
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Gin Rummy Server running on port ${PORT}`));
