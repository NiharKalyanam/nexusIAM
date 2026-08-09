// Alias for Pagination — keeps backward compat with EntitlementsPage / ConnectorsPage
import Pagination from './Pagination';
export default function PaginationControls({ page=1, pages=1, limit=15, total=0, onPageChange, onLimitChange }) {
  return <Pagination page={page} total={total} limit={limit} onPageChange={onPageChange} onLimitChange={onLimitChange}/>;
}
