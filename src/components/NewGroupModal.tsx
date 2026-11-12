export function NewGroupModal({ onClose, closing }: { onClose: () => void; closing: boolean }) {
  return (
    <div className={`st-overlay${closing ? " closing" : ""}`}>
      <div className="ng-modal">
        <header className="ng-header">
          <button className="ng-action" onClick={onClose}>
            Cancelar
          </button>
          <h2>Novo grupo</h2>
          <button className="ng-action" onClick={onClose}>
            Criar
          </button>
        </header>
        <div className="ng-body">
          <label className="ng-label" htmlFor="ng-name">
            Nome do grupo
          </label>
          <input id="ng-name" className="ng-input" defaultValue="Novo grupo" autoFocus />
        </div>
      </div>
    </div>
  );
}
