import dotenv from "dotenv";
import express from "express";
import cors from "cors";
import { Agent } from "@mariozechner/pi-agent-core";
import { getModel, ImageContent } from "@mariozechner/pi-ai";
import { fileTools } from "./tools/fileTools.js";
import { webSearchTool } from "./tools/webSearch.js";

// Load .env file
dotenv.config();

// Simple ID generator
function generateId(): string {
  return Math.random().toString(36).substring(2, 15) + Date.now().toString(36);
}

const app = express();
app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

// Session storage (in-memory for demo, use Redis/DB in production)
interface Session {
  id: string;
  messages: Array<{ role: string; content: any; timestamp: number }>;
  createdAt: number;
}

const sessions = new Map<string, Session>();

// API Base URL for MiniMax proxy
const API_BASE_URL = "http://localhost:3002";
const API_KEY = process.env.MINIMAX_CN_API_KEY || "";

// Working directory for file operations
const WORKING_DIR = process.cwd();

// Create model with proxy
function createModel() {
  const baseModel = getModel("minimax-cn", "MiniMax-M2.7" as any);
  return {
    ...baseModel,
    baseUrl: API_BASE_URL,
  };
}

// System prompt for the agent
const SYSTEM_PROMPT = `You are a helpful AI assistant with access to various tools.

## Your Capabilities
1. **File Operations**: You can read, write, edit, view, and list files in the local project directory.
2. **Web Search**: You can search the web for real-time information, facts, and news.
3. **Image Generation**: You can generate images based on descriptions.

## Rules
1. Always respond in the same language as the user.
2. Only answer the LATEST user message. Do NOT repeat or summarize previous questions.
3. Use tools when appropriate to provide accurate, up-to-date information.
4. For file operations, use the working directory as base path.
5. When generating files or images, provide download links/buttons in your response.
6. Always provide code with proper syntax highlighting when showing code.

## Context Management
- You maintain conversation history internally
- Only respond to the current question based on relevant context
- Do not repeat explanations or information from previous responses`;

// Create agent with tools
function createAgent(sessionId: string): Agent {
  const session = sessions.get(sessionId);

  const agent = new Agent({
    getApiKey: () => API_KEY,
    initialState: {
      systemPrompt: SYSTEM_PROMPT,
      model: createModel(),
      thinkingLevel: "off",
      messages: [],
      tools: [...fileTools, webSearchTool],
    },
    convertToLlm: (agentMessages) => {
      // Simple passthrough - agent manages its own context
      return agentMessages.map((m: any) => {
        if (m.role === "user" || m.role === "user-with-attachments") {
          const content = (m.content || []).map((c: any) => c.text || c.imageUrl || "").join("");
          return { role: "user" as const, content };
        }
        if (m.role === "assistant") {
          const text = (m.content || []).map((c: any) => c.text || "").join("");
          return { role: "assistant" as const, content: text };
        }
        return null;
      }).filter(Boolean);
    },
  });

  return agent;
}

