/** Shown while a tab's data loads (the header and tabs are already on screen). */
export default function TabLoading() {
  return (
    <div role="status" aria-label="Loading" className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="card flex flex-col gap-3 p-4">
            <div className="skeleton h-3 w-20" />
            <div className="skeleton h-7 w-16" />
            <div className="skeleton h-3 w-32" />
          </div>
        ))}
      </div>
      <div className="card flex flex-col gap-3 p-4">
        {[80, 65, 72, 50, 60].map((w, i) => (
          <div key={i} className="skeleton h-3.5" style={{ width: `${w}%` }} />
        ))}
      </div>
    </div>
  );
}
