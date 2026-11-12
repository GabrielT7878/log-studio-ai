import { Trash2 } from "lucide-react";
import { createPortal } from "react-dom";

/**
 * Confirmação de exclusão. Padrão: mover algo (pasta, projeto, espaço) para a Lixeira;
 * `title`/`message`/`confirmLabel` trocam os textos (ex.: excluir janelas do canvas).
 */
export function ConfirmDeleteModal({
  name,
  detail,
  title,
  message,
  confirmLabel = "Mover para a Lixeira",
  closing,
  onCancel,
  onConfirm,
}: {
  name: string;
  detail: string;
  title?: string;
  message?: string;
  confirmLabel?: string;
  closing: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return createPortal(
    <div
      className={`st-overlay${closing ? " closing" : ""}`}
      onKeyDown={(e) => e.key === "Escape" && onCancel()}
    >
      <div className="ng-modal cf-modal" role="alertdialog" aria-labelledby="cf-title">
        <div className="cf-body">
          <div className="cf-icon">
            <Trash2 size={20} />
          </div>
          <h2 id="cf-title">{title ?? `Mover “${name}” para a Lixeira?`}</h2>
          <p>{message ?? `${detail} Dá para restaurar pela Lixeira.`}</p>
        </div>
        <div className="cf-actions">
          <button className="cf-btn" onClick={onCancel} autoFocus>
            Cancelar
          </button>
          <button className="cf-btn danger" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
