import { ChevronRight } from "lucide-react";
import { accountFolderPath, type AccountFolder } from "../shared/lib/accountFolders";
import { Button } from "../shared/ui/button";
import { OrganizationUnitIcon } from "./OrganizationUnitIcon";

export function AccountFolderBrowser({
  folders,
  selectedId,
  visibleIds,
  onNavigate
}: {
  folders: AccountFolder[];
  selectedId: string;
  visibleIds: Set<string>;
  onNavigate: (id: string) => void;
}) {
  const path = accountFolderPath(folders, selectedId);
  const selected = path.at(-1);
  const children = folders.filter((folder) => folder.parentId === (selected?.id ?? ""));
  return (
    <div className="account-folders">
      <nav className="account-folders__path" aria-label="Папки учётных записей">
        <Button
          variant="ghost"
          onClick={() => onNavigate("")}
          aria-current={!selected ? "page" : undefined}
        >
          Все учётные записи
        </Button>
        {path.map((folder) => (
          <span key={folder.id}>
            <ChevronRight size={16} aria-hidden="true" />
            <Button
              variant="ghost"
              onClick={() => onNavigate(folder.id)}
              aria-current={folder.id === selectedId ? "page" : undefined}
            >
              {folder.name}
            </Button>
          </span>
        ))}
      </nav>
      {children.length > 0 && (
        <div className="account-folders__grid" aria-label="Папки">
          {children.map((folder) => (
            <button
              type="button"
              className="account-folder"
              key={folder.id}
              onClick={() => onNavigate(folder.id)}
            >
              <OrganizationUnitIcon icon={folder.icon} size={24} />
              <span className="account-folder__copy">
                <strong>{folder.name}</strong>
                {folder.description && <span className="muted">{folder.description}</span>}
                <span className="muted">
                  Учётных записей:{" "}
                  {[...folder.allPersonIds].filter((id) => visibleIds.has(id)).length}
                </span>
              </span>
              <ChevronRight size={18} aria-hidden="true" />
            </button>
          ))}
        </div>
      )}
      {selected && (
        <h2 className="account-folders__title">
          {selected.name}
          {selected.description && <span className="muted">{selected.description}</span>}
        </h2>
      )}
    </div>
  );
}
