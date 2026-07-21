import * as React from "react";
import {
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  ChevronLeft,
  ChevronRight,
  Search,
  Inbox,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ============================================================
// Data Table — Few-Shot Example
// Demonstrates: column hierarchy, sort indicators, pagination,
// responsive collapse, empty state, loading state, search
// ============================================================

// --- Types ---

interface Column<T> {
  key: keyof T & string;
  header: string;
  sortable?: boolean;
  align?: "left" | "center" | "right";
  width?: string;
  render?: (value: T[keyof T], row: T) => React.ReactNode;
  hideOnMobile?: boolean;
}

interface DataTableProps<T extends { id: string | number }> {
  columns: Column<T>[];
  data: T[];
  loading?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  searchable?: boolean;
  searchPlaceholder?: string;
  pageSize?: number;
}

// --- Sort Hook ---

type SortDirection = "asc" | "desc" | null;

function useSortableData<T>(data: T[]) {
  const [sortKey, setSortKey] = React.useState<keyof T | null>(null);
  const [sortDir, setSortDir] = React.useState<SortDirection>(null);

  const sorted = React.useMemo(() => {
    if (!sortKey || !sortDir) return data;
    return [...data].sort((a, b) => {
      const aVal = a[sortKey];
      const bVal = b[sortKey];
      if (aVal < bVal) return sortDir === "asc" ? -1 : 1;
      if (aVal > bVal) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
  }, [data, sortKey, sortDir]);

  const toggleSort = (key: keyof T) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : d === "desc" ? null : "asc"));
      if (sortDir === "desc") setSortKey(null);
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  return { sorted, sortKey, sortDir, toggleSort };
}

// --- Main Component ---

function DataTable<T extends { id: string | number }>({
  columns,
  data,
  loading = false,
  emptyTitle = "No results found",
  emptyDescription = "Try adjusting your search or filters.",
  searchable = false,
  searchPlaceholder = "Search...",
  pageSize = 10,
}: DataTableProps<T>) {
  const [search, setSearch] = React.useState("");
  const [page, setPage] = React.useState(0);

  // Filter by search
  const filtered = React.useMemo(() => {
    if (!search.trim()) return data;
    const term = search.toLowerCase();
    return data.filter((row) =>
      columns.some((col) => {
        const val = row[col.key];
        return val != null && String(val).toLowerCase().includes(term);
      })
    );
  }, [data, search, columns]);

  const { sorted, sortKey, sortDir, toggleSort } = useSortableData(filtered);

  // Pagination
  const totalPages = Math.ceil(sorted.length / pageSize);
  const pageData = sorted.slice(page * pageSize, (page + 1) * pageSize);

  // Reset page when search changes
  React.useEffect(() => setPage(0), [search]);

  return (
    <div className="space-y-4">
      {/* Search bar */}
      {searchable && (
        <div className="relative">
          <Search
            className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400"
            aria-hidden="true"
          />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={searchPlaceholder}
            className={cn(
              "w-full pl-10 pr-4 py-2 min-h-[44px] rounded-lg",
              "border border-slate-200 bg-white",
              "text-sm text-slate-900 placeholder:text-slate-400",
              "focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500",
              "transition-colors duration-150"
            )}
            aria-label={searchPlaceholder}
          />
        </div>
      )}

      {/* Table */}
      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm" role="grid">
            {/* Header — SECONDARY hierarchy */}
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/50">
                {columns.map((col) => (
                  <th
                    key={col.key}
                    className={cn(
                      "px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider",
                      col.align === "right" && "text-right",
                      col.align === "center" && "text-center",
                      col.hideOnMobile && "hidden md:table-cell",
                      col.sortable && "cursor-pointer select-none hover:text-slate-700"
                    )}
                    style={col.width ? { width: col.width } : undefined}
                    onClick={col.sortable ? () => toggleSort(col.key) : undefined}
                    aria-sort={
                      sortKey === col.key && sortDir
                        ? sortDir === "asc"
                          ? "ascending"
                          : "descending"
                        : undefined
                    }
                  >
                    <span className="inline-flex items-center gap-1">
                      {col.header}
                      {col.sortable && (
                        <span className="text-slate-300" aria-hidden="true">
                          {sortKey === col.key ? (
                            sortDir === "asc" ? (
                              <ArrowUp className="h-3.5 w-3.5 text-slate-600" />
                            ) : (
                              <ArrowDown className="h-3.5 w-3.5 text-slate-600" />
                            )
                          ) : (
                            <ArrowUpDown className="h-3.5 w-3.5" />
                          )}
                        </span>
                      )}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-100">
              {/* Loading skeleton rows */}
              {loading &&
                Array.from({ length: pageSize }).map((_, i) => (
                  <tr key={`skeleton-${i}`} className="animate-pulse" aria-hidden="true">
                    {columns.map((col) => (
                      <td
                        key={col.key}
                        className={cn(
                          "px-4 py-3",
                          col.hideOnMobile && "hidden md:table-cell"
                        )}
                      >
                        <div className="h-4 bg-slate-100 rounded w-3/4" />
                      </td>
                    ))}
                  </tr>
                ))}

              {/* Data rows — PRIMARY hierarchy (the actual content) */}
              {!loading &&
                pageData.map((row) => (
                  <tr
                    key={row.id}
                    className="hover:bg-slate-50/50 transition-colors duration-100"
                  >
                    {columns.map((col) => (
                      <td
                        key={col.key}
                        className={cn(
                          "px-4 py-3 text-slate-700",
                          col.align === "right" && "text-right",
                          col.align === "center" && "text-center",
                          col.hideOnMobile && "hidden md:table-cell"
                        )}
                      >
                        {col.render
                          ? col.render(row[col.key], row)
                          : String(row[col.key] ?? "")}
                      </td>
                    ))}
                  </tr>
                ))}

              {/* Empty state */}
              {!loading && pageData.length === 0 && (
                <tr>
                  <td colSpan={columns.length} className="px-4 py-16 text-center">
                    <div className="flex flex-col items-center">
                      <div className="rounded-full bg-slate-100 p-3 mb-3">
                        <Inbox className="h-6 w-6 text-slate-400" aria-hidden="true" />
                      </div>
                      <p className="text-sm font-medium text-slate-900">{emptyTitle}</p>
                      <p className="text-xs text-slate-500 mt-1">{emptyDescription}</p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination — TERTIARY hierarchy */}
        {!loading && totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100">
            <p className="text-xs text-slate-500">
              Showing {page * pageSize + 1}–{Math.min((page + 1) * pageSize, sorted.length)} of{" "}
              {sorted.length}
            </p>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
                className={cn(
                  "p-1.5 rounded-md min-w-[44px] min-h-[44px]",
                  "flex items-center justify-center",
                  "text-slate-400 hover:text-slate-600 hover:bg-slate-100",
                  "disabled:opacity-30 disabled:cursor-not-allowed",
                  "transition-colors duration-150",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                )}
                aria-label="Previous page"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="text-xs text-slate-500 px-2">
                {page + 1} / {totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1}
                className={cn(
                  "p-1.5 rounded-md min-w-[44px] min-h-[44px]",
                  "flex items-center justify-center",
                  "text-slate-400 hover:text-slate-600 hover:bg-slate-100",
                  "disabled:opacity-30 disabled:cursor-not-allowed",
                  "transition-colors duration-150",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                )}
                aria-label="Next page"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export { DataTable };
export type { DataTableProps, Column };

// ============================================================
// Usage Example
// ============================================================
//
// interface User {
//   id: string;
//   name: string;
//   email: string;
//   role: string;
//   status: "active" | "inactive";
// }
//
// const columns: Column<User>[] = [
//   { key: "name", header: "Name", sortable: true },
//   { key: "email", header: "Email", sortable: true, hideOnMobile: true },
//   { key: "role", header: "Role", sortable: true },
//   {
//     key: "status",
//     header: "Status",
//     render: (val) => (
//       <span className={cn(
//         "px-2 py-0.5 rounded-full text-xs font-medium",
//         val === "active" ? "bg-green-50 text-green-700" : "bg-slate-100 text-slate-500"
//       )}>
//         {val}
//       </span>
//     ),
//   },
// ];
//
// <DataTable columns={columns} data={users} searchable pageSize={10} />
