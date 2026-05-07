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
			systemPrompt: "You are a helpful AI assistant. Respond clearly and concisely.",
			model: createModel(),
			thinkingLevel: "off",
			messages: [],
			tools: [],
		},
		convertToLlm: (agentMessages) => {
			return agentMessages.flatMap((m: any) => {
				if (m.role === "user" || m.role === "user-with-attachments") {
					const content = typeof m.content === "string" ? m.content : m.content?.[0]?.text || "";
					return [{ role: "user", content }];
				}
				if (m.role === "assistant") {
					// Handle various content formats
					let text = "";
					if (!m.content) {
						text = "";
					} else if (typeof m.content === "string") {
						text = m.content;
					} else if (Array.isArray(m.content)) {
						text = m.content.map((block: any) => block.text || block.thinking || "").join("");
					} else if (typeof m.content === "object" && m.content.text) {
						text = m.content.text;
					}
					return [{ role: "assistant", content: text }];
				}
				return [];
			});
		},
	});
	console.log("Agent initialized successfully");

	agent.subscribe((event: any) => {
		if (event.type === "agent_start") {
			console.log("agent_start");
		}
		if (event.type === "agent_end") {
			console.log("agent_end");
		}
		if (event.type === "message_start") {
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
	messages.push({ role: "user", content });
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