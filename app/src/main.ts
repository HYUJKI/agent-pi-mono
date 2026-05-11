import "./styles.css";
import hljs from "highlight.js";

// State
interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  attachments?: Attachment[];
  timestamp: number;
}

interface Attachment {
  type: "image" | "file";
  name: string;
  url?: string;
  path?: string;
  content?: string;
}

interface StreamContent {
  type: "text" | "tool" | "image" | "file";
  content: string;
  toolName?: string;
  fileName?: string;
  downloadUrl?: string;
}

let messages: Message[] = [];
let sessionId: string | null = null;
let isLoading = false;
let currentStreamContent: StreamContent[] = [];

// DOM Elements cache
let chatArea: HTMLElement;
let inputArea: HTMLElement;
let messageInput: HTMLTextAreaElement;
let fileInput: HTMLInputElement;
let imageInput: HTMLInputElement;
let attachmentsPreview: HTMLElement;
let statusDot: HTMLElement;
let stopBtn: HTMLButtonElement;

// Pending attachments
let pendingAttachments: Attachment[] = [];

// Abort controller for canceling requests
let currentController: AbortController | null = null;

// Initialize
function init() {
  loadSession();     // Load session BEFORE render to restore history
  renderApp();
  setupEventListeners();
}

// Render main app
function renderApp() {
  const app = document.getElementById("app");
  if (!app) return;

  app.innerHTML = `
    <div class="app-container">
      <!-- Header -->
      <header class="header">
        <div class="header-title">
          <div class="header-icon">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
            </svg>
          </div>
          <div class="header-text">
            <h1>Pi Agent</h1>
            <span>TUI Interface</span>
          </div>
        </div>
        <div class="header-actions">
          <button class="header-btn" id="clearBtn">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            </svg>
            Clear
          </button>
          <button class="header-btn primary" id="newChatBtn">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="12" y1="5" x2="12" y2="19"></line>
              <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
            New Chat
          </button>
        </div>
      </header>

      <!-- Status Bar -->
      <div class="status-bar">
        <div class="status-left">
          <div class="status-item">
            <span class="status-dot ${isLoading ? 'warning' : ''}" id="statusDot"></span>
            <span>${isLoading ? 'Processing...' : 'Ready'}</span>
          </div>
          ${
            isLoading
              ? `
          <button class="stop-btn" id="stopBtn">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
              <rect x="6" y="6" width="12" height="12" rx="2"/>
            </svg>
            Stop
          </button>
          `
              : ""
          }
          <div class="status-item">
            <span>Session: ${sessionId ? sessionId.substring(0, 8) + '...' : 'None'}</span>
          </div>
        </div>
        <div class="status-right">
          <div class="status-item">
            <span>Messages: ${messages.length}</span>
          </div>
          <div class="status-item">
            <span>Model: MiniMax-M2.7</span>
          </div>
        </div>
      </div>

      <!-- Chat Area -->
      <main class="chat-area" id="chatArea">
        ${
          messages.length === 0
            ? `
          <div class="welcome-screen">
            <div class="welcome-logo">
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
              </svg>
            </div>
            <h2 class="welcome-title">Pi Agent</h2>
            <p class="welcome-subtitle">Terminal-style AI Assistant Interface</p>
            <div class="welcome-commands">
              <div class="welcome-command">
                <span class="welcome-command-prefix">$</span>
                <span class="welcome-command-desc">Read, write, and edit local files</span>
              </div>
              <div class="welcome-command">
                <span class="welcome-command-prefix">$</span>
                <span class="welcome-command-desc">Web search for real-time information</span>
              </div>
              <div class="welcome-command">
                <span class="welcome-command-prefix">$</span>
                <span class="welcome-command-desc">Multi-round context memory</span>
              </div>
              <div class="welcome-command">
                <span class="welcome-command-prefix">$</span>
                <span class="welcome-command-desc">Code highlighting and streaming output</span>
              </div>
            </div>
          </div>
        `
            : `
          <div class="messages-container" id="messagesContainer">
            ${messages.map((m) => renderMessage(m)).join("")}
          </div>
          ${
            isLoading
              ? `
            <div class="loading-indicator">
              <span class="typing-cursor"></span>
              <span>Thinking...</span>
            </div>
          `
              : ""
          }
        `
        }
      </main>

      <!-- Input Area -->
      <footer class="input-area" id="inputArea">
        <div class="input-container">
          <!-- Attachments Preview -->
          <div class="attachments-preview" id="attachmentsPreview"></div>

          <!-- Toolbar -->
          <div class="input-toolbar">
            <label class="input-btn" title="Upload File">
              <input type="file" id="fileInput" multiple hidden />
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                <polyline points="14 2 14 8 20 8"></polyline>
              </svg>
            </label>
            <label class="input-btn" title="Upload Image">
              <input type="file" id="imageInput" accept="image/*" multiple hidden />
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                <circle cx="8.5" cy="8.5" r="1.5"></circle>
                <polyline points="21 15 16 10 5 21"></polyline>
              </svg>
            </label>
          </div>

          <!-- Input Wrapper -->
          <div class="input-wrapper">
            <textarea
              id="messageInput"
              placeholder="Enter your message..."
              rows="1"
              ${isLoading ? "disabled" : ""}
            ></textarea>
            <div class="input-actions">
              <button class="send-btn" id="sendBtn" ${isLoading ? "disabled" : ""}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <line x1="22" y1="2" x2="11" y2="13"></line>
                  <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
                </svg>
              </button>
            </div>
          </div>
        </div>
      </footer>
    </div>
  `;

  // Cache DOM elements
  chatArea = document.getElementById("chatArea")!;
  inputArea = document.getElementById("inputArea")!;
  messageInput = document.getElementById("messageInput") as HTMLTextAreaElement;
  fileInput = document.getElementById("fileInput") as HTMLInputElement;
  imageInput = document.getElementById("imageInput") as HTMLInputElement;
  attachmentsPreview = document.getElementById("attachmentsPreview")!;
  statusDot = document.getElementById("statusDot")!;
  stopBtn = document.getElementById("stopBtn") as HTMLButtonElement;

  // Stop button handler
  if (stopBtn) {
    stopBtn.addEventListener("click", () => {
      if (currentController) {
        currentController.abort();
        console.log("Request aborted by user");
      }
    });
  }

  // Auto-resize textarea
  autoResize(messageInput);

  // Scroll to bottom
  scrollToBottom();
}

