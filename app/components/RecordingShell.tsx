"use client";

import { RecordingProvider } from "../contexts/RecordingContext";
import RecordingBar from "./RecordingBar";

export default function RecordingShell({ children }: { children: React.ReactNode }) {
  return (
    <RecordingProvider>
      <RecordingBar />
      {children}
    </RecordingProvider>
  );
}
