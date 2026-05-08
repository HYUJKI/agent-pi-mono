import { AgentTool } from "@mariozechner/pi-agent-core";
import { Type } from "@mariozechner/pi-ai";
import fs from "fs/promises";
import path from "path";

const WORKING_DIR = process.cwd();

// List files in directory
export const listFilesTool: AgentTool = {
  name: "list_files",
  description: "List files and directories in a given path. Use '.' for current directory.",
  parameters: Type.Object({
    path: Type.Optional(Type.String()),
  }),
  async execute(toolCallId, params) {
    try {
      const targetPath = params.path || ".";
      const fullPath = path.resolve(WORKING_DIR, targetPath);

      const entries = await fs.readdir(fullPath, { withFileTypes: true });
      const files = entries.map((entry) => ({
        name: entry.name,
        type: entry.isDirectory() ? "directory" : "file",
        path: path.relative(WORKING_DIR, path.join(fullPath, entry.name)),
      }));

      return {
        content: [
          {
            type: "text" as const,
            text: `Files in ${targetPath}:\n${files.map((f) => `${f.type === "directory" ? "📁" : "📄"} ${f.name}${f.type === "directory" ? "/" : ""}`).join("\n")}`,
          },
        ],
        details: { files },
      };
    } catch (error: any) {
      return {
        content: [{ type: "text" as const, text: `Error listing files: ${error.message}` }],
        details: { error: true },
      };
    }
  },
};

// Read file content
export const readFileTool: AgentTool = {
  name: "read_file",
  description: "Read the content of a file. Supports text files.",
  parameters: Type.Object({
    path: Type.String(),
  }),
  async execute(toolCallId, params) {
    try {
      const fullPath = path.resolve(WORKING_DIR, params.path);
      const stat = await fs.stat(fullPath);

      if (stat.isDirectory()) {
        return {
          content: [{ type: "text" as const, text: `${params.path} is a directory, not a file.` }],
          details: { error: true },
        };
      }

      const content = await fs.readFile(fullPath, "utf-8");
      const lines = content.split("\n").length;

      return {
        content: [
          {
            type: "text" as const,
            text: `File: ${params.path}\nLines: ${lines}\n\n${content}`,
          },
        ],
        details: { path: params.path, lines },
      };
    } catch (error: any) {
      return {
        content: [{ type: "text" as const, text: `Error reading file: ${error.message}` }],
        details: { error: true },
      };
    }
  },
};

// Write file content
export const writeFileTool: AgentTool = {
  name: "write_file",
  description: "Create or overwrite a file with content.",
  parameters: Type.Object({
    path: Type.String(),
    content: Type.String(),
  }),
  async execute(toolCallId, params) {
    try {
      const fullPath = path.resolve(WORKING_DIR, params.path);
      const dir = path.dirname(fullPath);

      // Ensure directory exists
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(fullPath, params.content, "utf-8");

      return {
        content: [
          {
            type: "text" as const,
            text: `File written successfully: ${params.path}`,
          },
        ],
        details: { path: params.path, bytes: Buffer.byteLength(params.content, "utf-8") },
      };
    } catch (error: any) {
      return {
        content: [{ type: "text" as const, text: `Error writing file: ${error.message}` }],
        details: { error: true },
      };
    }
  },
};

// Edit file content (replace text)
export const editFileTool: AgentTool = {
  name: "edit_file",
  description: "Edit a file by replacing specific text. Provide the old text and new text.",
  parameters: Type.Object({
    path: Type.String(),
    old_text: Type.String(),
    new_text: Type.String(),
  }),
  async execute(toolCallId, params) {
    try {
      const fullPath = path.resolve(WORKING_DIR, params.path);
      const content = await fs.readFile(fullPath, "utf-8");

      if (!content.includes(params.old_text)) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: Text to replace not found in file. Please check the file content first.`,
            },
          ],
          details: { error: true },
        };
      }

      const newContent = content.replace(params.old_text, params.new_text);
      await fs.writeFile(fullPath, newContent, "utf-8");

      return {
        content: [
          {
            type: "text" as const,
            text: `File edited successfully: ${params.path}`,
          },
        ],
        details: { path: params.path },
      };
    } catch (error: any) {
      return {
        content: [{ type: "text" as const, text: `Error editing file: ${error.message}` }],
        details: { error: true },
      };
    }
  },
};

// View file info
export const viewFileTool: AgentTool = {
  name: "view_file",
  description: "View detailed information about a file including size, modified date, etc.",
  parameters: Type.Object({
    path: Type.String(),
  }),
  async execute(toolCallId, params) {
    try {
      const fullPath = path.resolve(WORKING_DIR, params.path);
      const stat = await fs.stat(fullPath);

      const info = {
        path: params.path,
        size: formatBytes(stat.size),
        sizeBytes: stat.size,
        created: stat.birthtime.toISOString(),
        modified: stat.mtime.toISOString(),
        isDirectory: stat.isDirectory(),
        isFile: stat.isFile(),
      };

      return {
        content: [
          {
            type: "text" as const,
            text: `File: ${info.path}\nSize: ${info.size}\nCreated: ${info.created}\nModified: ${info.modified}`,
          },
        ],
        details: info,
      };
    } catch (error: any) {
      return {
        content: [{ type: "text" as const, text: `Error viewing file: ${error.message}` }],
        details: { error: true },
      };
    }
  },
};

// Create directory
export const createDirectoryTool: AgentTool = {
  name: "create_directory",
  description: "Create a new directory. Creates parent directories if they don't exist.",
  parameters: Type.Object({
    path: Type.String(),
  }),
  async execute(toolCallId, params) {
    try {
      const fullPath = path.resolve(WORKING_DIR, params.path);
      await fs.mkdir(fullPath, { recursive: true });

      return {
        content: [
          {
            type: "text" as const,
            text: `Directory created: ${params.path}`,
          },
        ],
        details: { path: params.path },
      };
    } catch (error: any) {
      return {
        content: [{ type: "text" as const, text: `Error creating directory: ${error.message}` }],
        details: { error: true },
      };
    }
  },
};

// Delete file
export const deleteFileTool: AgentTool = {
  name: "delete_file",
  description: "Delete a file. Cannot delete directories.",
  parameters: Type.Object({
    path: Type.String(),
  }),
  async execute(toolCallId, params) {
    try {
      const fullPath = path.resolve(WORKING_DIR, params.path);
      const stat = await fs.stat(fullPath);

      if (stat.isDirectory()) {
        return {
          content: [{ type: "text" as const, text: "Cannot delete a directory with this tool. Use a different method." }],
          details: { error: true },
        };
      }

      await fs.unlink(fullPath);

      return {
        content: [
          {
            type: "text" as const,
            text: `File deleted: ${params.path}`,
          },
        ],
        details: { path: params.path },
      };
    } catch (error: any) {
      return {
        content: [{ type: "text" as const, text: `Error deleting file: ${error.message}` }],
        details: { error: true },
      };
    }
  },
};

// Export all file tools
export const fileTools: AgentTool[] = [
  listFilesTool,
  readFileTool,
  writeFileTool,
  editFileTool,
  viewFileTool,
  createDirectoryTool,
  deleteFileTool,
];

// Helper function
function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}