// Render a single message
function renderMessage(msg: Message): string {
  const time = new Date(msg.timestamp).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  });

  const avatarIcon = msg.role === "user" ? "U" : "AI";

  const attachmentsHtml =
    msg.attachments && msg.attachments.length > 0
      ? `<div class="message-attachments">
          ${msg.attachments.map((a) => {
            if (a.type === "image") {
              return `<div class="attachment"><img src="${a.url || a.content}" alt="${a.name}" /></div>`;
            } else {
              return `<div class="attachment-file">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                  <polyline points="14 2 14 8 20 8"></polyline>
                </svg>
                ${a.name}
              </div>`;
            }
          }).join("")}
        </div>`
      : "";

  const hasToolContent = currentStreamContent.some((c) => c.type === "tool");

  return `
    <div class="message ${msg.role}">
      <div class="message-avatar">${avatarIcon}</div>
      <div class="message-content-wrapper">
        <div class="message-role">${msg.role === "user" ? "User" : "Assistant"}</div>
        ${attachmentsHtml}
        <div class="message-content ${hasToolContent ? "has-tool" : ""}">${formatContent(msg.content)}</div>
        <div class="message-time">${time}</div>
      </div>
    </div>
  `;
}

// Format message content with code highlighting
function formatContent(content: string): string {
  if (!content) return "";

  // Escape HTML first
  let formatted = escapeHtml(content);

  // Code blocks with highlighting
  formatted = formatted.replace(
    /```(\w+)?\n([\s\S]*?)```/g,
    (_, lang, code) => {
      const language = lang || "plaintext";
      let highlighted: string;
      try {
        highlighted = hljs.highlight(code.trim(), { language }).value;
      } catch {
        highlighted = escapeHtml(code.trim());
      }
      return `
        <div class="code-block">
          <div class="code-header">
            <div class="code-dots">
              <span class="code-dot red"></span>
              <span class="code-dot yellow"></span>
              <span class="code-dot green"></span>
            </div>
            <span class="code-language">${language}</span>
            <button class="code-copy" onclick="copyCode(this)">Copy</button>
          </div>
          <pre><code class="hljs language-${language}">${highlighted}</code></pre>
        </div>
      `;
    }
  );

  // Inline code
  formatted = formatted.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>');

  // Bold
  formatted = formatted.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");

  // Italic
  formatted = formatted.replace(/\*([^*]+)\*/g, "<em>$1</em>");

  // Links
  formatted = formatted.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener">$1</a>'
  );

  // Tool indicators in text
  formatted = formatted.replace(
    /\[(使用工具|Using tool): ([^\]]+)\]/g,
    '<div class="tool-indicator"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"></path></svg> $2</div>'
  );

  // Lists
  formatted = formatted.replace(/^- (.+)$/gm, "<li>$1</li>");
  formatted = formatted.replace(/(<li>.*<\/li>)/s, "<ul>$1</ul>");

  // Line breaks
  formatted = formatted.replace(/\n/g, "<br>");

  // Download links for generated files
  formatted = formatted.replace(
    /\[下载文件: ([^\]]+)\]\(([^)]+)\)/g,
    '<a href="$2" download="$1" class="download-btn">📥 $1</a>'
  );

  // Image display
  formatted = formatted.replace(
    /!\[([^\]]*)\]\(([^)]+)\)/g,
    '<img src="$2" alt="$1" class="message-image" />'
  );

  return formatted;
}

