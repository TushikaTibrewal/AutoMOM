import { defineManifest } from "@crxjs/vite-plugin";

// Backend host the extension is allowed to reach (fetch + WebSocket).
// Update if you self-host; the side panel also lets users override the URL.
const BACKEND_HOSTS = [
  "https://automom-backend.onrender.com/*",
  "http://localhost:8000/*",
];

export default defineManifest({
  manifest_version: 3,
  name: "AutoMOM — Live Minutes of Meeting",
  version: "1.0.0",
  description:
    "Capture Google Meet, Zoom and Teams calls and generate live, editable Minutes of Meeting.",
  minimum_chrome_version: "116",
  permissions: ["tabCapture", "offscreen", "sidePanel", "storage", "activeTab", "scripting"],
  host_permissions: BACKEND_HOSTS,
  background: {
    service_worker: "src/background.ts",
    type: "module",
  },
  action: {
    default_title: "AutoMOM",
  },
  side_panel: {
    default_path: "src/sidepanel/index.html",
  },
  content_scripts: [
    {
      matches: [
        "https://meet.google.com/*",
        "https://*.zoom.us/*",
        "https://teams.microsoft.com/*",
        "https://teams.live.com/*",
      ],
      js: ["src/content/index.tsx"],
      run_at: "document_idle",
    },
  ],
  web_accessible_resources: [
    {
      resources: ["src/offscreen.html"],
      matches: ["<all_urls>"],
    },
  ],
});
