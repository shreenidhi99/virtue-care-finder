"use client";
// Two modes. Both stay mounted once opened, so a chat or planner selection survives switching.
import { useState } from "react";
import Chat from "./Chat";
import Planner from "./planner/Planner";

const EXAMPLES = [
  "Snakebite treatment near Kallidaikurichi, urgent",
  "Maternity hospital near PIN 627401",
  "Dialysis centres in Tirunelveli",
];

export default function App() {
  const [mode, setMode] = useState<"find" | "plan">("find");
  const [plannerOpened, setPlannerOpened] = useState(false);
  return (
    <div className={mode === "plan" ? "page wide" : "page"}>
      <header>
        <h1>🏥 Virtue Care Finder</h1>
        <div className="modes" role="tablist">
          <button role="tab" aria-selected={mode === "find"} className={mode === "find" ? "active" : ""} onClick={() => setMode("find")}>Find care</button>
          <button role="tab" aria-selected={mode === "plan"} className={mode === "plan" ? "active" : ""}
            onClick={() => { setMode("plan"); setPlannerOpened(true); }}>District planner</button>
        </div>
      </header>
      <main hidden={mode !== "find"}>
        <Chat
          sticky
          examples={EXAMPLES}
          placeholder="What care is needed, and where?"
          intro={<>Ask for a service and a place (town, PIN code or “lat, lon”). Records only say a service is <i>mentioned</i>; always verify by phone.</>}
        />
      </main>
      {plannerOpened && <main hidden={mode !== "plan"}><Planner /></main>}
    </div>
  );
}