// Escape HTML special characters
function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

// Render streaming content
function renderStreamingContent() {
  const messagesContainer = document.getElementById("messagesContainer");
  if (!messagesContainer) {
    console.log("[DEBUG] messagesContainer not found!");
    return;
  }

  const lastMessage = messagesContainer.querySelector(".message.assistant:last-child");
  if (!lastMessage) {
    console.log("[DEBUG] lastMessage not found!");
    return;
  }

  const contentEl = lastMessage.querySelector(".message-content") as HTMLElement;
  if (!contentEl) return;

  let html = "";
  let hasTool = false;

  for (const item of currentStreamContent) {
    if (item.type === "text") {
      html += formatContent(item.content);
    } else if (item.type === "tool") {
      hasTool = true;
      html += `<div class="tool-indicator">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"></path>
        </svg>
        ${item.toolName}
      </div>`;
    } else if (item.type === "image") {
      html += `<img src="${item.content}" alt="Generated" class="message-image" />`;
    } else if (item.type === "file") {
      html += `<a href="${item.downloadUrl}" download="${item.fileName}" class="download-btn">📥 ${item.fileName}</a>`;
    }
  }

  contentEl.className = `message-content ${hasTool ? "has-tool" : ""}`;
  contentEl.innerHTML = html;

  // Apply syntax highlighting to new code blocks
  contentEl.querySelectorAll("code.hljs").forEach((block) => {
    hljs.highlightElement(block as HTMLElement);
  });

  scrollToBottom();
}

