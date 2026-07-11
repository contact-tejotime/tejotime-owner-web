import Skeleton from "./Skeleton";

/**
 * Skeleton rows in a `.store-table`, matching the real tables' column count.
 * `numCols` (from the right) render right-aligned like `.num` cells. Optionally
 * wraps in a `.section` + `.filter-row` skeleton to mirror the filtered table pages.
 */
export default function TableSkeleton({
  rows = 6,
  cols = 4,
  numCols = 0,
  section = false,
  filter = false,
}: {
  rows?: number;
  cols?: number;
  numCols?: number;
  section?: boolean;
  filter?: boolean;
}) {
  const isNum = (c: number) => c >= cols - numCols;

  const table = (
    <div className="table-wrap">
      <table className="store-table">
        <thead>
          <tr>
            {Array.from({ length: cols }).map((_, c) => (
              <th key={c} className={isNum(c) ? "num" : undefined}>
                <Skeleton
                  width={isNum(c) ? 48 : 80}
                  height={10}
                  radius={5}
                  style={isNum(c) ? { marginLeft: "auto" } : undefined}
                />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }).map((_, r) => (
            <tr key={r}>
              {Array.from({ length: cols }).map((_, c) => (
                <td key={c} className={isNum(c) ? "num" : undefined}>
                  <Skeleton
                    width={isNum(c) ? 56 : c === 0 ? "70%" : "55%"}
                    height={12}
                    radius={6}
                    style={isNum(c) ? { marginLeft: "auto" } : undefined}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  if (!section) return table;

  return (
    <div className="section">
      {filter && (
        <div className="filter-row">
          <Skeleton width={220} height={36} radius={10} />
          <Skeleton width={130} height={36} radius={10} />
          <Skeleton width={130} height={36} radius={10} />
        </div>
      )}
      {table}
    </div>
  );
}
