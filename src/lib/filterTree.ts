import type { TreeNode } from "../hooks/useWorkspaceTree";

/** Minúsculas e sem acentos ("Precificação" → "precificacao"). */
export function normalize(s: string) {
  return s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

/**
 * Filtra a árvore pelo nome:
 * - item cujo nome bate aparece (pasta aparece com todo o conteúdo);
 * - pasta que só contém itens que batem aparece aberta, com os filhos filtrados.
 * Não altera a árvore original.
 */
export function filterTree(nodes: TreeNode[], query: string): TreeNode[] {
  const q = normalize(query.trim());
  if (!q) return nodes;

  const walk = (list: TreeNode[]): TreeNode[] =>
    list.flatMap((n): TreeNode[] => {
      if (normalize(n.name).includes(q)) return [n];
      if (n.kind === "folder") {
        const children = walk(n.children);
        if (children.length > 0) return [{ ...n, expanded: true, children }];
      }
      return [];
    });

  return walk(nodes);
}
