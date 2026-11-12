import { useState } from "react";
import { createPortal } from "react-dom";

/**
 * Modal com um campo de nome (ex.: novo espaço, renomear espaço).
 * `onConfirm` devolve true para fechar; false mantém aberto (ex.: nome inválido).
 */
export function NameModal({
  title,
  label,
  initialValue,
  confirmLabel,
  closing,
  onCancel,
  onConfirm,
}: {
  title: string;
  label: string;
  initialValue: string;
  confirmLabel: string;
  closing: boolean;
  onCancel: () => void;
  onConfirm: (name: string) => Promise<void> | void;
}) {
  const [value, setValue] = useState(initialValue);
  const [busy, setBusy] = useState(false);
  const canSubmit = value.trim() !== "" && !busy;

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    try {
      await onConfirm(value.trim());
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div className={`st-overlay${closing ? " closing" : ""}`}>
      <div className="ng-modal" role="dialog" aria-labelledby="name-modal-title">
        <header className="ng-header">
          <button className="ng-action" onClick={onCancel}>
            Cancelar
          </button>
          <h2 id="name-modal-title">{title}</h2>
          <button className="ng-action" onClick={submit} disabled={!canSubmit}>
            {confirmLabel}
          </button>
        </header>
        <div className="ng-body">
          <label className="ng-label" htmlFor="name-modal-input">
            {label}
          </label>
          <input
            id="name-modal-input"
            className="ng-input"
            value={value}
            spellCheck={false}
            autoFocus
            onFocus={(e) => e.currentTarget.select()}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void submit();
              else if (e.key === "Escape") onCancel();
            }}
          />
        </div>
      </div>
    </div>,
    document.body,
  );
}
