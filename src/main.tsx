import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import { echoMicrophoneService } from "./echo/microphoneService";
import { createWebMicrophonePlatformAdapter } from "./platform/webMicrophoneAdapter";

echoMicrophoneService.configurePlatformAdapter(
  createWebMicrophonePlatformAdapter(),
);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
