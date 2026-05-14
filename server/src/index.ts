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

## Current Date and Time
The current date is ${new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })}. Always use this as the reference for "today".

## Your Capabilities
1. **File Operations**: You can read, write, edit, view, and list files in the local project directory.
2. **Web Search**: You can search the web for real-time information, facts, and news. Note: web search returns placeholder data, do NOT rely on it for accurate real-time information.
3. **Image Generation**: You can generate images based on descriptions.

## Multi-Turn Conversation
- You are engaged in a continuous multi-turn conversation with the user.
- ALWAYS maintain and reference the full conversation history from previous turns.
- When the user asks follow-up questions or refers to previous topics, use the conversation context to provide relevant responses.
- Do NOT ask the user to repeat information they have already provided.
- If the user says "continue", "go on", or similar, continue from where you left off.
- Remember key details from earlier in the conversation (file names, paths, user preferences, etc.).

## Rules
1. Always respond in the same language as the user.
2. Use the conversation history to understand context and references in the user's messages.
3. Use tools when appropriate to provide accurate, up-to-date information.
4. For file operations, use the working directory as base path.
5. When generating files or images, provide download links/buttons in your response.
6. Always provide code with proper syntax highlighting when showing code.
7. Do not repeat or summarize previous questions - just answer the current question.

## Context Management
- The conversation history is automatically maintained between turns.
- Respond naturally to follow-up questions that reference previous responses.
- Keep track of important context across the conversation.`;

// Create agent with tools
function createAgent(sessionId: string): Agent {
  const session = sessions.get(sessionId);

  // Normalize session messages to ensure content is always in array format
  const normalizeMessages = (messages: any[]): any[] => {
    return messages.map((m) => {
      // If content is a string, convert to array format
      if (typeof m.content === "string") {
        return {
          ...m,
          content: [{ type: "text", text: m.content }],
        };
      }
      return m;
    });
  };

  const normalizedMessages = session?.messages ? normalizeMessages(session.messages) : [];

  console.log(`[Agent] Creating agent for session ${sessionId}, history length: ${normalizedMessages.length}`);

  const agent = new Agent({
    getApiKey: () => API_KEY,
    initialState: {
      systemPrompt: SYSTEM_PROMPT,
      model: createModel(),
      thinkingLevel: "medium",
      messages: normalizedMessages,
      tools: [...fileTools, webSearchTool],
    },
    convertToLlm: (agentMessages) => {
      // Convert agent messages to LLM message format
      // Ensure content is always in array format for consistency
      console.log(`[convertToLlm] Converting ${agentMessages.length} messages to LLM format`);
      return agentMessages.map((m: any) => {
        if (m.role === "user" || m.role === "user-with-attachments") {
          // Ensure content is an array of content blocks
          if (typeof m.content === "string") {
            return { role: "user" as const, content: [{ type: "text", text: m.content }] };
          }
          // Already in array format, pass through
          const text = (m.content || []).map((c: any) => c.text || c.imageUrl || "").join("");
          return { role: "user" as const, content: [{ type: "text", text }] };
        }
        if (m.role === "assistant") {
          // Preserve all content blocks including toolCall, only extract text from text blocks
          if (Array.isArray(m.content)) {
            const transformedContent = m.content.map((c: any) => {
              if (c.type === "text") {
                return c;
              }
              // Preserve toolCall and other block types as-is
              return c;
            });
            return { role: "assistant" as const, content: transformedContent };
          }
          return { role: "assistant" as const, content: [{ type: "text", text: m.content || "" }] };
        }
        if (m.role === "toolResult") {
          // toolResult messages should pass through with their content array
          return m;
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
          // Use file content directly from attachment
          if (attachment.content) {
            messageContent += `\n\n[File: ${attachment.name}]\n${attachment.content}`;
          } else {
            messageContent += `\n\n[File: ${attachment.name}] (no content provided)`;
          }
        }
      }
    }

    // Subscribe to events for streaming
    let currentThinking = "";

    agent.subscribe(async (event: any) => {
      switch (event.type) {
        case "message_start":
          if (event.message?.role === "assistant") {
            res.write(`event: message_start\ndata: ${JSON.stringify({ role: "assistant" })}\n\n`);
          }
          break;
        case "thinking_start":
          currentThinking = "";
          res.write(`event: thinking_start\ndata: ${JSON.stringify({})}\n\n`);
          break;
        case "thinking_delta":
          if (event.delta) {
            currentThinking += event.delta;
            res.write(`event: thinking_update\ndata: ${JSON.stringify({ content: currentThinking })}\n\n`);
          }
          break;
        case "thinking_end":
          res.write(`event: thinking_end\ndata: ${JSON.stringify({ content: currentThinking })}\n\n`);
          currentThinking = "";
          break;
        case "message_update":
          if (event.message?.role === "assistant" && event.message.content) {
            // Extract text content from message, excluding toolCall and other non-text blocks
            const textBlocks = event.message.content
              .filter((c: any) => c.type === "text")
              .map((c: any) => c.text)
              .join("");
            if (textBlocks) {
              res.write(`event: message_update\ndata: ${JSON.stringify({ content: textBlocks })}\n\n`);
            }
          }
          break;
        case "message_end":
          if (event.message?.role === "assistant") {
            res.write(`event: message_end\ndata: ${JSON.stringify({ done: true, session_id: sessionId })}\n\n`);
          }
          break;
        case "tool_execution_start":
          res.write(`event: tool_start\ndata: ${JSON.stringify({ tool: event.toolName, args: event.args })}\n\n`);
          break;
        case "tool_execution_end":
          res.write(`event: tool_end\ndata: ${JSON.stringify({ tool: event.toolName, result: event.result })}\n\n`);
          break;
        case "agent_end":
          // Save session with messages (excluding toolResult to avoid multi-turn errors)
          const messagesWithoutToolResults = (agent.state.messages as any).filter(
            (m: any) => m.role !== "toolResult"
          );

          sessions.set(sessionId, {
            ...session,
            messages: messagesWithoutToolResults,
          });

          console.log(`[Agent] Session ${sessionId} updated with ${messagesWithoutToolResults.length} messages`);

          // Send session_id back to client
          res.write(`event: session_update\ndata: ${JSON.stringify({ session_id: sessionId })}\n\n`);

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
