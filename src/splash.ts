// Splash screen: janela pequena mostrada enquanto a janela principal carrega.
// A janela principal manda o status pelo evento "splash-status" (via comando splash_status)
// e fecha esta janela com splash_done.
import { getVersion } from "@tauri-apps/api/app";
import { listen } from "@tauri-apps/api/event";
import logo from "../src-tauri/app-icon.png";
import "./splash.css";

window.addEventListener("contextmenu", (e) => e.preventDefault(), { capture: true });

(document.getElementById("logo") as HTMLImageElement).src = logo;

const version = document.getElementById("version")!;
getVersion()
  .then((v) => (version.textContent = `v${v}`))
  .catch(() => {});

const status = document.getElementById("status")!;
void listen<string>("splash-status", (e) => {
  status.textContent = e.payload;
});
