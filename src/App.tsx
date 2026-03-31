import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import Workflower from "./pages/Workflower";

const App = () => (
  <BrowserRouter>
    <Routes>
      {/* Force the root path to show your Workflower page */}
      <Route path="/" element={<Workflower />} />
      {/* Keep the old route just in case */}
      <Route path="/workflower" element={<Workflower />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  </BrowserRouter>
);

export default App;
