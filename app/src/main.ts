import { Agent } from "@mariozechner/pi-agent-core";
import { getModel } from "@mariozechner/pi-ai";
import "./styles.css";

// Get base URL - use proxy to avoid CORS
const API_BASE_URL = "http://localhost:3002"; // Local proxy

// Get API key from user or environment
const API_KEY = localStorage.getItem("anthropic-api-key") || prompt("Enter Minimax API Token:");
if (API_KEY) {
	localStorage.setItem("anthropic-api-key", API_KEY);
}

// State
let agent: Agent;
let messages: Array<{ role: string; content: string }> = [];
let isLoading = false;
let streamingContent = "";
let currentAssistantIndex = -1; // Track current assistant message index
let pendingMessageEnd = false; // Track if we've received message_start but not yet message_end

// Get model with custom baseUrl for proxy
function createModel() {
	const baseModel = getModel("minimax-cn", "MiniMax-M2.7" as any);
	return {
		...baseModel,
		baseUrl: API_BASE_URL,
	};
}

// Initialize agent
function initAgent() {
	agent = new Agent({
		getApiKey: () => API_KEY,
		initialState: {
			systemPrompt: `You are a helpful AI assistant. Follow these rules strictly:

1. The conversation history (user/assistant messages) is ONLY for context - it helps you understand the background and follow the conversation flow.

2. You must ONLY respond to the LAST user message in the conversation. Do NOT repeat or answer any previous user questions.

3. Do not restate or summarize previous questions or answers. Focus only on the latest user question.

4. Ignore any user messages that appear before the final user message - they are only for context.

5. Your response should address the latest questions based on conversation history.

Example:
- If history has: "What is AI?" followed by "Tell me about ML", you should answer "Tell me about ML" based on conversation history`,
			model: createModel(),
			thinkingLevel: "off",
			messages: [],
			tools: [],
		},
		convertToLlm: (agentMessages) => {
			// Debug: log what we received
			console.log("convertToLlm called, agentMessages count:", agentMessages.length);
			for (const m of agentMessages) {
				const contentPreview = Array.isArray(m.content)
					? m.content.map((c: any) => c.text || c.thinking || String(c)).join("")
					: typeof m.content === "string" ? m.content : JSON.stringify(m.content);
				console.log("  - role:", m.role, "content:", contentPreview.substring(0, 80));
			}

			// Messages must strictly alternate: user → assistant → user → assistant → user
			const MAX_CONTEXT = 30;
			const recentMessages = agentMessages.slice(-MAX_CONTEXT);

			// Helper to extract text from content (which can be string, array of blocks, or object)
			function extractText(content: any): string {
				if (!content) return "";
				if (typeof content === "string") return content;
				if (Array.isArray(content)) {
					return content.map((block: any) => {
						if (typeof block === "string") return block;
						return block.text || block.thinking || "";
					}).join("");
				}
				if (typeof content === "object") {
					return content.text || JSON.stringify(content);
				}
				return String(content);
			}

			// Convert to the format we need
			const converted = recentMessages.map((m: any) => {
				if (m.role === "user" || m.role === "user-with-attachments") {
					const content = extractText(m.content);
					return { role: "user" as const, content };
				}
				if (m.role === "assistant") {
					const content = extractText(m.content);
					return { role: "assistant" as const, content };
				}
				return null;
			}).filter(Boolean);

			// Ensure strict alternation
			const result: Array<{ role: string; content: string }> = [];

			// Find the last user message (current question)
			let lastUserIdx = -1;
			for (let i = converted.length - 1; i >= 0; i--) {
				if (converted[i].role === "user") {
					lastUserIdx = i;
					break;
				}
			}

			if (lastUserIdx === -1) {
				return [];
			}

			// If this is the first message (no history), just return it
			if (lastUserIdx === 0) {
				result.push(converted[0]);
				return result;
			}

			// Only keep the IMMEDIATE previous pair (one user + one assistant) as brief context
			// Skip older history to avoid repetition and token bloat
			const immediateContextStart = Math.max(0, lastUserIdx - 2);

			result.push({
				role: "system",
				content: "[Previous context for reference only]"
			});

			// Only add the most recent exchange as context
			for (let i = immediateContextStart; i < lastUserIdx; i++) {
				result.push(converted[i]);
			}

			result.push(converted[lastUserIdx]);

			// Debug: log the final result
			console.log("convertToLlm result:");
			for (const r of result) {
				console.log("  - role:", r.role, "content length:", r.content.length, "preview:", r.content.substring(0, 50));
			}

			return result;
		},
	});
	console.log("Agent initialized successfully");

	agent.subscribe((event: any) => {
		if (event.type === "message_start") {
			if (event.message?.role === "user") {
				// User message started - add it to UI immediately
				messages.push({ role: "user", content: event.message.content?.[0]?.text || "" });
			}
			if (event.message?.role === "assistant") {
				streamingContent = "";
				currentAssistantIndex = -1;
				pendingMessageEnd = false;
			}
		}
		if (event.type === "message_update") {
			const msg = event.message;
			let text = "";
			if (msg.content && Array.isArray(msg.content)) {
				for (const block of msg.content) {
					if (block.type === "text" && block.text) {
						text += block.text;
					}
				}
			}

			if (text.length > 0 && msg?.role === "assistant") {
				if (currentAssistantIndex === -1) {
					messages.push({ role: "assistant", content: text });
					currentAssistantIndex = messages.length - 1;
				} else {
					messages[currentAssistantIndex].content = text;
				}
			}
			renderUI();
		}
		if (event.type === "message_end") {
			if (event.message?.role === "assistant") {
				if (!pendingMessageEnd) {
					isLoading = false;
					streamingContent = "";
					currentAssistantIndex = -1;
					pendingMessageEnd = true;
					renderUI();
				}
			}
		}
	});
}

// Send message
async function sendMessage(content: string) {
	if (!agent || isLoading) return;

	isLoading = true;
	pendingMessageEnd = false;
	renderUI();

	try {
		await agent.prompt(content);
	} catch (err) {
		isLoading = false;
		pendingMessageEnd = true;
		messages.push({ role: "assistant", content: `Error: ${err}` });
		renderUI();
	}
}

// Render UI
function renderUI() {
	const app = document.getElementById("app");
	if (!app) return;

	app.innerHTML = `
		<div class="chat-container">
			<div class="header">
				<h1>Pi Agent</h1>
				<p class="subtitle">Simple AI Chat</p>
			</div>
			<div class="messages">
				${messages.map((m) => `
					<div class="message ${m.role}">
						<div class="message-role">${m.role === "user" ? "You" : "Assistant"}</div>
						<div class="message-content">${escapeHtml(m.content)}</div>
					</div>
				`).join("")}
			</div>
			<div class="input-area">
				<form id="input-form">
					<input type="text" id="message-input" placeholder="Type a message..." ${isLoading ? "disabled" : ""} />
					<button type="submit" ${isLoading ? "disabled" : ""}>Send</button>
				</form>
			</div>
		</div>
	`;

	document.getElementById("input-form")?.addEventListener("submit", async (e) => {
		e.preventDefault();
		const input = document.getElementById("message-input") as HTMLInputElement;
		if (input?.value.trim()) {
			await sendMessage(input.value.trim());
			input.value = "";
		}
	});
}

function escapeHtml(text: string): string {
	const div = document.createElement("div");
	div.textContent = text;
	return div.innerHTML;
}

// Start
if (!API_KEY) {
	document.getElementById("app")!.innerHTML = '<p style="color:red">API key required. Please refresh and enter a key.</p>';
} else {
	initAgent();
	renderUI();
}