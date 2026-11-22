import ReactDOM from "react-dom/client";
import "@fontsource-variable/outfit";
import "@fontsource-variable/jetbrains-mono";
import "./styles/neu.css";
import "./styles/markdown.css";
import App from "./App";

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root");

ReactDOM.createRoot(root).render(<App />);
