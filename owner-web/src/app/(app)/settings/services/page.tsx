import { PageHeader } from "@/components/PageHeader";

const SERVICES = [
  { name: "Haircut", mins: 30, price: "₹300" },
  { name: "Beard trim", mins: 15, price: "₹150" },
  { name: "Color", mins: 60, price: "₹1,200" },
  { name: "Blow dry", mins: 25, price: "₹400" },
];

export default function ServicesSettingsPage() {
  return (
    <div className="wrap">
      <PageHeader
        title="Services"
        subtitle="What customers can book"
        actions={
          <button type="button" className="btn">
            + Add service
          </button>
        }
      />
      <div className="section">
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Service</th>
                <th>Duration</th>
                <th>Price</th>
              </tr>
            </thead>
            <tbody>
              {SERVICES.map((s) => (
                <tr key={s.name}>
                  <td className="nm">{s.name}</td>
                  <td>{s.mins} min</td>
                  <td>{s.price}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
