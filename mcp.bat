@echo off
rem MCP server for AI clients (stdio). Do not print anything else here: stdout is the MCP channel.
cd /d "%~dp0"
node node_modules\tsx\dist\cli.mjs src\server\mcp.ts
