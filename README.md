# Shithead

A browser-based Shithead card game with two modes:

- `index.html`: static hot-seat version for one shared screen.
- `online.html` + `server.js`: realtime multiplayer version where each player uses their own phone.

## Play

For the static version, open `index.html` in a browser or publish this folder with GitHub Pages.

For the multiplayer version:

```bash
npm install
npm start
```

Then open `http://localhost:3000`.

To play from phones, deploy the Node app to a host such as Render, Railway, Fly.io, or a VPS. GitHub Pages cannot run the multiplayer server by itself.

## Online Multiplayer

- One player creates a room.
- Other players join from their own phone with the room code.
- The server owns the deck, pile, turns, and hidden cards.
- Each phone only receives that player's private hand.
- Computers can fill empty seats.

## Rules in this build

- Choose 2-4 total players.
- Each player can be human or computer.
- Human players pass the PC between private turns.
- Before play, human players can swap cards between their hand and face-up cards.
- Lowest hand starts; 3 is low and 2 is special.
- You must play if you can; pick up only if you cannot play.
- 2 resets the pile.
- 10 clears the pile and the same player goes again.
- Four of a kind clears the pile and the same player goes again.
- No 7 or 8 special rules.