// Update attachments preview
function updateAttachmentsPreview() {
  if (!attachmentsPreview) return;

  if (pendingAttachments.length === 0) {
    attachmentsPreview.innerHTML = "";
    return;
  }

  attachmentsPreview.innerHTML = pendingAttachments
    .map(
      (a, i) => `
    <div class="attachment-item">
      ${
        a.type === "image"
          ? `<img src="${a.content}" alt="${a.name}" />`
          : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
              <polyline points="14 2 14 8 20 8"></polyline>
            </svg>`
      }
      <span>${a.name}</span>
      <button class="attachment-remove" onclick="removeAttachment(${i})">×</button>
    </div>
  `
    )
    .join("");
}

// Remove attachment
(window as any).removeAttachment = (index: number) => {
  pendingAttachments.splice(index, 1);
  updateAttachmentsPreview();
};

// Copy code
(window as any).copyCode = async (btn: HTMLButtonElement) => {
  const code = btn.closest(".code-block")?.querySelector("code")?.textContent;
  if (code) {
    await navigator.clipboard.writeText(code);
    btn.textContent = "Copied!";
    setTimeout(() => (btn.textContent = "Copy"), 2000);
  }
};

// Auto-resize textarea
function autoResize(textarea: HTMLTextAreaElement) {
  textarea.addEventListener("input", () => {
    textarea.style.height = "auto";
    textarea.style.height = Math.min(textarea.scrollHeight, 150) + "px";
  });

  textarea.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });
}

// Setup event listeners
function setupEventListeners() {
  document.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;

    // New chat button
    if (target.closest("#newChatBtn")) {
      newChat();
    }

    // Clear button
    if (target.closest("#clearBtn")) {
      messages = [];
      saveSession();
      renderApp();
    }

    // Send button
    if (target.closest("#sendBtn") && !isLoading) {
      sendMessage();
    }
  });

  // File input
  fileInput?.addEventListener("change", async (e) => {
    const files = (e.target as HTMLInputElement).files;
    if (files) {
      for (const file of Array.from(files)) {
        const content = await file.text();
        pendingAttachments.push({
          type: "file",
          name: file.name,
          content,
        });
      }
      updateAttachmentsPreview();
    }
    fileInput.value = "";
  });

  // Image input
  imageInput?.addEventListener("change", async (e) => {
    const files = (e.target as HTMLInputElement).files;
    if (files) {
      for (const file of Array.from(files)) {
        const reader = new FileReader();
        reader.onload = (e) => {
          pendingAttachments.push({
            type: "image",
            name: file.name,
            content: e.target?.result as string,
          });
          updateAttachmentsPreview();
        };
        reader.readAsDataURL(file);
      }
    }
    imageInput.value = "";
  });
}

// Send message
async function sendMessage() {
  const content = messageInput?.value.trim();
  if (!content && pendingAttachments.length === 0) return;
  if (isLoading) return;

  isLoading = true;
  currentStreamContent = [];

  // Add user message
  const userMessage: Message = {
    id: generateId(),
    role: "user",
    content: content || "",
    attachments: [...pendingAttachments],
    timestamp: Date.now(),
  };
  messages.push(userMessage);

  // Clear input
  if (messageInput) {
    messageInput.value = "";
    messageInput.style.height = "auto";
  }
  pendingAttachments = [];
  updateAttachmentsPreview();

  // Render user message
  renderApp();

  // Add placeholder for assistant
  const assistantMessage: Message = {
    id: generateId(),
    role: "assistant",
    content: "",
    timestamp: Date.now(),
  };
  messages.push(assistantMessage);

  // Re-render to show assistant message placeholder
  renderApp();

  scrollToBottom();

  try {
    // Create abort controller
    currentController = new AbortController();

    // Prepare attachments for API
    const attachments = userMessage.attachments?.map((a) => ({
      type: a.type,
      name: a.name,
      url: a.type === "image" ? a.content : undefined,
      path: a.type === "file" ? a.name : undefined,
    }));

    // Send to API
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content,
        session_id: sessionId,
        attachments,
      }),
      signal: currentController.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP error: ${response.status}`);
    }

    // Handle SSE stream
    const reader = response.body?.getReader();
    const decoder = new TextDecoder();
    let currentEvent = ""; // Track current event type from `event:` lines

    while (reader) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value);
      console.log("SSE chunk:", chunk);
      const lines = chunk.split("\n");

      for (const line of lines) {
        // Capture event type — SSE standard: `event: <type>`
        if (line.startsWith("event:")) {
          currentEvent = line.replace("event:", "").trim();
          continue;
        }

        if (line.startsWith("data:")) {
          const data = line.replace("data:", "").trim();
          if (!data) continue;

          try {
            const parsed = JSON.parse(data);

            switch (currentEvent) {
              // -- Text content streaming --
              case "message_update":
                if (parsed.content) {
                  currentStreamContent = [{ type: "text", content: parsed.content }];
                  const lastAssistant = messages[messages.length - 1];
                  if (lastAssistant && lastAssistant.role === "assistant") {
                    lastAssistant.content = parsed.content;
                  }
                  renderStreamingContent();
                }
                break;

              // -- Message end: capture session_id early if provided --
              case "message_end":
                if (parsed.session_id) {
                  sessionId = parsed.session_id;
                  console.log("[Session] ID captured from message_end:", sessionId);
                  saveSession();
                }
                break;

              // -- Session ID: critical for multi-turn conversation --
              case "session_update":
                if (parsed.session_id) {
                  sessionId = parsed.session_id;
                  console.log("[Session] ID received:", sessionId);
                  saveSession();
                }
                break;

              // -- Agent ended: finalize --
              case "agent_end":
                console.log("[SSE] agent_end received");
                if (sessionId) {
                  saveSession();
                }
                if (messages[messages.length - 1]?.role === "assistant") {
                  const finalContent = currentStreamContent
                    .filter((c) => c.type === "text")
                    .map((c) => c.content)
                    .join("");
                  messages[messages.length - 1].content = finalContent;
                }
                break;

              // -- Tool events --
              case "tool_start":
                currentStreamContent.push({
                  type: "tool",
                  content: "",
                  toolName: parsed.tool,
                });
                renderStreamingContent();
                break;

              case "tool_end":
                // Tool finished, nothing extra needed
                break;

              // -- Other events (message_start, message_end, etc.) --
              default:
                break;
            }
          } catch (e) {
            console.error("[SSE] JSON parse error:", e);
          }
        }
      }
    }
  } catch (error: any) {
    console.error("Send error:", error);
    // Check if aborted
    if (error.name === "AbortError") {
      console.log("Request was aborted");
      // Keep the partial response
      if (messages[messages.length - 1]?.role === "assistant") {
        messages[messages.length - 1].content = currentStreamContent
          .filter((c) => c.type === "text")
          .map((c) => c.content)
          .join("");
      }
    } else {
      // Remove the placeholder assistant message on error
      if (messages.length > 0 && messages[messages.length - 1]?.role === "assistant" && !messages[messages.length - 1]?.content) {
        messages.pop(); // Remove empty placeholder
      }
      // Show error as a new assistant message
      messages.push({
        id: generateId(),
        role: "assistant",
        content: `Error: ${error.message}`,
        timestamp: Date.now(),
      });
    }
  }

  currentController = null;
  isLoading = false;
  renderApp();
  saveSession();
}

// New chat
function newChat() {
  messages = [];
  sessionId = null;
  pendingAttachments = [];
  currentStreamContent = [];
  localStorage.removeItem("pimono_session");
  localStorage.removeItem("pimono_messages");
  renderApp();
}

// Save session
function saveSession() {
  if (sessionId) {
    localStorage.setItem("pimono_session", sessionId);
  }
  localStorage.setItem("pimono_messages", JSON.stringify(messages));
}

// Load session
function loadSession() {
  const savedSession = localStorage.getItem("pimono_session");
  const savedMessages = localStorage.getItem("pimono_messages");

  if (savedMessages) {
    try {
      messages = JSON.parse(savedMessages);
    } catch {
      messages = [];
    }
  }

  sessionId = savedSession;
}

// Scroll to bottom
function scrollToBottom() {
  if (chatArea) {
    chatArea.scrollTop = chatArea.scrollHeight;
  }
}

// Generate unique ID
function generateId(): string {
  return Math.random().toString(36).substring(2, 15);
}

// Start app
init();
