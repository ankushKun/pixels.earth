import { serve } from "bun";
import index from "./index.html";
import { startIndexer } from "./server/indexer";
import db from "./server/db";

// Start the background indexer
startIndexer();

const server = serve({
  routes: {
    // API Endpoints
    "/api/stats": () => {
        const stats = db.prepare('SELECT * FROM global_stats WHERE id = 1').get();
        return Response.json(stats);
    },
    
    "/api/shards": () => {
        const shards = db.prepare('SELECT * FROM shards ORDER BY timestamp DESC LIMIT 50').all();
        return Response.json(shards);
    },

    "/api/pixels": () => {
        const pixels = db.prepare('SELECT * FROM pixel_events ORDER BY timestamp DESC LIMIT 100').all();
        return Response.json(pixels);
    },

    "/api/feed": () => {
        const pixels = db.prepare('SELECT * FROM pixel_events ORDER BY timestamp DESC LIMIT 15').all();
        const shards = db.prepare('SELECT * FROM shards ORDER BY timestamp DESC LIMIT 15').all();
        return Response.json({ pixels, shards });
    },

    "/api/user": (req) => {
        const url = new URL(req.url);
        const address = url.searchParams.get("address");
        if (!address) return new Response("Missing address", { status: 400 });
        
        const user = db.prepare('SELECT * FROM users WHERE main_wallet = ?').get(address);
        if (!user) return Response.json({ pixels_placed_count: 0, shards_owned_count: 0 });
        return Response.json(user);
    },

    // Serve index.html for all unmatched routes.
    "/*": index,
  },

  development: process.env.NODE_ENV !== "production" && {
    // Enable browser hot reloading in development
    hmr: true,

    // Echo console logs from the browser to the server
    console: true,
  },
});

console.log(`🚀 Server running at ${server.url}`);
console.log(`📊 Analytics API available at ${server.url}api/stats`);