// Chat endpoint
app.post("/api/chat", async (req, res) => {
  const { content, session_id, attachments } = req.body;

  if (!content && (!attachments || attachments.length === 0)) {
    return res.status(400).json({ error: "Content or attachments required" });
  }

  // Check API key
  if (!API_KEY) {
    res.status(500).json({ error: "MINIMAX_CN_API_KEY environment variable not set" });
    return;
  }

  // Get or create session
  let sessionId = session_id;
  if (!sessionId) {
    sessionId = generateId();
  }

  let session = sessions.get(sessionId);
  if (!session) {
    session = { id: sessionId, messages: [], createdAt: Date.now() };
    sessions.set(sessionId, session);
  }

  // Set headers for streaming
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");

  try {
    const agent = createAgent(sessionId);

    // Process attachments if any
    let messageContent = content || "";
    const images: ImageContent[] = [];

    if (attachments && attachments.length > 0) {
      for (const attachment of attachments) {
        if (attachment.type === "image") {
          images.push({
            type: "image",
            imageUrl: attachment.url,
          });
        } else if (attachment.type === "file") {
          // Read file content
          const fs = await import("fs/promises");
          try {
            const fileContent = await fs.readFile(attachment.path, "utf-8");
            messageContent += `\n\n[File: ${attachment.name}]\n${fileContent}`;
          } catch {
            messageContent += `\n\n[File: ${attachment.name}] (could not read)`;
          }
        }
      }
    }

    // Subscribe to events for streaming
    let lastAssistantText = "";

    agent.subscribe(async (event: any) => {
      switch (event.type) {
        case "message_start":
          if (event.message?.role === "assistant") {
            res.write(`event: message_start\ndata: ${JSON.stringify({ role: "assistant" })}\n\n`);
          }
          break;
        case "message_update":
          if (event.message?.role === "assistant" && event.message.content) {
            // Extract text content
            const textBlocks = event.message.content
              .filter((c: any) => c.type === "text")
              .map((c: any) => c.text)
              .join("");
            if (textBlocks) {
              lastAssistantText = textBlocks;
              res.write(`event: message_update\ndata: ${JSON.stringify({ content: textBlocks })}\n\n`);
            }
          }
          break;
        case "message_end":
          if (event.message?.role === "assistant") {
            res.write(`event: message_end\ndata: ${JSON.stringify({ done: true })}\n\n`);
          }
          break;
        case "tool_execution_start":
          res.write(`event: tool_start\ndata: ${JSON.stringify({ tool: event.toolName, args: event.args })}\n\n`);
          break;
        case "tool_execution_end":
          res.write(`event: tool_end\ndata: ${JSON.stringify({ tool: event.toolName, result: event.result })}\n\n`);
          break;
        case "agent_end":
          // Extract final assistant message text
          const messages = event.messages || [];
          const lastMsg = messages[messages.length - 1];

          if (lastMsg?.role === "assistant" && lastMsg.content) {
            // Try to find text content
            const textContent = lastMsg.content
              .filter((c: any) => c.type === "text")
              .map((c: any) => c.text)
              .join("");

            if (textContent) {
              lastAssistantText = textContent;
              res.write(`event: message_update\ndata: ${JSON.stringify({ content: textContent })}\n\n`);
            } else if (lastMsg.errorMessage) {
              // API error
              res.write(`event: error\ndata: ${JSON.stringify({ error: lastMsg.errorMessage })}\n\n`);
            } else if (lastMsg.stopReason === "toolUse") {
              // Tool was used but no final text - check thinking
              const thinking = lastMsg.content
                .filter((c: any) => c.type === "thinking")
                .map((c: any) => c.thinking)
                .join("");
              if (thinking) {
                lastAssistantText = thinking;
                res.write(`event: message_update\ndata: ${JSON.stringify({ content: thinking })}\n\n`);
              }
            }
          }

          res.write(`event: agent_end\ndata: ${JSON.stringify({ messages: event.messages })}\n\n`);
          res.end();
          break;
      }
    });

    // Send message
    if (images.length > 0) {
      await agent.prompt(messageContent, images);
    } else {
      await agent.prompt(messageContent);
    }

    // Update session messages
    sessions.set(sessionId, {
      ...session,
      messages: agent.state.messages as any,
    });

  } catch (error: any) {
    console.error("Chat error:", error);
    console.error("Error stack:", error.stack);
    if (!res.headersSent) {
      res.status(500).json({ error: error.message });
    } else {
      res.write(`event: error\ndata: ${JSON.stringify({ error: error.message })}\n\n`);
      res.end();
    }
  }
});

// Get session history
app.get("/api/session/:id", (req, res) => {
  const session = sessions.get(req.params.id);
  if (!session) {
    return res.status(404).json({ error: "Session not found" });
  }
  res.json({
    id: session.id,
    messages: session.messages,
    createdAt: session.createdAt,
  });
});

// Delete session
app.delete("/api/session/:id", (req, res) => {
  sessions.delete(req.params.id);
  res.json({ success: true });
});

// Generate image endpoint
app.post("/api/generate-image", async (req, res) => {
  const { prompt } = req.body;

  // This would call an image generation API
  // For now, return a placeholder
  res.json({
    success: true,
    imageUrl: `https://placeholder.com/image?text=${encodeURIComponent(prompt)}`,
    message: "Image generation would happen here with MiniMax or DALL-E integration"
  });
});

// File operations endpoints
app.get("/api/files", async (req, res) => {
  const { path = "." } = req.query;
  const fs = await import("fs/promises");
  const pathModule = await import("path");

  try {
    const fullPath = pathModule.resolve(WORKING_DIR, path as string);
    const entries = await fs.readdir(fullPath, { withFileTypes: true });

    const files = entries.map(entry => ({
      name: entry.name,
      type: entry.isDirectory() ? "directory" : "file",
      path: pathModule.relative(WORKING_DIR, pathModule.join(fullPath, entry.name)),
    }));

    res.json({ files });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/files/read", async (req, res) => {
  const { path: filePath } = req.query;
  const fs = await import("fs/promises");
  const pathModule = await import("path");

  if (!filePath) {
    return res.status(400).json({ error: "Path required" });
  }

  try {
    const fullPath = pathModule.resolve(WORKING_DIR, filePath as string);
    const content = await fs.readFile(fullPath, "utf-8");
    res.json({ content });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/files/write", async (req, res) => {
  const { path: filePath, content } = req.body;
  const fs = await import("fs/promises");
  const pathModule = await import("path");

  if (!filePath || content === undefined) {
    return res.status(400).json({ error: "Path and content required" });
  }

  try {
    const fullPath = pathModule.resolve(WORKING_DIR, filePath);
    await fs.writeFile(fullPath, content, "utf-8");
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Health check
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", sessions: sessions.size });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
