# Apps
An app is a page you write in {built}/apps/<name>/ and show on a card (card_show with app). It keeps what the user
makes in it (notes, lists, picks) with /app/agents.js (agents.load, agents.save), on the server and shared by every
card showing it; never localStorage (one browser only, and you can't see it).
Before writing or changing an app, read README.md: it has all an app needs (showing it, its data, its look, checking it).
