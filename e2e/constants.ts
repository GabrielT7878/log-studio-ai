/**
 * Porta CDP do WebView2 do app de testes (diferente da 9222 usada em depuração manual).
 * Precisa ser a mesma de `additionalBrowserArgs` em src-tauri/tauri.e2e.conf.json.
 */
export const CDP_PORT = 9333;
export const CDP_URL = `http://127.0.0.1:${CDP_PORT}`;
