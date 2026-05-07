import { defineConfig } from "vite";

export default defineConfig({
	root: ".",
	server: {
		port: 3000,
		proxy: {
			"/anthropic": {
				target: "https://api.minimaxi.com/anthropic",
				changeOrigin: true,
				rewrite: (path) => path.replace(/^\/anthropic/, ""),
			},
		},
	},
});