import { NewTenantForm } from "./form";

export const metadata = { title: "Add tenant · TrashLab Control Plane" };

export default function NewTenantPage() {
  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: 24 }}>
      <a href="/" style={{ fontSize: 13, color: "#1f6feb", textDecoration: "none" }}>← Fleet</a>
      <h1 style={{ margin: "10px 0 4px", fontSize: 20, letterSpacing: "-.01em" }}>Add tenant</h1>
      <p style={{ margin: "0 0 20px", color: "#667085", fontSize: 13 }}>
        Onboard a new customer. Sales runs this — no engineering ticket.
      </p>
      <NewTenantForm />
    </div>
  );
}
