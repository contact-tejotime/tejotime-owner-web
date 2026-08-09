import { PageHeader } from "@/components/PageHeader";

const STAFF = [
  { name: "Ravi Kumar", role: "Barber", active: true },
  { name: "Meera Shah", role: "Stylist", active: true },
  { name: "Dev Patel", role: "Apprentice", active: false },
];

export default function StaffSettingsPage() {
  return (
    <div className="wrap">
      <PageHeader
        title="Staff"
        subtitle="Seats and team members"
        actions={
          <button type="button" className="btn">
            + Add staff
          </button>
        }
      />
      <div className="section">
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Role</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {STAFF.map((s) => (
                <tr key={s.name}>
                  <td className="nm">{s.name}</td>
                  <td>{s.role}</td>
                  <td>
                    <span className={`chip ${s.active ? "confirmed" : "cancelled"}`}>
                      {s.active ? "Active" : "Inactive"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
