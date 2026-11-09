import { Routes, Route } from "react-router-dom";
import { Landing } from "./pages/Landing";
import { Analyzing } from "./pages/Analyzing";
import { Result } from "./pages/Result";

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/analyzing/:jobId" element={<Analyzing />} />
      <Route path="/r/:jobId" element={<Result />} />
    </Routes>
  );
}
