import { useCallback, useEffect, useRef, useState } from "react";
import { api, type SpacesInfo } from "../lib/api";

/**
 * Espaços de trabalho (ex.: Trabalho, Pessoal).
 * @param rootVersion muda quando o diretório raiz é trocado → recarrega a lista.
 */
export function useSpaces(rootVersion: number, onError: (msg: string) => void) {
  const [spaces, setSpaces] = useState<string[]>([]);
  const [current, setCurrent] = useState<string | null>(null);

  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const apply = (info: SpacesInfo) => {
    setSpaces(info.spaces);
    setCurrent(info.current);
  };

  /** Executa a chamada; em caso de erro, avisa e devolve undefined. */
  const attempt = useCallback(async <T,>(call: Promise<T>): Promise<T | undefined> => {
    try {
      return await call;
    } catch (e) {
      onErrorRef.current(String(e));
      return undefined;
    }
  }, []);

  useEffect(() => {
    let alive = true;
    attempt(api.listSpaces()).then((info) => alive && info && apply(info));
    return () => {
      alive = false;
    };
  }, [rootVersion, attempt]);

  const select = useCallback(
    (name: string) => {
      setCurrent(name);
      void attempt(api.selectSpace(name));
    },
    [attempt],
  );

  /** Cria e seleciona o espaço. Devolve true se deu certo. */
  const create = useCallback(
    async (name: string) => {
      const info = await attempt(api.createSpace(name));
      if (info) apply(info);
      return !!info;
    },
    [attempt],
  );

  /** Renomeia o espaço. Devolve true se deu certo. */
  const rename = useCallback(
    async (oldName: string, newName: string) => {
      const info = await attempt(api.renameSpace(oldName, newName));
      if (info) apply(info);
      return !!info;
    },
    [attempt],
  );

  /** Move o espaço para a Lixeira. */
  const remove = useCallback(
    async (name: string) => {
      const info = await attempt(api.deleteSpace(name));
      if (info) apply(info);
    },
    [attempt],
  );

  return { spaces, current, select, create, rename, remove };
}
