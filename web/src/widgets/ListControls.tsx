import { Search } from "lucide-react";
import { Input } from "../shared/ui/input";
import { Button } from "../shared/ui/button";

interface SearchFieldProps {
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
}

export function SearchField({ value, placeholder, onChange }: SearchFieldProps) {
  return (
    <label className="list-search">
      <Search size={16} />
      <Input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
      />
    </label>
  );
}

interface PaginationBarProps {
  page: number;
  pageCount: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
}

export function PaginationBar({
  page,
  pageCount,
  pageSize,
  total,
  onPageChange
}: PaginationBarProps) {
  if (total === 0 || pageCount <= 1) return null;
  const start = (page - 1) * pageSize + 1;
  const end = Math.min(total, page * pageSize);

  return (
    <div className="list-footer">
      <span className="muted">
        {start}-{end} из {total}
      </span>
      <div className="pager">
        <Button
          type="button"
          variant="outline"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          Назад
        </Button>
        <span className="muted">
          {page} / {pageCount}
        </span>
        <Button
          type="button"
          variant="outline"
          disabled={page >= pageCount}
          onClick={() => onPageChange(page + 1)}
        >
          Далее
        </Button>
      </div>
    </div>
  );
}
