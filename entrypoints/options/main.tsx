import React from "react";
import ReactDOM from "react-dom/client";
import "../../assets/globals.css";
import { CONSOLE_URL } from "../../lib/config";
import { Button, Card } from "../sidepanel/components/ui";

function Options() {
  return (
    <main className="mx-auto max-w-md px-6 py-16">
      <Card className="space-y-4">
        <h1 className="text-xl font-semibold tracking-tight">Glance</h1>
        <p className="text-sm text-muted-foreground">Use the Glance panel from the toolbar. Wallet actions (sign in, add money, withdraw, pause) happen in your Glance account page.</p>
        <Button onClick={() => window.open(`${CONSOLE_URL}/account`, "_blank", "noopener")}>Open my Glance account</Button>
      </Card>
    </main>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Options />
  </React.StrictMode>,
);
