import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import { LibraryPage } from "./pages/LibraryPage";

export default function App() {
  return (
    <div className="shell">
      <aside className="side">
        <NavLink to="/library" className="brand">
          <img src="/icon.jpg" alt="" />
          <span>
            <strong>Latch</strong>
            <small>库</small>
          </span>
        </NavLink>
        <nav className="nav">
          <NavLink
            to="/library"
            end
            className={({ isActive }) => (isActive ? "active" : undefined)}
          >
            库
          </NavLink>
        </nav>
      </aside>
      <main className="page">
        <Routes>
          <Route path="/library" element={<LibraryPage />} />
          <Route path="/" element={<Navigate to="/library" replace />} />
          <Route path="/routes" element={<Navigate to="/library" replace />} />
          <Route path="/deploy" element={<Navigate to="/library" replace />} />
          <Route path="/edit" element={<Navigate to="/library" replace />} />
        </Routes>
      </main>
    </div>
  );
}
