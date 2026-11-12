import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

// Desabilita o menu de contexto nativo (clique direito → Inspecionar).
// Fase de captura na window: roda antes de tudo, então nenhum stopPropagation
// dos componentes (ex.: menus de contexto próprios) consegue impedir o bloqueio.
window.addEventListener("contextmenu", (e) => e.preventDefault(), { capture: true });

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
