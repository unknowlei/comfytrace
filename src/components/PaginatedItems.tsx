import { useState } from 'react';
import type { ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface PaginatedItemsProps<T> {
  items: T[];
  label: string;
  children: (page: T[]) => ReactNode;
  pageSize?: number;
}

export default function PaginatedItems<T>({ items, label, children, pageSize = 100 }: PaginatedItemsProps<T>) {
  const [page, setPage] = useState(0);
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const currentPage = Math.min(page, totalPages - 1);
  const start = currentPage * pageSize;
  return <>
    {children(items.slice(start, start + pageSize))}
    {totalPages > 1 && <nav className="pagination" aria-label={`${label}分页`}>
      <span aria-live="polite">{start + 1}–{Math.min(start + pageSize, items.length)} / {items.length} 项</span>
      <button className="button quiet" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)} aria-label={`${label}上一页`}><ChevronLeft size={14} aria-hidden="true" />上一页</button>
      <output aria-label={`${label}当前页`}>{currentPage + 1} / {totalPages}</output>
      <button className="button quiet" disabled={currentPage === totalPages - 1} onClick={() => setPage(currentPage + 1)} aria-label={`${label}下一页`}>下一页<ChevronRight size={14} aria-hidden="true" /></button>
    </nav>}
  </>;
}
