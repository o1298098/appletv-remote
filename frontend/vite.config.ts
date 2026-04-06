import path from "path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import type { IncomingMessage, ServerResponse } from "node:http"
import type { Socket } from "node:net"

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    host: true,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8765",
        changeOrigin: true,
        ws: true,
        configure: (proxy) => {
          proxy.on("error", (_err, _req, res) => {
            const serverRes = res as ServerResponse | Socket | undefined
            // Keep Vite alive when backend is restarting/refusing connections.
            if (serverRes && "writeHead" in serverRes && !serverRes.headersSent) {
              serverRes.writeHead(502, { "Content-Type": "text/plain" })
              serverRes.end("Backend unavailable")
            }
          })

          proxy.on("proxyReqWs", (_proxyReq, req, socket) => {
            const wsSocket = socket as Socket
            const request = req as IncomingMessage
            const closeSilently = () => {
              if (!wsSocket.destroyed) wsSocket.destroy()
            }
            wsSocket.on("error", closeSilently)
            request.on("aborted", closeSilently)
          })
        },
      },
    },
  },
})
