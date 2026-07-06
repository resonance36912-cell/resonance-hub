import { defineMcp } from "@lovable.dev/mcp-js";
import echoTool from "./tools/echo";
import listUpdatesTool from "./tools/list-updates";

export default defineMcp({
  name: "reson8-hub-mcp",
  title: "Reson8 Hub MCP",
  version: "0.1.0",
  instructions:
    "Tools for the Reson8 hub. Use `echo` to verify connectivity and `list_updates` to fetch recent Reson8 project updates.",
  tools: [echoTool, listUpdatesTool],
});
