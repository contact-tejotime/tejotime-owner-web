"use client";

import { PageHeader } from "@/components/PageHeader";
import { useAuth } from "@/lib/auth";

export default function ProfileSettingsPage() {
  const { session } = useAuth();

  return (
    <div className="wrap">
      <PageHeader title="Profile" subtitle="Your account details" />
      <div className="section">
        <h2>Account</h2>
        <div className="field">
          <label>Name</label>
          <input defaultValue={session?.user.name ?? ""} readOnly />
        </div>
        <div className="field">
          <label>Phone</label>
          <input defaultValue={session?.user.phone ?? ""} readOnly />
        </div>
        <div className="field">
          <label>Role</label>
          <input defaultValue={session?.user.role ?? ""} readOnly />
        </div>
        <p className="hint">UI stub — profile edits will connect to the API later.</p>
        <button type="button" className="btn secondary">
          Save changes
        </button>
      </div>
    </div>
  );
}
