import ReactDOM from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import "@fontsource-variable/outfit";
import "@fontsource-variable/jetbrains-mono";
import "./styles/neu.css";
import "./styles/markdown.css";
import "./styles/peek.css";
import App from "./App";
import PeekApp from "./peek/PeekApp";
import { PEEK_LABEL } from "./peek/protocol";

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root");

// 同一份页面同时用于主窗口和悬浮层，按窗口 label 区分
const isPeek = getCurrentWindow().label === PEEK_LABEL;
if (isPeek) document.documentElement.classList.add("peek-root");

ReactDOM.createRoot(root).render(isPeek ? <PeekApp /> : <App />);
