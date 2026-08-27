// Shown by StoreProvider (store.tsx) while the local PowerSync/wa-sqlite
// database is still opening (WASM compile + Worker/OPFS handshake, real
// wall-clock time even though it's 100% local — see docs/00-backlog). Not
// route-aware: StoreProvider wraps every route, so this stands in for
// whichever screen the app happens to cold-open into. Mirrors Home's own
// shape (app-bar + a "Recent" day-card of rows) since that's overwhelmingly
// the common case, rather than trying to match every possible route.
export function AppSkeleton() {
  return (
    <div className="home" aria-busy="true" aria-label="Loading your data">
      <div className="app-bar">
        <span className="wordmark">piggypal</span>
      </div>
      <div className="section-label">Recent</div>
      <div className="recent">
        <div className="day-card">
          {[0, 1, 2].map((i) => (
            <div className="tx-row skeleton-row" key={i}>
              <div className="tx-left">
                <div className="tx-main">
                  <span className="skeleton-bar skeleton-bar-note" />
                  <span className="skeleton-bar skeleton-bar-meta" />
                </div>
              </div>
              <span className="skeleton-bar skeleton-bar-amt" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
