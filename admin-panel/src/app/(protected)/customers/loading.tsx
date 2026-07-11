import CustomersDirectorySkeleton from "@/components/ui/skeletons/CustomersDirectorySkeleton";

/** /customers — the customers directory shell (header + list + profile panel). */
export default function CustomersLoading() {
  return (
    <div className="wrap">
      <CustomersDirectorySkeleton />
    </div>
  );
}
