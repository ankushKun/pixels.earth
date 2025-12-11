import { serve } from "bun";
import index from "./index.html";
import { startIndexer } from "./server/indexer";
import db from "./server/db";

// Start the background indexer
startIndexer();

// CORS headers for API responses
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

// Helper to create JSON response with CORS headers
const jsonWithCors = (data: unknown, status = 200) => {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders,
    },
  });
};

const server = serve({
  routes: {
    // API Endpoints
    "/stats": () => {
        const stats = db.prepare('SELECT * FROM global_stats WHERE id = 1').get();
        return jsonWithCors(stats);
    },
    
    "/shards": () => {
        const shards = db.prepare('SELECT * FROM shards ORDER BY timestamp DESC LIMIT 50').all();
        return jsonWithCors(shards);
    },

    "/pixels": () => {
        const pixels = db.prepare('SELECT * FROM pixel_events ORDER BY timestamp DESC, id DESC LIMIT 100').all();
        return jsonWithCors(pixels);
    },

    "/feed": () => {
        const pixels = db.prepare('SELECT * FROM pixel_events ORDER BY timestamp DESC, id DESC LIMIT 15').all();
        const shards = db.prepare('SELECT * FROM shards ORDER BY timestamp DESC LIMIT 15').all();
        return jsonWithCors({ pixels, shards });
    },

    "/user": (req) => {
        const url = new URL(req.url);
        const address = url.searchParams.get("address");
        if (!address) return new Response("Missing address", { status: 400, headers: corsHeaders });
        
        const user = db.prepare('SELECT * FROM users WHERE main_wallet = ?').get(address);
        if (!user) return jsonWithCors({ pixels_placed_count: 0, shards_owned_count: 0 });
        return jsonWithCors(user);
    },

    // Serve static assets for OG tags
    "/banner.png": Bun.file("./public/banner.png"),
    "/icon.png": Bun.file("./public/icon.png"),

    // Serve index.html for /
    "/": index,
  },

  development: process.env.NODE_ENV !== "production" && {
    // Enable browser hot reloading in development
    hmr: true,

    // Echo console logs from the browser to the server
    console: true,
  },
  port:3002
});

console.log(`🚀 Server running at ${server.url}`);
console.log(`📊 Analytics API available at ${server.url}/stats`);