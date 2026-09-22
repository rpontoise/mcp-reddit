import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

const app = express();
app.use(express.json());

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Accept": "application/json",
};

async function fetchRedditJson(url) {
  const res = await fetch(url, { headers: HEADERS });
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(`Reddit did not return JSON (status ${res.status}). First 200 chars: ${text.slice(0, 200)}`);
  }
}

function buildServer() {
  const server = new McpServer({ name: "reddit-public", version: "1.0.0" });

  server.tool(
    "get_subreddit_posts",
    "Get posts from a subreddit (hot, new, or top)",
    {
      subreddit: z.string(),
      sort: z.string().optional().default("hot"),
      limit: z.number().optional().default(10),
    },
    async ({ subreddit, sort, limit }) => {
      const url = `https://www.reddit.com/r/${subreddit}/${sort}.json?limit=${limit}`;
      const data = await fetchRedditJson(url);
      const posts = data.data.children.map((c) => ({
        title: c.data.title,
        score: c.data.score,
        author: c.data.author,
        num_comments: c.data.num_comments,
        permalink: `https://reddit.com${c.data.permalink}`,
      }));
      return { content: [{ type: "text", text: JSON.stringify(posts, null, 2) }] };
    }
  );

  server.tool(
    "search_reddit",
    "Search Reddit, optionally within one subreddit",
    {
      query: z.string(),
      subreddit: z.string().optional(),
      limit: z.number().optional().default(10),
    },
    async ({ query, subreddit, limit }) => {
      const base = subreddit
        ? `https://www.reddit.com/r/${subreddit}/search.json`
        : `https://www.reddit.com/search.json`;
      const url = `${base}?q=${encodeURIComponent(query)}&limit=${limit}&restrict_sr=${subreddit ? "on" : "off"}`;
      const data = await fetchRedditJson(url);
      const posts = data.data.children.map((c) => ({
        title: c.data.title,
        subreddit: c.data.subreddit,
        score: c.data.score,
        permalink: `https://reddit.com${c.data.permalink}`,
      }));
      return { content: [{ type: "text", text: JSON.stringify(posts, null, 2) }] };
    }
  );

  return server;
}

app.post("/mcp", async (req, res) => {
  const server = buildServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => {
    transport.close();
    server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`MCP server listening on port ${port}`));
