# pixels.earth

## Core Specs

- The entire earth's map is a pixel grid of **2^19 × 2^19 pixels** = 524,288 × 524,288 = **274 billion pixels** total.
- The map is divided into **90×90 pixel shards** = 5,826 × 5,826 = **~34 million shards**.
- Every shard is an account on Solana (~8KB per shard ≈ **0.057 SOL** rent-exempt cost).
- **8-bit color depth** = 255 available colors (index 0 = transparent/erased).

## Shard Ownership

- Unlocking a shard means the user paid and initialized the account - they now **own the shard**.
  - Account init fee goes to the network
  - Fractional platform fee goes to the smart contract
- Shards are the user's **territory** - they can draw freely without any limits or cooldowns.
- **Earn**: When someone else places pixels on your territory, you receive tokens (1 token / 10 pixels placed).

## Cooldowns & Premiums

- Drawing on other people's shards = **cooldown of 30 seconds** after every **50 pixels** placed.
- Players can bypass cooldown by paying a small fee to the shard owner (in SOL or tokens).
- After paying fees, no cooldown for **3 hours**.

## Future Features (Not Yet Implemented)

### Dead Shards
- Shards without activity can be reclaimed by active users for free or cheaper fee.

### Image Upload (Premium)
- Upload an image → converts to pixels → places on map.

### Territory Defense
- Notifications when someone draws on your territory.
- Defend your art by restoring/undoing mess.

### XP System
- Earn XP for placing pixels on others' territories.
- More XP = lesser cooldown.

### Shard Badges
- 🟢 **Rookie**: 10 shard
- 🏠 **Landlord**: 100 shards
- 🏗️ **Builder**: 1000 shards
- 🏛️ **Architect**: 2500 shards
- 💎 **Collector**: 5000 shards
- 👑 **Final Shard Boss**: 10000 shards

### Leaderboards
- Most shards owned
- Most pixels placed (in enemy territory)
- Most XP earned
- Most earned through fees

### Profile Page
- Showcase artwork (select range of pixels on map)
- Live state display (someone could destroy your art!)
- Artwork as **live trading cards** (like Harry Potter cards)

### Factions
- Blue vs Red vs Green vs Yellow factions
- Faction wars across continents
- Weekly challenges:
  - Most pixels placed by faction
  - Most earned by faction
- Reference: Ingress
