// 54 Cards (52 standard + 2 Jokers)
function createDeck() {
    const suits = ['♠', '♥', '♦', '♣'];
    const values = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
    let deck = [];

    for (let suit of suits) {
        for (let val of values) {
            let pts = 10;
            if (val === 'A') pts = 1;
            else if (!isNaN(val)) pts = parseInt(val);
            deck.push({ id: `${val}-${suit}-${Math.random().toString(36).substr(2, 9)}`, suit, value: val, points: pts });
        }
    }

    // 2 Jokers መጨመር (ለ 54 ካርታ ስብስብ)
    deck.push({ id: `JK1-${Math.random()}`, suit: '🃏', value: 'JK', points: 0 });
    deck.push({ id: `JK2-${Math.random()}`, suit: '🃏', value: 'JK', points: 0 });

    // Shuffle
    for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
}

// ...

socket.on('initGame', () => {
    const deck = createDeck(); // 54 cards
    
    const playerHand = deck.splice(0, 13);    // 13 cards
    const opponentHand = deck.splice(0, 13);  // 13 cards
    const topDiscard = deck.pop();             // 1 card
    
    // 54 - (13 + 13 + 1) = 27 cards remaining in Deck

    activeGames[socket.id] = {
        deck,
        discardPile: [topDiscard],
        playerHand,
        opponentHand
    };

    socket.emit('gameStarted', {
        playerHand,
        topDiscard,
        deckCount: deck.length // በትክክል 27 ያሳያል
    });
});
