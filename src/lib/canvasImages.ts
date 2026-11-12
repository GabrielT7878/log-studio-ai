// Carregamento das imagens do canvas (lidas do disco pelo backend → URL de blob, com cache).
import { api } from "./api";

const cache = new Map<string, Promise<string>>();

/** URL exibível de uma imagem do projeto (cacheada por espaço/projeto/arquivo). */
export function imageUrl(space: string, projectId: string, file: string): Promise<string> {
  const key = `${space}\n${projectId}\n${file}`;
  let url = cache.get(key);
  if (!url) {
    url = api
      .readCanvasImage(space, projectId, file)
      .then((buf) => URL.createObjectURL(new Blob([buf])));
    url.catch(() => cache.delete(key)); // falhou: tenta de novo na próxima vez
    cache.set(key, url);
  }
  return url;
}

/** Tamanho natural (px) de uma imagem. */
export function imageSize(url: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth || 1, h: img.naturalHeight || 1 });
    img.onerror = () => reject(new Error("Não foi possível abrir a imagem."));
    img.src = url;
  });
}
