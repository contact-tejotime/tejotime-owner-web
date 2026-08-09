import { PageHeader } from "@/components/PageHeader";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export default function HoursSettingsPage() {
  return (
    <div className="wrap">
      <PageHeader title="Hours" subtitle="Weekly opening hours" />
      <div className="section">
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Day</th>
                <th>Open</th>
                <th>Close</th>
                <th>Closed</th>
              </tr>
            </thead>
            <tbody>
              {DAYS.map((day) => (
                <tr key={day}>
                  <td className="nm">{day}</td>
                  <td>09:00 AM</td>
                  <td>06:00 PM</td>
                  <td>{day === "Sunday" ? "Yes" : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="hint">UI stub — editing hours will connect to the API later.</p>
      </div>
    </div>
  );
}
