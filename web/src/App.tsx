import { Link, Route, Routes } from "react-router-dom";
import { DeployPage } from "./pages/DeployPage";
import { EditPage } from "./pages/EditPage";
import { LibraryPage } from "./pages/LibraryPage";
import { RoutePage } from "./pages/RoutePage";

export default function App() {
  return (
    <div className="min-h-screen">
      <header className="border-b border-zinc-800/80 px-5 py-4">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4">
          <Link to="/" className="flex items-center gap-3">
            <img
              src="/icon.jpg"
              alt=""
              className="h-8 w-8 rounded-full object-cover"
            />
            <span className="text-lg font-medium tracking-tight">Latch</span>
          </Link>
          <nav className="flex gap-5 text-sm text-zinc-400">
            <Link to="/" className="hover:text-zinc-100">
              库
            </Link>
            <Link to="/routes" className="hover:text-zinc-100">
              链路
            </Link>
            <Link to="/edit" className="hover:text-zinc-100">
              编辑
            </Link>
            <Link to="/deploy" className="hover:text-zinc-100">
              部署
            </Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-5 py-8">
        <Routes>
          <Route path="/" element={<LibraryPage />} />
          <Route path="/routes" element={<RoutePage />} />
          <Route path="/edit" element={<EditPage />} />
          <Route path="/deploy" element={<DeployPage />} />
        </Routes>
      </main>
    </div>
  );
}
